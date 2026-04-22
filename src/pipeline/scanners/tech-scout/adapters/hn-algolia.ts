import type {
  SourceAdapter,
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
  FetchOpts,
} from '../../types';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';
import type { Signal } from '../../../../lib/types/signal';
import { decomposeKeywordToString } from '../keyword-decomposition';

/**
 * Two HN Algolia endpoints:
 *   - /search — relevance-ranked (points + text match + freshness mix)
 *   - /search_by_date — pure reverse-chronological
 *
 * We use /search_by_date for Show HN queries so we catch fresh
 * product launches that haven't accumulated points yet, and /search
 * for broader story queries where relevance ranking helps surface
 * the most-discussed content.
 */
const HN_SEARCH_URL = 'https://hn.algolia.com/api/v1/search';
const HN_SEARCH_BY_DATE_URL = 'https://hn.algolia.com/api/v1/search_by_date';
const MAX_QUERIES = 6;
const HN_DEFAULT_HITS_PER_PAGE = 30;
const HN_MIN_POINTS = 5;
const HN_MIN_COMMENTS = 3;

/**
 * Index below which queries use `tags=show_hn` (product launches)
 * instead of `tags=story` (all stories). Show HN posts are literally
 * "here's what I built" — the highest-signal HN subset for startup
 * inspiration. The first SHOW_HN_QUERY_COUNT queries target launches;
 * the rest use broad `story` for context and discussions.
 */
const SHOW_HN_QUERY_COUNT = 4;

/**
 * Build HN-shape queries from the expanded plan. Runs each hn_keyword
 * through the shared `decomposeKeywordToString` helper which takes
 * the first 2 content tokens after stopword stripping. HN Algolia is
 * strict token-AND with no OR operator (verified against Algolia
 * docs), so a 4+ token phrase almost always returns zero hits on
 * short story titles. Keywords that resolve to an empty string after
 * stopword stripping are silently dropped. Returns an empty array
 * when the plan has no surviving HN keywords.
 */
/**
 * Build HN queries with a split strategy:
 *   - First SHOW_HN_QUERY_COUNT queries use `tags=show_hn` and hit
 *     the `/search_by_date` endpoint to catch fresh product launches.
 *     Show HN posts are "here's what I built" — the richest source
 *     of startup-relevant signals on HN.
 *   - Remaining queries use `tags=story` and the regular `/search`
 *     endpoint for broader discussions, blog posts, and news.
 *
 * All queries require `num_comments>3` (engagement proof) alongside
 * the existing `points>5` minimum. A post with <3 comments generated
 * no real discussion and is likely noise.
 */
function planQueries(
  plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const top = plan.hn_keywords.slice(0, MAX_QUERIES);
  if (top.length === 0) return [];
  const createdAfter = Math.floor(new Date(plan.timeframe_iso).getTime() / 1000);
  const numericFilters = `created_at_i>${createdAfter},points>${HN_MIN_POINTS},num_comments>${HN_MIN_COMMENTS}`;
  const queries: SourceQuery[] = [];
  for (let i = 0; i < top.length; i++) {
    const query = decomposeKeywordToString(top[i]!);
    if (query.length === 0) continue;
    const isShowHn = i < SHOW_HN_QUERY_COUNT;
    queries.push({
      label: `hn: ${query}`,
      params: {
        query,
        tags: isShowHn ? 'show_hn' : 'story',
        numericFilters,
        hitsPerPage: HN_DEFAULT_HITS_PER_PAGE,
      },
      ...(isShowHn ? { _useSearchByDate: true } : {}),
    });
  }
  return queries;
}

/**
 * Fetch HN Algolia results for every planned query. Executes one HTTP call
 * per query and flattens all returned hits into a single RawItem[] array.
 * When running under tests, the TECH_SCOUT_SCENARIO_HN env var is injected
 * as an x-test-scenario header so the MSW mock can return pre-registered
 * bodies; production runs never set the env var and omit the header.
 */
async function fetchQueries(queries: SourceQuery[], opts: FetchOpts): Promise<RawItem[]> {
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

/**
 * Serialize an HN query params map into a fully-qualified request URL.
 * When the query carries `_useSearchByDate: true`, uses the date-sorted
 * endpoint; otherwise uses the relevance-sorted endpoint. The flag is
 * stripped from params before building the URL so it doesn't leak into
 * the query string.
 */
function buildHnUrl(params: Record<string, unknown>): string {
  const useDate = params._useSearchByDate === true;
  const base = useDate ? HN_SEARCH_BY_DATE_URL : HN_SEARCH_URL;
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (k === '_useSearchByDate') continue;
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
  const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
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
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
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
