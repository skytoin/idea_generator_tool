import type {
  SourceAdapter,
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
  FetchOpts,
} from '../../types';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';
import type { Signal } from '../../../../lib/types/signal';
import { logger } from '../../../../lib/utils/logger';
import { decomposeKeywordToString } from '../keyword-decomposition';

const GH_SEARCH_URL = 'https://api.github.com/search/repositories';
const MAX_QUERIES = 6;
const DEFAULT_MIN_STARS = 50;
const PRODUCT_MIN_STARS = 20;
const DEFAULT_PER_PAGE = '20';
const MAX_TOPICS_IN_SNIPPET = 5;

/**
 * GitHub topic filters chosen based on the founder's profile. When
 * domain_tags suggest a consumer/SaaS founder, we filter for product
 * repos. When domain_tags suggest a developer-tools founder, we
 * filter for developer infrastructure. This is PROFILE-ADAPTIVE —
 * the same adapter works for both audiences without hardcoding.
 */
const CONSUMER_TOPIC_FILTER = 'topic:saas OR topic:self-hosted OR topic:webapp';
const DEVTOOL_TOPIC_FILTER = 'topic:cli OR topic:framework OR topic:developer-tools';
const TOPIC_QUERY_COUNT = 3;

/**
 * Domain tags that indicate the founder's audience is DEVELOPERS,
 * not end-users. When any of these appear in the plan's domain_tags,
 * GitHub queries use the devtool topic filter instead of the
 * consumer/SaaS filter. This lets a DevOps founder find CLI tools
 * and frameworks while a SaaS founder finds consumer products.
 */
const DEV_AUDIENCE_TAGS: ReadonlySet<string> = new Set([
  'developer-tools',
  'devtools',
  'devops',
  'infrastructure',
  'open-source',
  'cli',
  'framework',
  'sdk',
  'api',
  'platform-engineering',
]);

/**
 * Raised when GitHub rejects a request with 403 (rate-limit or auth
 * failure). The scanner orchestrator catches this specific class and
 * maps the source status to `denied`, leaving other HTTP errors as
 * generic `failed` statuses.
 */
export class GithubDeniedError extends Error {
  constructor(public readonly status: number) {
    super(`GitHub denied (${status})`);
    this.name = 'GithubDeniedError';
  }
}

/**
 * Prepare an LLM-produced github keyword for the search API. Two steps:
 *   1. Strip any stray quote characters (the LLM sometimes wraps
 *      phrases in quotes, which would become an exact-phrase match
 *      and almost never hit real repos).
 *   2. Decompose to the first 2 content tokens via the shared
 *      `decomposeKeywordToString` helper. GitHub search is strict
 *      token-AND (verified against GitHub docs), so a 4-token
 *      keyword like "privacy-preserving data collection library"
 *      requires all four tokens to co-occur — very rare. Two
 *      content tokens is the empirical sweet spot for matching
 *      real repositories.
 *
 * Returns the empty string when the keyword has no content tokens
 * (e.g. when it's entirely stopwords), so the caller can drop it.
 */
function sanitizeKeyword(kw: string): string {
  const unquoted = kw.replace(/"/g, '').replace(/\s+/g, ' ').trim();
  return decomposeKeywordToString(unquoted);
}

/**
 * Build GitHub Search queries from per-source github_keywords.
 *
 * Language filter policy: the adapter NEVER emits a `language:` GitHub
 * qualifier on its own. The scanner's job is to surface inspiring
 * projects regardless of the language they're written in — a brilliant
 * TypeScript MCP server or a Rust consumer tool is just as valuable
 * as a Python one for a Python-skilled founder. Restricting every
 * query to the founder's primary language systematically hides 80%+
 * of what's happening on GitHub (GitHub's top languages cover JS/TS,
 * Python, Rust, Go, C++, Java, and more). The `plan.github_languages`
 * field is preserved in the schema for forward compatibility but is
 * deliberately not consumed here. If a future caller needs to hard-
 * filter by language, that should be an explicit per-run directive
 * option, not an automatic inference from the founder's skill list.
 *
 * Keywords are passed UNQUOTED so GitHub matches each token
 * individually; every query carries `stars:>50` and a
 * `pushed:>YYYY-MM-DD` recent-activity filter. One query per
 * keyword, capped at MAX_QUERIES.
 */
/**
 * Detect whether the founder's profile targets developers based on
 * the LLM planner's domain_tags. If ANY tag matches the dev-audience
 * set, the founder is building for developers and the adapter uses
 * devtool topic filters instead of consumer/SaaS filters.
 */
function isDevAudience(domainTags: readonly string[]): boolean {
  return domainTags.some((tag) => DEV_AUDIENCE_TAGS.has(tag.toLowerCase()));
}

/**
 * Build GitHub Search queries with a profile-adaptive split strategy:
 *
 *   - First TOPIC_QUERY_COUNT queries get a topic filter based on who
 *     the founder is building for:
 *       • Consumer/SaaS founder → `topic:saas OR topic:self-hosted OR
 *         topic:webapp` + stars:>20 (find products)
 *       • Developer-tools founder → `topic:cli OR topic:framework OR
 *         topic:developer-tools` + stars:>20 (find dev infra)
 *   - Remaining queries use the original broad search with stars:>50
 *     and no topic filter for diversity.
 *
 * The adapter reads `plan.domain_tags` (set by the LLM expansion
 * planner based on the founder's profile) to decide which audience
 * the founder serves. This means the same code adapts automatically
 * for a nurse building patient tools, a marketer building analytics
 * SaaS, or a DevOps engineer building CLI infrastructure — without
 * hardcoding any audience name.
 */
function planQueries(
  plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const kws = plan.github_keywords
    .slice(0, MAX_QUERIES)
    .map(sanitizeKeyword)
    .filter((k) => k.length > 0);
  if (kws.length === 0) return [];
  const pushedAfter = plan.timeframe_iso.slice(0, 10);
  const topicFilter = isDevAudience(plan.domain_tags)
    ? DEVTOOL_TOPIC_FILTER
    : CONSUMER_TOPIC_FILTER;

  return kws.map((kw, i) => {
    const isTopicQuery = i < TOPIC_QUERY_COUNT;
    const stars = isTopicQuery ? PRODUCT_MIN_STARS : DEFAULT_MIN_STARS;
    const filter = isTopicQuery ? ` ${topicFilter}` : '';
    return {
      label: `github: ${kw}`,
      params: {
        q: `${kw} stars:>${stars} pushed:>${pushedAfter}${filter}`,
        sort: 'stars',
        order: 'desc',
        per_page: DEFAULT_PER_PAGE,
      },
    };
  });
}

/**
 * Execute planned GitHub Search queries sequentially. Injects the
 * required auth and accept headers on every call. Reads the test
 * scenario name from TECH_SCOUT_SCENARIO_GITHUB and forwards it as
 * `x-test-scenario` so the MSW mock can return pre-registered bodies.
 * 403 responses are rethrown as `GithubDeniedError` so the scanner
 * orchestrator can map them to the `denied` source status; any other
 * non-2xx is thrown as a plain Error which maps to `failed`. When the
 * API reports `incomplete_results: true`, the adapter logs a warning
 * and still returns the partial items.
 */
export async function fetchQueries(
  queries: SourceQuery[],
  opts: FetchOpts,
): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const headers = buildGithubHeaders();

  for (const q of queries) {
    const url = buildGithubUrl(q.params);
    const res = await fetch(url, { signal: opts.signal, headers });
    if (res.status === 403) throw new GithubDeniedError(403);
    if (!res.ok) throw new Error(`github ${res.status}`);
    const body = (await res.json()) as {
      items?: unknown[];
      incomplete_results?: boolean;
    };
    if (body.incomplete_results) {
      logger.warn(
        { scanner: 'tech_scout', source: 'github', label: q.label },
        'github returned incomplete_results',
      );
    }
    for (const item of body.items ?? []) {
      out.push({ source: 'github', data: item });
    }
  }
  return out;
}

/** Assemble the fixed header set GitHub requires on every search call. */
function buildGithubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'idea-generator-tech-scout',
  };
  const scenario = process.env.TECH_SCOUT_SCENARIO_GITHUB;
  if (scenario) headers['x-test-scenario'] = scenario;
  return headers;
}

/** Serialize a GitHub query params map into a fully-qualified search URL. */
function buildGithubUrl(params: Record<string, unknown>): string {
  const u = new URL(GH_SEARCH_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

type GhRepo = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics: string[];
  pushed_at: string;
  created_at: string;
  license: { name: string } | null;
};

/**
 * Convert a GitHub repo result into a canonical Signal. Title is the
 * `owner/name` full path; URL is the html_url; date is pushed_at. The
 * snippet summarizes stars, forks, language, topics (truncated at 5),
 * and description, collapsing nullish fields so the string never leaks
 * literal "null" or "undefined". Category is `adoption` because
 * stars plus recent pushes are real-use indicators rather than research.
 */
function normalize(raw: RawItem): Signal {
  const r = raw.data as GhRepo;
  const topicsShown = r.topics.slice(0, MAX_TOPICS_IN_SNIPPET);
  const topicsStr = topicsShown.length > 0 ? `, topics: ${topicsShown.join(', ')}` : '';
  const lang = r.language ?? 'unknown';
  const base = `GitHub: ⭐ ${r.stargazers_count}, ${r.forks_count} forks, ${lang}${topicsStr}.`;
  const snippet = r.description ? `${base} ${r.description}` : base;
  return {
    source: 'github',
    title: r.full_name,
    url: r.html_url,
    date: r.pushed_at,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'adoption',
    raw: r,
  };
}

/** GitHub Search adapter — queries the /search/repositories REST endpoint. */
export const githubAdapter: SourceAdapter = {
  name: 'github',
  planQueries,
  fetch: fetchQueries,
  normalize,
};
