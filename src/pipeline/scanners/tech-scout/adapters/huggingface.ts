import type {
  SourceAdapter,
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
  FetchOpts,
} from '../../types';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';
import type { Signal } from '../../../../lib/types/signal';

/**
 * Hugging Face Hub REST API. Three surfaces in one adapter:
 *   - Trending Models  (/api/models)        — "what AI capability just shipped"
 *   - Trending Spaces  (/api/spaces)        — "indie demos people love"
 *   - Daily Papers     (/api/daily_papers)  — "community-curated research"
 *
 * No auth required. Anonymous gets 500 req/5min, with optional
 * `HF_TOKEN` env var that doubles to 1000/5min. We only need ~13
 * requests per scan so even anonymous is comfortable.
 */
const HF_BASE_URL = 'https://huggingface.co';

/** User-Agent identifying the scanner so HF can attribute traffic. */
const HF_USER_AGENT =
  'idea-generator-tech-scout/1.0 (research scanner; https://github.com/skytoin/idea-generator)';

/**
 * Per-surface query budget. 3 model + 3 space search queries (each
 * sorted by trendingScore) + 7 daily-papers calls (one per day of
 * the past week) = 13 requests max. Each ~200-500ms → adapter total
 * ~3-6s, well under the 60s per-source timeout.
 */
const MAX_KEYWORD_QUERIES_PER_SURFACE = 3;
const DAILY_PAPERS_DAYS = 7;

/** Maximum items requested per listing call. HF caps at 100. */
const HF_LIMIT = 50;

/** Maximum items requested per Daily Papers call. */
const HF_DAILY_PAPERS_LIMIT = 50;

/**
 * Polite spacing between requests. HF allows 100 req/min anonymous
 * (5/3s sustained), so 600ms keeps us comfortably under without
 * making the adapter feel slow. Tests inject a no-op sleep.
 */
const HF_SLEEP_MS = 600;

/**
 * Engagement floors applied client-side per surface. Set to 1 rather
 * than a higher cutoff because the 2026-04-24 run showed that search
 * queries on precise terms (like "RAG evaluation" or "customer
 * churn") often return top-trending results with 0-4 likes — still
 * on-topic, just in niche areas the community hasn't liked yet. A
 * floor of 1 only rejects the literal-zero-engagement abandoned
 * uploads while letting the enricher score the rest on relevance.
 * Daily Papers ALWAYS pass through because HF curates them.
 */
const MIN_MODEL_LIKES = 1;
const MIN_SPACE_LIKES = 1;

/**
 * Maximum length of the Daily Papers `ai_summary` we keep as the
 * Signal snippet. Above this, truncate with an ellipsis. Mirrors the
 * SNIPPET_MAX of the arxiv adapter for consistent downstream behavior.
 */
const SNIPPET_MAX = 280;

/**
 * Exponential back-off for 429 responses. HF returns standard 429 +
 * IETF RateLimit headers. We honor `Retry-After` when present, fall
 * back to 5s × 2^attempt (5/10/20s — 35s total budget per query),
 * fitting inside the 60s per-source timeout. Only 429 is retried;
 * 401/403 throw immediately as token/permission problems retry can't
 * fix.
 */
const MAX_RETRY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5_000;

/**
 * Thrown when HF rejects a request with 401/403/429. The scanner
 * orchestrator maps this specific class to the `denied` source
 * status via classify-error.ts, distinguishing rate-limit/auth
 * failures from generic network/5xx failures.
 */
export class HuggingFaceDeniedError extends Error {
  constructor(public readonly status: number) {
    super(`Hugging Face denied (${status})`);
    this.name = 'HuggingFaceDeniedError';
  }
}

/**
 * Internal surface tag carried on every SourceQuery so fetch and
 * normalize know which response shape to expect. Stripped from the
 * outgoing URL by `buildHuggingfaceUrl`.
 */
type Surface = 'models' | 'spaces' | 'daily_papers';

/** Raw model record from `/api/models`. */
type HfModel = {
  id: string;
  modelId?: string;
  author?: string;
  likes?: number;
  downloads?: number;
  trendingScore?: number;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  createdAt?: string;
  lastModified?: string;
  private?: boolean;
  gated?: boolean | string;
};

/** Raw space record from `/api/spaces`. */
type HfSpace = {
  id: string;
  author?: string;
  likes?: number;
  trendingScore?: number;
  sdk?: string;
  tags?: string[];
  createdAt?: string;
  lastModified?: string;
  cardData?: {
    title?: string;
    short_description?: string;
    sdk?: string;
    emoji?: string;
  };
  private?: boolean;
};

/** Raw daily-papers record (top-level wrapper around inner `paper`). */
type HfDailyPaper = {
  paper?: {
    id?: string;
    title?: string;
    summary?: string;
    publishedAt?: string;
    upvotes?: number;
    githubRepo?: string;
    githubStars?: number;
    ai_summary?: string;
    ai_keywords?: string[];
    organization?: { name?: string; fullname?: string };
  };
  numComments?: number;
  publishedAt?: string;
  title?: string;
};

/**
 * Decide whether a raw item from a given surface deserves to survive
 * pre-enrichment. Each surface has its own engagement floor so noise
 * is dropped before we spend LLM tokens on it.
 */
function passesEngagementFloor(surface: Surface, raw: unknown): boolean {
  if (surface === 'models') {
    const m = raw as HfModel;
    if (m.private === true) return false;
    if ((m.likes ?? 0) < MIN_MODEL_LIKES) return false;
    return true;
  }
  if (surface === 'spaces') {
    const s = raw as HfSpace;
    if (s.private === true) return false;
    if ((s.likes ?? 0) < MIN_SPACE_LIKES) return false;
    return true;
  }
  // Daily Papers are pre-curated — accept all.
  return true;
}

/**
 * Format a Date as YYYY-MM-DD for the Daily Papers `?date=` param.
 * UTC-aligned so tests with a fixed clock produce stable URLs.
 */
function formatHfDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pick up to N first non-empty keywords. Used to budget the model and
 * space search queries — falls back to `domain_tags` when the LLM did
 * not produce dedicated huggingface_keywords.
 */
function pickKeywordsForHf(plan: ExpandedQueryPlan, n: number): string[] {
  const primary = plan.huggingface_keywords.filter((k) => k.trim().length > 0);
  if (primary.length >= n) return primary.slice(0, n);
  const fallback = plan.domain_tags.filter((k) => k.trim().length > 0);
  const merged: string[] = [...primary];
  for (const kw of fallback) {
    if (merged.length >= n) break;
    if (!merged.some((m) => m.toLowerCase() === kw.toLowerCase())) merged.push(kw);
  }
  return merged.slice(0, n);
}

/**
 * Build params for ONE HF listing query (models or spaces). The
 * `_surface` and `_clock_iso` transport-only fields tell the URL
 * builder which endpoint to hit and the Daily Papers `_date` field
 * is unused here. Listing queries always sort by trendingScore so
 * fresh-and-popular results surface first.
 */
function buildListingParams(
  surface: Extract<Surface, 'models' | 'spaces'>,
  search: string,
): Record<string, unknown> {
  return {
    _surface: surface,
    search,
    sort: 'trendingScore',
    direction: '-1',
    limit: String(HF_LIMIT),
    full: 'true',
  };
}

/**
 * Build params for ONE Daily Papers query. The `_date` transport
 * field carries the YYYY-MM-DD slug used in the `?date=` param. The
 * listing IS the date — there is no `?search=` param on Daily Papers.
 *
 * Intentionally DOES NOT set a `sort` param. The 2026-04-24 run
 * surfaced that `sort=hot` + `date=YYYY-MM-DD` returns HTTP 400 — the
 * "hot" algorithm is only valid on the aggregate view without a
 * date filter. When `date` is specified the API already returns that
 * day's papers in a sensible order; any `sort` other than
 * `publishedAt` / `rising` / `new` causes a 400 that aborts all 7
 * daily-paper calls and marks the whole HF source as failed.
 */
function buildDailyPapersParams(date: string): Record<string, unknown> {
  return {
    _surface: 'daily_papers',
    _date: date,
    limit: String(HF_DAILY_PAPERS_LIMIT),
  };
}

/**
 * Plan the HF queries: 3 models + 3 spaces (keyword-driven) + 7 daily
 * papers (date-driven). Returns [] if no usable keywords AND domain
 * tags exist AND the founder's directive provides no signal — but in
 * practice domain_tags is always populated, so this is a defensive
 * guard not a real path.
 */
function planQueries(
  plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const keywords = pickKeywordsForHf(plan, MAX_KEYWORD_QUERIES_PER_SURFACE);
  const queries: SourceQuery[] = [];

  for (const kw of keywords) {
    queries.push({
      label: `hf-models: "${kw}"`,
      params: buildListingParams('models', kw),
    });
  }
  for (const kw of keywords) {
    queries.push({
      label: `hf-spaces: "${kw}"`,
      params: buildListingParams('spaces', kw),
    });
  }

  // Daily Papers: one request per of the last DAILY_PAPERS_DAYS days.
  // Date = today minus i days, formatted YYYY-MM-DD. The clock comes
  // from `new Date()` here; tests cannot inject it through this path
  // (planQueries signature is fixed), so test fixtures should use a
  // stable computed cutoff instead of asserting exact dates.
  const now = new Date();
  for (let i = 0; i < DAILY_PAPERS_DAYS; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const slug = formatHfDate(d);
    queries.push({
      label: `hf-papers: ${slug}`,
      params: buildDailyPapersParams(slug),
    });
  }

  return queries;
}

/**
 * Serialize a planned query into a fully-qualified .json URL. Routes
 * by `_surface` to one of three endpoints. Transport-only fields
 * starting with `_` are stripped. URL-encoding is delegated to
 * URLSearchParams.
 */
function buildHuggingfaceUrl(params: Record<string, unknown>): string {
  const surface = String(params._surface ?? 'models');
  const u =
    surface === 'daily_papers'
      ? new URL(`${HF_BASE_URL}/api/daily_papers`)
      : surface === 'spaces'
        ? new URL(`${HF_BASE_URL}/api/spaces`)
        : new URL(`${HF_BASE_URL}/api/models`);
  if (surface === 'daily_papers' && typeof params._date === 'string') {
    u.searchParams.set('date', String(params._date));
  }
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith('_')) continue;
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** Default sleep using setTimeout. Tests inject a no-op. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Compute the back-off sleep for retry attempt N (0-indexed). Reads
 * the `Retry-After` HTTP header when present (clamped to [1s, 5min])
 * and falls back to BACKOFF_BASE_MS × 2^attempt otherwise. Mirror
 * of Reddit's helper but with a smaller base (HF rate limits recover
 * fast).
 */
export function computeHfBackoffMs(
  attempt: number,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader !== null) {
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      const clamped = Math.min(Math.max(seconds, 1), 300);
      return clamped * 1000;
    }
  }
  return BACKOFF_BASE_MS * Math.pow(2, attempt);
}

/**
 * Assemble HTTP headers for every HF request. Adds `Authorization:
 * Bearer <token>` when `HF_TOKEN` is set in the environment, doubling
 * the rate-limit budget. Forwards `TECH_SCOUT_SCENARIO_HF` as
 * `x-test-scenario` so MSW handlers can route to pre-registered
 * fixtures during tests.
 */
function buildHuggingfaceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': process.env.HF_USER_AGENT ?? HF_USER_AGENT,
    Accept: 'application/json',
  };
  const token = process.env.HF_TOKEN;
  if (token && token.trim().length > 0) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  const scenario = process.env.TECH_SCOUT_SCENARIO_HF;
  if (scenario) headers['x-test-scenario'] = scenario;
  return headers;
}

/**
 * Execute one HF query with up to MAX_RETRY_ATTEMPTS retries on 429.
 * 401/403 throw immediately. 5xx and parse failures bubble up as
 * plain Errors so the caller's partial-success accounting can record
 * them.
 */
async function fetchOneWithRetry(
  url: string,
  headers: Record<string, string>,
  signal: FetchOpts['signal'],
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal, headers });
    if (res.status === 401 || res.status === 403) {
      throw new HuggingFaceDeniedError(res.status);
    }
    if (res.status !== 429) return res;
    if (attempt >= MAX_RETRY_ATTEMPTS) {
      throw new HuggingFaceDeniedError(429);
    }
    const retryAfter = res.headers.get('retry-after');
    await sleep(computeHfBackoffMs(attempt, retryAfter), signal ?? undefined);
  }
}

/**
 * Execute all planned HF queries sequentially, swallowing per-query
 * errors so one rate-limit failure doesn't discard earlier results.
 * Returns the flat list of RawItems, each tagged with the originating
 * surface so normalize() can route to the correct mapper.
 *
 * PARTIAL-SUCCESS HANDLING (arXiv pattern): if every query errors,
 * we rethrow the first error so the orchestrator can mark the source
 * as denied/failed. If at least one query returned items, we return
 * those and silently log the failures via warnings (left to the
 * scanner's outer machinery).
 */
export async function fetchQueries(
  queries: SourceQuery[],
  opts: FetchOpts,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = defaultSleep,
): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const headers = buildHuggingfaceHeaders();
  const errors: Error[] = [];

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(HF_SLEEP_MS, opts.signal ?? undefined);
    const q = queries[i];
    if (!q) continue;
    const url = buildHuggingfaceUrl(q.params);
    const surface = String(q.params._surface ?? 'models') as Surface;
    try {
      const res = await fetchOneWithRetry(url, headers, opts.signal, sleep);
      if (!res.ok) throw new Error(`huggingface ${res.status}`);
      const body = (await res.json()) as unknown;
      const items = extractItems(surface, body);
      for (const item of items) {
        if (!passesEngagementFloor(surface, item)) continue;
        out.push({ source: 'huggingface', data: { _surface: surface, raw: item } });
      }
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }

  if (out.length === 0 && errors.length > 0) {
    throw errors[0];
  }
  return out;
}

/**
 * Extract the items array from each surface's response shape. Models
 * and Spaces return a top-level array; Daily Papers also returns a
 * top-level array but wrapped at a different shape we consume in
 * normalize. This helper is only about shape — engagement filtering
 * happens in `passesEngagementFloor`.
 */
function extractItems(surface: Surface, body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  // Some HF endpoints wrap results in `{items: [...]}` or similar —
  // defensive fallback in case shape changes. Currently all three
  // surfaces return bare arrays.
  if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: unknown[] }).items;
  }
  void surface;
  return [];
}

/**
 * Convert a model record into a canonical Signal. Title is the
 * `id` (e.g. "Qwen/Qwen3.6-35B"), URL is the model's HF page,
 * snippet combines pipeline_tag + top tags + likes/downloads as a
 * compact engagement summary the enricher can score. Category is
 * `tech_capability` because models represent newly-shipped abilities.
 */
function normalizeModel(m: HfModel): Signal {
  const id = m.id;
  const url = `${HF_BASE_URL}/${id}`;
  const pipeline = m.pipeline_tag ?? 'unknown-task';
  const lib = m.library_name ?? 'unknown-lib';
  const downloads = m.downloads ?? 0;
  const likes = m.likes ?? 0;
  const trending = m.trendingScore ?? 0;
  const topTags = (m.tags ?? []).filter((t) => !t.includes(':')).slice(0, 5).join(', ');
  const snippet = `model ${pipeline} (${lib}); ${likes} likes, ${downloads} downloads, trending=${trending}${topTags ? `; tags: ${topTags}` : ''}`;
  const date = m.lastModified ?? m.createdAt ?? null;
  return {
    source: 'huggingface',
    title: id,
    url,
    date,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'tech_capability',
    raw: m,
  };
}

/**
 * Convert a space record into a canonical Signal. Spaces are live
 * demos so `category` = `product_launch` (the closest match in the
 * existing taxonomy). Title prefers `cardData.title` (human-friendly)
 * and falls back to `id`. URL points to the runnable demo page.
 */
function normalizeSpace(s: HfSpace): Signal {
  const id = s.id;
  const url = `${HF_BASE_URL}/spaces/${id}`;
  const title = s.cardData?.title?.trim() ? s.cardData.title : id;
  const description = s.cardData?.short_description ?? '';
  const sdk = s.sdk ?? s.cardData?.sdk ?? 'unknown-sdk';
  const likes = s.likes ?? 0;
  const trending = s.trendingScore ?? 0;
  const snippet = `space (${sdk}); ${likes} likes, trending=${trending}${description ? `; ${description}` : ''}`;
  const date = s.lastModified ?? s.createdAt ?? null;
  return {
    source: 'huggingface',
    title,
    url,
    date,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'product_launch',
    raw: s,
  };
}

/**
 * Convert a daily-papers record into a canonical Signal. The HF
 * Daily Papers feed pre-extracts `ai_summary` and `ai_keywords` for
 * every paper, so we get a clean snippet without an extra LLM call.
 * URL points to the HF paper page (which links to arXiv + GitHub).
 * Category is `research`.
 */
function normalizeDailyPaper(p: HfDailyPaper): Signal {
  const inner = p.paper ?? {};
  const id = inner.id ?? 'unknown';
  const title = (inner.title ?? p.title ?? id).trim();
  const url = `${HF_BASE_URL}/papers/${id}`;
  const rawSummary = (inner.ai_summary ?? inner.summary ?? '').replace(/\s+/g, ' ').trim();
  const summary = rawSummary.length > SNIPPET_MAX
    ? `${rawSummary.slice(0, SNIPPET_MAX)}…`
    : rawSummary;
  const upvotes = inner.upvotes ?? 0;
  const ghStars = inner.githubStars ?? 0;
  const org = inner.organization?.fullname ?? inner.organization?.name ?? 'unknown';
  const snippet = `paper from ${org}; ${upvotes} upvotes${ghStars ? `, ${ghStars} GitHub stars` : ''}${summary ? `. ${summary}` : ''}`;
  const date = inner.publishedAt ?? p.publishedAt ?? null;
  return {
    source: 'huggingface',
    title,
    url,
    date,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    snippet,
    category: 'research',
    raw: p,
  };
}

/**
 * Surface-aware normalize. Reads the transport-only `_surface` flag
 * the fetch loop attached to every RawItem and dispatches to the
 * matching mapper. Falls back to model normalization if the flag is
 * missing (defensive — should never happen since fetch sets it).
 */
function normalize(raw: RawItem): Signal {
  const wrapper = raw.data as { _surface?: Surface; raw: unknown };
  const surface: Surface = wrapper?._surface ?? 'models';
  if (surface === 'spaces') return normalizeSpace(wrapper.raw as HfSpace);
  if (surface === 'daily_papers') return normalizeDailyPaper(wrapper.raw as HfDailyPaper);
  return normalizeModel(wrapper.raw as HfModel);
}

/** Hugging Face adapter — queries 3 surfaces (models, spaces, papers). */
export const huggingfaceAdapter: SourceAdapter = {
  name: 'huggingface',
  planQueries,
  fetch: (queries, opts) => fetchQueries(queries, opts),
  normalize,
};
