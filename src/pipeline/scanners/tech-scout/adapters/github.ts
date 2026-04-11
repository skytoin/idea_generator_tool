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

const GH_SEARCH_URL = 'https://api.github.com/search/repositories';
const MAX_QUERIES = 4;
const DEFAULT_MIN_STARS = 50;
const DEFAULT_PER_PAGE = '20';
const MAX_TOPICS_IN_SNIPPET = 5;

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
 * Build GitHub Search queries from the expanded plan. With languages
 * provided, emits the cross-product of the top 2 keywords x top 2
 * languages. Without languages, falls back to the top 3 keyword-only
 * queries. Every query carries `stars:>50` plus a recent-push filter
 * derived from `plan.timeframe_iso`, and is capped at MAX_QUERIES so
 * the GitHub Search rate budget stays predictable.
 */
function planQueries(
  plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const kws = plan.expanded_keywords;
  if (kws.length === 0) return [];
  const langs = plan.github_languages.slice(0, 2);
  const pushedAfter = plan.timeframe_iso.slice(0, 10);

  const queries: SourceQuery[] =
    langs.length === 0
      ? buildKeywordOnlyQueries(kws, pushedAfter)
      : buildKeywordLanguageQueries(kws, langs, pushedAfter);

  return queries.slice(0, MAX_QUERIES);
}

/** Build the top-3 keyword-only query list used when github_languages is empty. */
function buildKeywordOnlyQueries(
  kws: string[],
  pushedAfter: string,
): SourceQuery[] {
  return kws.slice(0, 3).map((kw) => ({
    label: `github: "${kw}"`,
    params: {
      q: `"${kw}" stars:>${DEFAULT_MIN_STARS} pushed:>${pushedAfter}`,
      sort: 'stars',
      order: 'desc',
      per_page: DEFAULT_PER_PAGE,
    },
  }));
}

/** Build the cross-product of top-2 keywords and top-2 languages. */
function buildKeywordLanguageQueries(
  kws: string[],
  langs: string[],
  pushedAfter: string,
): SourceQuery[] {
  const out: SourceQuery[] = [];
  for (const kw of kws.slice(0, 2)) {
    for (const lang of langs) {
      out.push({
        label: `github: "${kw}" ${lang}`,
        params: {
          q: `"${kw}" language:${lang} stars:>${DEFAULT_MIN_STARS} pushed:>${pushedAfter}`,
          sort: 'stars',
          order: 'desc',
          per_page: DEFAULT_PER_PAGE,
        },
      });
    }
  }
  return out;
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
  const topicsStr =
    topicsShown.length > 0 ? `, topics: ${topicsShown.join(', ')}` : '';
  const lang = r.language ?? 'unknown';
  const base = `GitHub: ⭐ ${r.stargazers_count}, ${r.forks_count} forks, ${lang}${topicsStr}.`;
  const snippet = r.description ? `${base} ${r.description}` : base;
  return {
    source: 'github',
    title: r.full_name,
    url: r.html_url,
    date: r.pushed_at,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5 },
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
