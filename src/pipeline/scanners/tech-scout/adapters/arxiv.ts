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

const ARXIV_QUERY_URL = 'http://export.arxiv.org/api/query';
const MAX_CATS = 2;
const MAX_KWS = 2;
const MAX_QUERIES = 4;
const ARXIV_SLEEP_MS = 3100;
const SNIPPET_MAX = 200;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * Build arxiv queries from the expanded plan. Produces the cross-product of
 * (top MAX_CATS arxiv_categories) × (top MAX_KWS expanded_keywords), capped
 * at MAX_QUERIES. Returns an empty array when the plan has no categories.
 */
function planQueries(
  plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const cats = plan.arxiv_categories.slice(0, MAX_CATS);
  const kws = plan.expanded_keywords.slice(0, MAX_KWS);
  if (cats.length === 0) return [];
  const queries: SourceQuery[] = [];
  for (const cat of cats) {
    for (const kw of kws) {
      queries.push({
        label: `arxiv: cat:${cat} × "${kw}"`,
        params: {
          search_query: `cat:${cat}+AND+abs:${encodeURIComponent(`"${kw}"`)}`,
          max_results: '20',
          sortBy: 'submittedDate',
          sortOrder: 'descending',
        },
      });
    }
  }
  return queries.slice(0, MAX_QUERIES);
}

/**
 * Execute arxiv queries sequentially with an ARXIV_SLEEP_MS delay between
 * calls to respect arxiv's rate-limit guidance ("play nice, 3 second delay").
 * Test scenario routing via TECH_SCOUT_SCENARIO_ARXIV env var injected as
 * an x-test-scenario header so MSW serves pre-registered XML. The sleep
 * function is injectable so tests can pass a no-op and skip real waits.
 */
export async function fetchQueries(
  queries: SourceQuery[],
  opts: FetchOpts,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const scenario = process.env.TECH_SCOUT_SCENARIO_ARXIV;
  const headers: Record<string, string> = {};
  if (scenario) headers['x-test-scenario'] = scenario;

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(ARXIV_SLEEP_MS);
    const q = queries[i];
    if (!q) continue;
    const url = buildArxivUrl(q.params);
    const res = await fetch(url, { signal: opts.signal, headers });
    if (!res.ok) throw new Error(`arxiv ${res.status}`);
    const xml = await res.text();
    const parsed = xmlParser.parse(xml) as { feed?: { entry?: unknown } };
    const entries = toArray(parsed.feed?.entry);
    for (const entry of entries) {
      out.push({ source: 'arxiv', data: entry });
    }
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
    summary.length > SNIPPET_MAX
      ? `${summary.slice(0, SNIPPET_MAX)}…`
      : summary;
  return {
    source: 'arxiv',
    title,
    url: id,
    date: entry.published ?? null,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5 },
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
