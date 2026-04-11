import type {
  SourceAdapter,
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
  FetchOpts,
} from '../../types';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';
import type { Signal } from '../../../../lib/types/signal';

const HN_SEARCH_URL = 'https://hn.algolia.com/api/v1/search';
const MAX_QUERIES = 3;
const HN_DEFAULT_HITS_PER_PAGE = 30;
const HN_MIN_POINTS = 5;

/**
 * Build HN-shape queries from the expanded plan. Picks the top MAX_QUERIES
 * expanded_keywords and wraps each in HN's tags/numericFilters/hitsPerPage
 * syntax. Returns an empty array when the plan has no keywords.
 */
function planQueries(
  plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const top = plan.expanded_keywords.slice(0, MAX_QUERIES);
  if (top.length === 0) return [];
  const createdAfter = Math.floor(
    new Date(plan.timeframe_iso).getTime() / 1000,
  );
  return top.map((kw) => ({
    label: `hn: ${kw}`,
    params: {
      query: kw,
      tags: 'story',
      numericFilters: `created_at_i>${createdAfter},points>${HN_MIN_POINTS}`,
      hitsPerPage: HN_DEFAULT_HITS_PER_PAGE,
    },
  }));
}

/**
 * Fetch HN Algolia results for every planned query. Executes one HTTP call
 * per query and flattens all returned hits into a single RawItem[] array.
 * When running under tests, the TECH_SCOUT_SCENARIO_HN env var is injected
 * as an x-test-scenario header so the MSW mock can return pre-registered
 * bodies; production runs never set the env var and omit the header.
 */
async function fetchQueries(
  queries: SourceQuery[],
  opts: FetchOpts,
): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const scenario = process.env.TECH_SCOUT_SCENARIO_HN;
  const headers: Record<string, string> = {};
  if (scenario) headers['x-test-scenario'] = scenario;

  for (const q of queries) {
    const url = buildHnUrl(q.params);
    const res = await fetch(url, { signal: opts.signal, headers });
    if (!res.ok) throw new Error(`hn algolia ${res.status}`);
    const body = (await res.json()) as { hits?: unknown[] };
    for (const hit of body.hits ?? []) {
      out.push({ source: 'hn_algolia', data: hit });
    }
  }
  return out;
}

/** Serialize an HN query params map into a fully-qualified request URL. */
function buildHnUrl(params: Record<string, unknown>): string {
  const u = new URL(HN_SEARCH_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

type HnHit = {
  objectID: string;
  title: string;
  url: string | null | undefined;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  _tags?: string[];
};

/**
 * Convert one HN Algolia hit into a canonical Signal. Ask HN / Show HN posts
 * with no url fall back to the news.ycombinator.com item permalink so the
 * downstream pipeline always has a valid URL to dedupe and display.
 */
function normalize(raw: RawItem): Signal {
  const hit = raw.data as HnHit;
  const url =
    hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const author = hit.author ?? 'unknown';
  const points = hit.points ?? 0;
  const comments = hit.num_comments ?? 0;
  const snippet = `HN: ${points} points, ${comments} comments, by ${author}`;
  return {
    source: 'hn_algolia',
    title: hit.title,
    url,
    date: hit.created_at ?? null,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5 },
    category: 'tech_capability',
    raw: hit,
  };
}

/** HN Algolia Search adapter — surfaces technical stories via HN search. */
export const hnAlgoliaAdapter: SourceAdapter = {
  name: 'hn_algolia',
  planQueries,
  fetch: fetchQueries,
  normalize,
};
