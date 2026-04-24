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
 * Generic first-token deny list — words that frequently appear in
 * keyword phrases without carrying "aboutness". Title-anchoring on
 * any of these silently kills recall because almost no paper has
 * "multi" or "real" as the focus of its title; they're modifiers,
 * not topics. Surfaced from the 2026-04-22 gpt-5.4 run where
 * `multi-table churn` produced `ti:multi AND abs:table AND abs:churn`
 * and returned zero papers.
 *
 * Compared case-insensitively. Deny-listed first tokens fall back to
 * `abs:` for that token (the rest of the phrase decides the search).
 */
const GENERIC_FIRST_TOKEN_DENY_LIST: ReadonlySet<string> = new Set([
  'multi',
  'real',
  'novel',
  'data',
  'fast',
  'long',
  'wide',
  'deep',
  'large',
  'small',
  'good',
  'best',
  'late',
  'early',
  'high',
  'low',
  'new',
  'old',
  'simple',
  'general',
  'basic',
  'recent',
  'modern',
]);

/**
 * Decide whether a first-token deserves the strict `ti:` (title)
 * anchor. The anchor delivers high precision — only papers whose
 * title is ABOUT this topic match — but at heavy recall cost when
 * the token is generic or arbitrary. Three rules combine:
 *
 *   1. ALL-CAPS acronyms (≥2 chars) ALWAYS anchor — "PU", "RAG",
 *      "MCP" only carry meaning when present in the paper's title.
 *   2. Generic modifiers (`GENERIC_FIRST_TOKEN_DENY_LIST`) NEVER
 *      anchor — they're vague even at 5+ chars.
 *   3. Otherwise, anchor only if the token is ≥5 chars (specific
 *      enough to plausibly be a paper's topic).
 *
 * The 5-char threshold is empirically chosen so canonical research
 * tokens like "fraud", "novel" (already in deny list), "tabular"
 * keep their anchor while short modifiers like "AI" (caught by
 * acronym rule) and "data" (caught by deny list) are exempted.
 */
export function shouldAnchorFirstTokenInTitle(token: string): boolean {
  if (GENERIC_FIRST_TOKEN_DENY_LIST.has(token.toLowerCase())) return false;
  if (/^[A-Z]{2,}$/.test(token)) return true;
  return token.length >= 5;
}

/**
 * Build a title+abstract anchored search clause. The FIRST token is
 * searched in `ti:` (title) so only papers whose title is ABOUT this
 * topic match — not papers that incidentally mention the word in a
 * long abstract. The remaining tokens use `abs:` for broader recall.
 * Hyphens are expanded into separate sub-tokens so arxiv's Lucene
 * parser doesn't treat `-` as NOT. Parentheses are percent-encoded
 * per arxiv API docs (%28 and %29, NOT literal parens).
 *
 * Title anchor is applied SMARTLY (`shouldAnchorFirstTokenInTitle`):
 * generic first tokens like "multi" or "data" stay in `abs:` rather
 * than crushing recall with a useless title constraint.
 *
 * Single-token: `ti:token` if token deserves anchor, else `abs:token`.
 * Multi-token: `%28ti:first+AND+abs:rest%29` if anchored, else
 *              `%28abs:first+AND+abs:rest%29`.
 */
function buildSearchClause(tokens: readonly string[]): string {
  const expanded = tokens.flatMap((t) => t.split('-').filter((s) => s.length > 0));
  if (expanded.length === 0) return '';
  const firstField = shouldAnchorFirstTokenInTitle(expanded[0]!) ? 'ti' : 'abs';
  if (expanded.length === 1) return `${firstField}:${encodeURIComponent(expanded[0]!)}`;
  const firstPart = `${firstField}:${encodeURIComponent(expanded[0]!)}`;
  const absParts = expanded.slice(1).map((t) => `abs:${encodeURIComponent(t)}`);
  return `%28${[firstPart, ...absParts].join('+AND+')}%29`;
}

/**
 * Build the abstract-only fallback variant of a search clause —
 * EVERY token uses `abs:` (no title anchor). Used as the second
 * attempt when the primary title-anchored query returns zero
 * entries. Same hyphen-expansion and percent-encoding rules as
 * `buildSearchClause` so URL semantics stay identical.
 */
function buildAbsOnlySearchClause(tokens: readonly string[]): string {
  const expanded = tokens.flatMap((t) => t.split('-').filter((s) => s.length > 0));
  if (expanded.length === 0) return '';
  const parts = expanded.map((t) => `abs:${encodeURIComponent(t)}`);
  if (parts.length === 1) return parts[0]!;
  return `%28${parts.join('+AND+')}%29`;
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
    const absOnlyClause = buildAbsOnlySearchClause(tokens);
    const fallbackQuery = `cat:${cat}+AND+${absOnlyClause}+AND+${dateRange}`;
    const primaryQuery = `cat:${cat}+AND+${searchClause}+AND+${dateRange}`;
    // The transport-only `_fallback_search_query` carries the
    // abstract-only variant alongside the primary. The fetch loop
    // re-issues this query if the primary returns 0 entries — title
    // anchoring is precise but kills recall when the first token is
    // a niche term that simply doesn't appear in many paper titles.
    // Skipping the fallback when primary === fallback (no anchor was
    // applied) avoids wasting a request retrying the identical URL.
    const params: Record<string, unknown> = {
      search_query: primaryQuery,
      max_results: '100',
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    };
    if (primaryQuery !== fallbackQuery) {
      params._fallback_search_query = fallbackQuery;
    }
    return {
      label: `arxiv: cat:${cat} × "${labelKw}"`,
      params,
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
      const entries = await fetchOneArxivQuery(url, headers, opts.signal);
      // Title-anchored fallback: if the primary returned 0 entries
      // AND the planner attached an abs-only fallback variant, retry
      // once IMMEDIATELY (no sleep — the primary fetch already took
      // hundreds of ms and the next inter-query ARXIV_SLEEP_MS re-
      // establishes the polite average rate). Adds at most ~50ms +
      // one extra request per zero-returning query, keeping the
      // adapter well inside its 60s per-source budget. The retry
      // uses the SAME error-tracking logic — a failed retry doesn't
      // double-count.
      if (entries.length === 0 && q.params._fallback_search_query) {
        const fallbackParams = {
          ...q.params,
          search_query: String(q.params._fallback_search_query),
        };
        const fallbackUrl = buildArxivUrl(fallbackParams);
        const fallbackEntries = await fetchOneArxivQuery(
          fallbackUrl,
          headers,
          opts.signal,
        );
        for (const entry of fallbackEntries) {
          out.push({ source: 'arxiv', data: entry });
        }
      } else {
        for (const entry of entries) {
          out.push({ source: 'arxiv', data: entry });
        }
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
 *
 * Transport-only fields starting with `_` are stripped (e.g. the
 * `_fallback_search_query` carrier the planner attaches for the
 * abs-only retry). They must never reach the wire.
 */
function buildArxivUrl(params: Record<string, unknown>): string {
  const qs = Object.entries(params)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${ARXIV_QUERY_URL}?${qs}`;
}

/**
 * Fetch ONE arxiv URL, parse its Atom feed, and return the entries
 * array. Pulled out of the main loop so the title-anchored fallback
 * can call the same fetch+parse path without duplicating logic.
 * Throws on HTTP error so the caller's error tracker captures it.
 */
async function fetchOneArxivQuery(
  url: string,
  headers: Record<string, string>,
  signal: FetchOpts['signal'],
): Promise<unknown[]> {
  const res = await fetch(url, { signal, headers });
  if (!res.ok) throw new Error(`arxiv ${res.status}`);
  const xml = await res.text();
  const parsed = xmlParser.parse(xml) as { feed?: { entry?: unknown } };
  return toArray(parsed.feed?.entry);
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
