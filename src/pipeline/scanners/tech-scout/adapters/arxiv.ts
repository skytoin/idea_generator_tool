import { XMLParser } from 'fast-xml-parser';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
  FetchOpts,
} from '../../types';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';
import type { Signal } from '../../../../lib/types/signal';
import { decomposeKeywordToTokens } from '../keyword-decomposition';

const ARXIV_QUERY_URL = 'http://export.arxiv.org/api/query';
const MAX_QUERIES = 6;
const ARXIV_SLEEP_MS = 3100;
const SNIPPET_MAX = 200;

/**
 * User-Agent header sent with every arxiv request. arxiv's API fair-
 * use policy explicitly asks clients to set a User-Agent so they can
 * attribute traffic and apply rate limits fairly. Without one, they
 * throttle more aggressively and you may see unexplained HTTP 429s
 * on requests that were otherwise within the documented rate limits.
 * Identifying the scanner by name and URL lets arxiv operators reach
 * out if usage patterns become a problem.
 */
const ARXIV_USER_AGENT =
  'idea-generator-tech-scout/1.0 (research scanner; https://github.com/skytoin/idea-generator)';

/**
 * Matches a full `cat:<subject>.<code>` token such as `cat:cs.LG`,
 * `cat:stat.ML`, `cat:cs.IR`. Case-insensitive on the code suffix
 * because arxiv categories are conventionally `cs.AI`, `stat.ML`,
 * etc. Used by `sanitizeArxivKeyword` to DROP these tokens entirely
 * — they are category filters, not content keywords.
 */
const ARXIV_CAT_TOKEN_REGEX = /\bcat:[a-zA-Z]+\.[a-zA-Z]+\b/g;

/**
 * Matches a leading `abs:`, `ti:`, `au:`, `co:`, `jr:`, `rn:`, or
 * `all:` field qualifier at the start of a token (i.e. at string
 * start or after whitespace). Captures the leading whitespace in
 * `$1` so the replacement can preserve it. Used to STRIP these
 * prefixes while keeping the token content — if Sonnet writes
 * `abs:tabular`, we interpret it as just `tabular`.
 */
const ARXIV_FIELD_PREFIX_REGEX = /(^|\s)(?:abs|ti|au|co|jr|rn|all):/gi;

/**
 * Sonnet-specific sanitization. Claude Sonnet 4.6 occasionally
 * emits arxiv_keywords strings that embed arxiv field qualifiers
 * like `cat:cs.LG tabular` (category code prepended onto the
 * keyword) or `abs:tabular` (abs-field prefix prepended). Without
 * stripping, the adapter's URL builder would produce invalid
 * arxiv query syntax like `abs:cat:cs.LG+AND+abs:tabular` and
 * arxiv would reject the whole request.
 *
 * The sanitization is a PROFILE-AGNOSTIC NO-OP for gpt-4o (which
 * never produces these prefixes in practice) and a safety net for
 * Sonnet. It removes:
 *   - `cat:<subject>.<code>` tokens entirely (category filters,
 *     which arxiv pairs separately via `arxiv_categories`)
 *   - Leading `abs:`, `ti:`, `au:`, `co:`, `jr:`, `rn:`, `all:`
 *     field prefixes from any token, keeping the token content
 *
 * Then collapses whitespace and trims the result.
 */
function sanitizeArxivKeyword(kw: string): string {
  return kw
    .replace(ARXIV_CAT_TOKEN_REGEX, '')
    .replace(ARXIV_FIELD_PREFIX_REGEX, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * Build an arxiv `abs:` clause for a decomposed keyword.
 *
 * ENCODING RULES (from arxiv API user manual):
 *   - Parentheses MUST be percent-encoded: %28 for `(`, %29 for `)`.
 *     Literal parens in the query string cause silent parse failures.
 *   - `+` encodes a space; `+AND+` is the boolean AND operator.
 *   - Do NOT quote individual tokens with `"..."` (%22) — arxiv
 *     indexes hyphenated compounds like "multi-source" as separate
 *     tokens ("multi", "source"), so a quoted-phrase search
 *     `abs:"multi-source"` silently returns 0 results. Instead,
 *     expand hyphens into separate AND-joined abs: terms.
 *
 * HYPHEN HANDLING: a token like `multi-source` is split on `-` into
 * `["multi", "source"]` and each sub-token gets its own `abs:` term.
 * This avoids BOTH the Lucene-NOT pitfall (bare `-` interpreted as
 * NOT) AND the exact-phrase-miss pitfall (quoted `"multi-source"`
 * not matching the tokenized index).
 */
/**
 * Build a title+abstract anchored search clause. The FIRST token is
 * searched in `ti:` (title) so only papers whose title is ABOUT this
 * topic match — not papers that incidentally mention the word in a
 * long abstract. The remaining tokens use `abs:` for broader recall.
 * Hyphens are expanded into separate sub-tokens so arxiv's Lucene
 * parser doesn't treat `-` as NOT. Parentheses are percent-encoded
 * per arxiv API docs (%28 and %29, NOT literal parens).
 *
 * Single-token: `ti:token` (strictest).
 * Multi-token: `%28ti:first+AND+abs:second%29` (title-anchored).
 */
function buildSearchClause(tokens: readonly string[]): string {
  const expanded = tokens.flatMap((t) => t.split('-').filter((s) => s.length > 0));
  if (expanded.length === 0) return '';
  if (expanded.length === 1) return `ti:${encodeURIComponent(expanded[0]!)}`;
  const titlePart = `ti:${encodeURIComponent(expanded[0]!)}`;
  const absParts = expanded.slice(1).map((t) => `abs:${encodeURIComponent(t)}`);
  return `%28${[titlePart, ...absParts].join('+AND+')}%29`;
}

/**
 * Format a Date as arxiv's submittedDate range syntax: YYYYMMDDTTTT.
 * arxiv requires minute-precision (not just date-only) per the API
 * user manual. We zero the time component for the start date so the
 * range covers the full first day. End is set to now (235959).
 */
function formatArxivDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}0000`;
}

/**
 * Build arxiv queries with two improvements over the v1 adapter:
 *
 * 1. TITLE-ANCHORED search: the first token uses `ti:` (title match)
 *    instead of `abs:` (abstract match). A paper with "fraud" in the
 *    TITLE is definitively about fraud; one that mentions "fraud" in
 *    its abstract may just reference it in passing. Title-anchoring
 *    cuts irrelevant matches dramatically. Remaining tokens still
 *    use `abs:` for broader recall.
 *
 * 2. SUBMITTED-DATE RANGE: adds `+AND+submittedDate:` range directly
 *    in the search_query so arxiv hard-excludes old papers at the API
 *    level. This is more reliable than relying solely on sort+limit.
 *
 * Returns an empty array when the plan has no categories or no
 * surviving keywords.
 */
function planQueries(
  plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const cats = plan.arxiv_categories;
  if (cats.length === 0) return [];
  const decomposed = plan.arxiv_keywords
    .slice(0, MAX_QUERIES)
    .map((kw) => sanitizeArxivKeyword(kw))
    .map((kw) => decomposeKeywordToTokens(kw))
    .filter((tokens) => tokens.length > 0);
  if (decomposed.length === 0) return [];
  const dateFrom = formatArxivDate(new Date(plan.timeframe_iso));
  const dateNow = formatArxivDate(new Date());
  const dateRange = `submittedDate:%5B${dateFrom}+TO+${dateNow}%5D`;
  return decomposed.map((tokens, i) => {
    const cat = cats[i % cats.length]!;
    const labelKw = tokens.join(' ');
    const searchClause = buildSearchClause(tokens);
    return {
      label: `arxiv: cat:${cat} × "${labelKw}"`,
      params: {
        search_query: `cat:${cat}+AND+${searchClause}+AND+${dateRange}`,
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    };
  });
}

/**
 * Execute arxiv queries sequentially with an ARXIV_SLEEP_MS delay
 * between calls to respect arxiv's rate-limit guidance ("play nice,
 * 3 second delay"). Always sets a User-Agent header so arxiv can
 * attribute our traffic and apply fair-use rate limits instead of
 * aggressive 429s for anonymous clients.
 *
 * PARTIAL-SUCCESS HANDLING: per-query fetch errors are caught and
 * tracked but do NOT abort the loop. If a later query 429s (rate
 * limited) after earlier queries succeeded, we keep the earlier
 * results and return them. Only when EVERY query in the batch
 * failed do we throw — so runOneAdapter can classify the error
 * and mark the source as denied/failed. This is the fix for the
 * 2026-04-15 symptom where one mid-loop 429 discarded several
 * queries' worth of successfully-fetched items.
 *
 * Test scenario routing: TECH_SCOUT_SCENARIO_ARXIV is forwarded as
 * the `x-test-scenario` header so MSW can serve pre-registered XML.
 * The sleep function is injectable so tests can pass a no-op.
 */
export async function fetchQueries(
  queries: SourceQuery[],
  opts: FetchOpts,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const scenario = process.env.TECH_SCOUT_SCENARIO_ARXIV;
  const headers: Record<string, string> = {
    'User-Agent': ARXIV_USER_AGENT,
  };
  if (scenario) headers['x-test-scenario'] = scenario;

  const errors: Error[] = [];
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(ARXIV_SLEEP_MS);
    const q = queries[i];
    if (!q) continue;
    const url = buildArxivUrl(q.params);
    try {
      const res = await fetch(url, { signal: opts.signal, headers });
      if (!res.ok) throw new Error(`arxiv ${res.status}`);
      const xml = await res.text();
      const parsed = xmlParser.parse(xml) as { feed?: { entry?: unknown } };
      const entries = toArray(parsed.feed?.entry);
      for (const entry of entries) {
        out.push({ source: 'arxiv', data: entry });
      }
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
      // Keep looping — maybe a later query will still succeed.
      // If everything fails, we throw the first error below.
    }
  }
  // If at least one query returned items, treat the batch as a
  // partial success and swallow the errors. If zero items were
  // returned AND at least one error occurred, rethrow so the
  // orchestrator can mark the source as denied/failed.
  if (out.length === 0 && errors.length > 0) {
    throw errors[0];
  }
  return out;
}

/**
 * Serialize arxiv params into a query string directly. arxiv uses
 * non-standard URL encoding (literal `+` for AND, pre-encoded `%22` for
 * quoted phrases) so we bypass URL.searchParams which would double-encode.
 */
function buildArxivUrl(params: Record<string, unknown>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${ARXIV_QUERY_URL}?${qs}`;
}

/**
 * Normalize fast-xml-parser's object-or-array output to always be an array.
 * A single `<entry>` comes back as an object, multiple as an array, and a
 * missing element as undefined — this helper collapses all three cases.
 */
function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Default sleep implementation using setTimeout. Tests inject a no-op. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type ArxivEntry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: unknown;
  category?: unknown;
};

/**
 * Convert a parsed arxiv Atom entry into a canonical Signal. Strips the
 * `v<N>` version suffix from the URL so dedupe across query rounds collapses
 * revisions of the same paper to one signal. Collapses whitespace in the
 * title and abstract, then truncates the abstract at SNIPPET_MAX chars
 * with a trailing ellipsis when it overflows.
 */
function normalize(raw: RawItem): Signal {
  const entry = raw.data as ArxivEntry;
  const id = (entry.id ?? '').replace(/v\d+$/, '');
  const title = (entry.title ?? '').replace(/\s+/g, ' ').trim();
  const summary = (entry.summary ?? '').replace(/\s+/g, ' ').trim();
  const snippet =
    summary.length > SNIPPET_MAX ? `${summary.slice(0, SNIPPET_MAX)}…` : summary;
  return {
    source: 'arxiv',
    title,
    url: id,
    date: entry.published ?? null,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'research',
    raw: entry,
  };
}

/** arxiv API adapter — queries the arxiv.org `/api/query` search endpoint. */
export const arxivAdapter: SourceAdapter = {
  name: 'arxiv',
  planQueries,
  fetch: (queries, opts) => fetchQueries(queries, opts),
  normalize,
};
