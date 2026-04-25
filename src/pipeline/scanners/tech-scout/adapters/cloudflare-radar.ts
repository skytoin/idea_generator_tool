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
 * Cloudflare Radar REST API. Cloudflare sees ~20% of all internet
 * traffic, so Radar exposes deployment-truth signals nothing else
 * gives us:
 *   - Trending domains (rank surges in last 7 days)
 *   - AI bot crawler share (real adoption per AI product)
 *   - Top services per category (LLM / Cloud / Email / etc.)
 *
 * AUTH: Bearer token, free, requires `CLOUDFLARE_RADAR_TOKEN` env var.
 * If unset the adapter returns [] gracefully (mark source ok_empty)
 * rather than crashing — this lets the rest of the scanner continue
 * for users who haven't set up Cloudflare yet.
 *
 * RATE LIMIT: ~1200 req / 5 min globally per user (cumulative across
 * ALL Cloudflare APIs). We use ~7 per scan = trivially under budget.
 *
 * LICENSE: Data is CC BY-NC 4.0 (non-commercial). Same risk model as
 * Reddit — fine for personal R&D, would need negotiation if we ever
 * commercialize. Documented in docs/tech-scout-sources.md.
 */
const RADAR_BASE_URL = 'https://api.cloudflare.com/client/v4/radar';

/** Identifies the scanner so Cloudflare can attribute traffic. */
const RADAR_USER_AGENT =
  'idea-generator-tech-scout/1.0 (research scanner; https://github.com/skytoin/idea-generator)';

/**
 * Polite spacing between requests. Cloudflare's 1200 req / 5min is
 * generous (= 4 req/sec sustained); 200ms keeps us at 5 req/sec but
 * we only fire 7 per pass so the rate is moot. Tests inject no-op.
 */
const RADAR_SLEEP_MS = 200;

/**
 * Per-request `limit` for trending-domain queries. We pull 50 then
 * client-side filter by `pctRankChange` so only meaningful surges
 * (≥20% rank change) survive. Internet-services queries use a
 * tighter limit (10) because the long tail isn't useful.
 */
const TRENDING_DOMAIN_LIMIT = 50;
const SERVICE_TOP_LIMIT = 10;

/**
 * Engagement-floor thresholds. A domain with <20% rank change is
 * statistical noise; an AI bot with <1% share is too small to act on.
 * These cuts happen client-side AFTER the API returns, before signals
 * enter the scanner's per-source cap.
 */
const MIN_PCT_RANK_CHANGE = 20;
const MIN_AI_BOT_SHARE_PCT = 1.0;

/**
 * Internet-service categories we query each scan. Hand-picked for the
 * "data collection + ML SaaS" founder profile and the broader
 * idea-generation use case. Each category becomes one API request.
 * Cloudflare's category enum is large; these five give the highest
 * idea-generation value per request.
 */
const SERVICE_CATEGORIES = [
  'Generative AI',
  'Email',
  'Cloud',
  'Search',
  'Social Media',
] as const;

/**
 * Date range used for all time-windowed queries. 7d matches the
 * Trending Domains weekly refresh and gives a clean "this week's
 * surges" snapshot. Hard-coded because date selection is not yet
 * founder-tunable.
 */
const RADAR_DATE_RANGE = '7d';

/**
 * Exponential back-off for 429 retries. Mirror of HF's setup —
 * Cloudflare returns standard 429 + RateLimit headers. Honor
 * `Retry-After` when present, fall back to 5s × 2^attempt with
 * 3 max retries (35s total per query, fits the 60s per-source budget).
 */
const MAX_RETRY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5_000;

/**
 * Thrown when Cloudflare rejects a request with 401/403/429 (after
 * retries). Maps to `denied` source status via classify-error.ts.
 */
export class CloudflareRadarDeniedError extends Error {
  constructor(public readonly status: number) {
    super(`Cloudflare Radar denied (${status})`);
    this.name = 'CloudflareRadarDeniedError';
  }
}

/**
 * Internal surface tag carried on every SourceQuery so fetch and
 * normalize know which response shape to expect. Stripped from the
 * outgoing URL by `buildRadarUrl`.
 */
type Surface =
  | 'trending_rise'
  | 'trending_steady'
  | 'service_top'
  | 'ai_bot_user_agent'
  | 'ai_bot_content_type';

/** Standard Cloudflare API response envelope. */
type RadarResponse = {
  success?: boolean;
  errors?: unknown[];
  result?: {
    meta?: { dateRange?: unknown; lastUpdated?: string };
    top_0?: unknown[];
    summary_0?: Record<string, string | number>;
  };
};

/** Trending-domain row inside `result.top_0`. */
type TrendingDomain = {
  domain?: string;
  rank?: number;
  pctRankChange?: number;
  categories?: Array<{ id?: number; name?: string; superCategoryId?: number }>;
};

/** Internet-service row inside `result.top_0`. */
type ServiceRow = {
  service?: string;
  rank?: number;
};

/**
 * Build params for ONE trending-domains query. The `_surface` flag
 * carries the rankingType-specific normalization hint into fetch().
 */
function buildTrendingParams(
  rankingType: 'TRENDING_RISE' | 'TRENDING_STEADY',
): Record<string, unknown> {
  return {
    _surface: rankingType === 'TRENDING_RISE' ? 'trending_rise' : 'trending_steady',
    _path: '/ranking/top',
    rankingType,
    limit: String(TRENDING_DOMAIN_LIMIT),
    dateRange: RADAR_DATE_RANGE,
    format: 'JSON',
  };
}

/**
 * Build params for ONE internet-services-top query. The `_category`
 * transport field carries the category name into the URL builder so
 * it can populate `serviceCategory=` correctly.
 */
function buildServiceParams(category: string): Record<string, unknown> {
  return {
    _surface: 'service_top',
    _path: '/ranking/internet_services/top',
    _category: category,
    limit: String(SERVICE_TOP_LIMIT),
    dateRange: RADAR_DATE_RANGE,
    format: 'JSON',
  };
}

/**
 * Build params for the AI-bots user-agent breakdown query. Returns
 * the share of AI bot traffic per crawler product (GPTBot,
 * ClaudeBot, PerplexityBot, etc.) — the "AI product adoption
 * leaderboard" signal.
 */
function buildAiBotUserAgentParams(): Record<string, unknown> {
  return {
    _surface: 'ai_bot_user_agent',
    _path: '/ai/bots/summary/user_agent',
    dateRange: RADAR_DATE_RANGE,
    format: 'JSON',
  };
}

/**
 * Build params for the AI-bots content-type breakdown query.
 * Reveals what content (HTML/JSON/PDF/...) AI bots prioritize.
 */
function buildAiBotContentTypeParams(): Record<string, unknown> {
  return {
    _surface: 'ai_bot_content_type',
    _path: '/ai/bots/summary/content_type',
    dateRange: RADAR_DATE_RANGE,
    format: 'JSON',
  };
}

/**
 * Plan the fixed set of Radar queries (Cloudflare doesn't take
 * keywords — its surfaces are aggregate-statistic endpoints). 7
 * queries total: 2 trending-domain views + 3-5 service-category
 * tops + 2 AI-bot breakdowns.
 *
 * `plan` and `_directive` are unused at present — Radar's queries
 * don't depend on the founder's keywords. We accept them anyway to
 * satisfy the SourceAdapter interface and keep the option open for
 * later founder-aware filtering (e.g., adding a service category
 * derived from `domain_tags`).
 */
function planQueries(
  _plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const queries: SourceQuery[] = [];

  queries.push({
    label: 'cf-radar: trending rise',
    params: buildTrendingParams('TRENDING_RISE'),
  });
  queries.push({
    label: 'cf-radar: trending steady',
    params: buildTrendingParams('TRENDING_STEADY'),
  });

  for (const category of SERVICE_CATEGORIES) {
    queries.push({
      label: `cf-radar: services × ${category}`,
      params: buildServiceParams(category),
    });
  }

  queries.push({
    label: 'cf-radar: ai-bots user_agent',
    params: buildAiBotUserAgentParams(),
  });
  queries.push({
    label: 'cf-radar: ai-bots content_type',
    params: buildAiBotContentTypeParams(),
  });

  return queries;
}

/**
 * Serialize a planned query into a Radar URL. Routes by `_path`
 * transport field. The `_category` (services) is mapped to the
 * `serviceCategory` query param. All `_*` transport fields are
 * stripped before the URL goes out.
 */
function buildRadarUrl(params: Record<string, unknown>): string {
  const path = String(params._path ?? '/ranking/top');
  const u = new URL(`${RADAR_BASE_URL}${path}`);
  if (typeof params._category === 'string') {
    u.searchParams.set('serviceCategory', String(params._category));
  }
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith('_')) continue;
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * Default sleep that honors an optional abort signal. Built in from
 * day one (HF's adapter learned this lesson the hard way) so when
 * `withTimeout` aborts the source mid-loop, the sleep cancels
 * immediately rather than orphaning the adapter past its deadline.
 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('aborted_during_sleep'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal !== undefined) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('aborted_during_sleep'));
        },
        { once: true },
      );
    }
  });
}

/**
 * Compute back-off ms for retry attempt N. Honors `Retry-After`
 * header (clamped 1s-5min), falls back to 5s × 2^attempt.
 */
export function computeRadarBackoffMs(
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
 * Build HTTP headers for every Radar request. Token is required —
 * unlike Hugging Face which has an anonymous tier, Radar always
 * needs a Bearer token. `buildHeadersOrNull` returns null when the
 * token is missing so fetchQueries can skip cleanly.
 *
 * Forwards `TECH_SCOUT_SCENARIO_CLOUDFLARE` as `x-test-scenario` so
 * MSW can route to pre-registered fixtures during tests.
 */
function buildHeadersOrNull(): Record<string, string> | null {
  const token = process.env.CLOUDFLARE_RADAR_TOKEN;
  if (!token || token.trim().length === 0) return null;
  const headers: Record<string, string> = {
    'User-Agent': process.env.RADAR_USER_AGENT ?? RADAR_USER_AGENT,
    Accept: 'application/json',
    Authorization: `Bearer ${token.trim()}`,
  };
  const scenario = process.env.TECH_SCOUT_SCENARIO_CLOUDFLARE;
  if (scenario) headers['x-test-scenario'] = scenario;
  return headers;
}

/**
 * Execute one Radar query with up to MAX_RETRY_ATTEMPTS retries on
 * 429. 401/403 throw immediately as auth failures; retrying just
 * makes them worse. After exhausting retries on persistent 429,
 * throws CloudflareRadarDeniedError(429).
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
      throw new CloudflareRadarDeniedError(res.status);
    }
    if (res.status !== 429) return res;
    if (attempt >= MAX_RETRY_ATTEMPTS) {
      throw new CloudflareRadarDeniedError(429);
    }
    const retryAfter = res.headers.get('retry-after');
    await sleep(computeRadarBackoffMs(attempt, retryAfter), signal ?? undefined);
  }
}

/**
 * Execute the planned queries sequentially. When the
 * `CLOUDFLARE_RADAR_TOKEN` env var is unset, returns [] without
 * making any HTTP calls — the source then surfaces as `ok_empty` in
 * the report so the user sees a clear "set up your token" hint
 * without breaking the rest of the scanner.
 *
 * PARTIAL-SUCCESS HANDLING (arXiv pattern): per-query errors are
 * tracked but do not abort the loop. If every query errors we
 * rethrow the first error so the orchestrator marks the source as
 * denied/failed. If at least one query returned items we keep them.
 */
export async function fetchQueries(
  queries: SourceQuery[],
  opts: FetchOpts,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = defaultSleep,
): Promise<RawItem[]> {
  const headers = buildHeadersOrNull();
  if (headers === null) {
    // Token missing — degrade gracefully. Source will be marked
    // ok_empty by the orchestrator's status logic since signals = 0
    // and no error was thrown.
    return [];
  }

  const out: RawItem[] = [];
  const errors: Error[] = [];

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(RADAR_SLEEP_MS, opts.signal ?? undefined);
    const q = queries[i];
    if (!q) continue;
    const url = buildRadarUrl(q.params);
    const surface = String(q.params._surface ?? 'trending_rise') as Surface;
    const category =
      typeof q.params._category === 'string' ? String(q.params._category) : undefined;
    try {
      const res = await fetchOneWithRetry(url, headers, opts.signal, sleep);
      if (!res.ok) throw new Error(`cloudflare ${res.status}`);
      const body = (await res.json()) as RadarResponse;
      const items = extractItems(surface, body, category);
      for (const item of items) out.push(item);
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
 * Extract RawItems from a Radar response, applying surface-specific
 * shape extraction AND engagement floors. Each surface has its own
 * filter policy:
 *   - trending_rise/steady: drop pctRankChange < 20% (noise)
 *   - service_top: keep all (already top-N capped at API level)
 *   - ai_bot_user_agent: drop entries with < 1% share
 *   - ai_bot_content_type: emit one summary signal (not per-row)
 *
 * Returns RawItem[] tagged with `_surface` so normalize() can route
 * to the correct mapper.
 */
function extractItems(
  surface: Surface,
  body: RadarResponse,
  category: string | undefined,
): RawItem[] {
  const lastUpdated = body.result?.meta?.lastUpdated ?? null;

  if (surface === 'trending_rise' || surface === 'trending_steady') {
    const rows = (body.result?.top_0 ?? []) as TrendingDomain[];
    return rows
      .filter((r) => Math.abs(r.pctRankChange ?? 0) >= MIN_PCT_RANK_CHANGE)
      .map((r) => ({
        source: 'cloudflare',
        data: { _surface: surface, raw: r, lastUpdated },
      }));
  }

  if (surface === 'service_top') {
    const rows = (body.result?.top_0 ?? []) as ServiceRow[];
    return rows.map((r) => ({
      source: 'cloudflare',
      data: { _surface: surface, raw: r, category, lastUpdated },
    }));
  }

  if (surface === 'ai_bot_user_agent') {
    const summary = (body.result?.summary_0 ?? {}) as Record<string, string | number>;
    return Object.entries(summary)
      .map(([userAgent, share]) => ({
        userAgent,
        share: typeof share === 'string' ? Number.parseFloat(share) : share,
      }))
      .filter((r) => Number.isFinite(r.share) && r.share >= MIN_AI_BOT_SHARE_PCT)
      .map((r) => ({
        source: 'cloudflare',
        data: { _surface: surface, raw: r, lastUpdated },
      }));
  }

  if (surface === 'ai_bot_content_type') {
    const summary = (body.result?.summary_0 ?? {}) as Record<string, string | number>;
    if (Object.keys(summary).length === 0) return [];
    // Emit ONE summary signal rather than one-per-content-type — the
    // breakdown is more useful as a single artifact than as 4-5
    // micro-signals competing for slots.
    return [
      {
        source: 'cloudflare',
        data: { _surface: surface, raw: { summary }, lastUpdated },
      },
    ];
  }

  return [];
}

/**
 * Convert a trending-domain row into a Signal. URL is the domain
 * itself so the user can click straight to it. Category mapping:
 * `adoption` because trending = community is gravitating toward this.
 */
function normalizeTrendingDomain(
  raw: TrendingDomain,
  surface: 'trending_rise' | 'trending_steady',
  lastUpdated: string | null,
): Signal {
  const domain = raw.domain ?? 'unknown';
  const rank = raw.rank ?? 0;
  const pct = raw.pctRankChange ?? 0;
  const cats = (raw.categories ?? [])
    .map((c) => c.name)
    .filter((n): n is string => typeof n === 'string')
    .slice(0, 3)
    .join(', ');
  const trendType = surface === 'trending_rise' ? 'surging' : 'compounding';
  const direction = pct >= 0 ? '+' : '';
  const title = `${domain} ${trendType} on Cloudflare (rank #${rank}, ${direction}${pct}% week)`;
  const snippet =
    `Trending domain on Cloudflare Radar (1.1.1.1 DNS data). ` +
    `Rank #${rank}, ${direction}${pct}% week-over-week.` +
    (cats ? ` Categories: ${cats}.` : '');
  return {
    source: 'cloudflare',
    title,
    url: `https://${domain}`,
    date: lastUpdated,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'adoption',
    raw,
  };
}

/**
 * Convert an internet-services row into a Signal. URL points to the
 * Radar dashboard for that service category since there's no
 * canonical service URL.
 */
function normalizeServiceRow(
  raw: ServiceRow,
  category: string | undefined,
  lastUpdated: string | null,
): Signal {
  const service = raw.service ?? 'unknown';
  const rank = raw.rank ?? 0;
  const cat = category ?? 'service';
  const title = `${service} #${rank} in ${cat} on Cloudflare Radar`;
  const snippet =
    `${service} ranks #${rank} in the ${cat} category on Cloudflare Radar — ` +
    `real traffic share, useful as competitive landscape signal.`;
  return {
    source: 'cloudflare',
    title,
    url: `https://radar.cloudflare.com/services`,
    date: lastUpdated,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'adoption',
    raw,
  };
}

/**
 * Convert an AI-bot user-agent row into a Signal. Each crawler's
 * traffic share becomes one signal — direct adoption data nothing
 * else surfaces ("PerplexityBot at 12% means Perplexity is gaining
 * real-world reach").
 */
function normalizeAiBotUserAgent(
  raw: { userAgent: string; share: number },
  lastUpdated: string | null,
): Signal {
  const ua = raw.userAgent;
  const share = raw.share.toFixed(1);
  const title = `${ua} at ${share}% of AI bot traffic (Cloudflare Radar, last 7d)`;
  const snippet =
    `Cloudflare Radar shows ${ua} at ${share}% of AI bot traffic this week. ` +
    `Direct adoption signal — share trend reveals which AI products are gaining real-world reach.`;
  return {
    source: 'cloudflare',
    title,
    url: 'https://radar.cloudflare.com/ai-insights',
    date: lastUpdated,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'adoption',
    raw,
  };
}

/**
 * Convert the AI-bot content-type breakdown into a single summary
 * Signal. Reveals what content AI crawlers prioritize ("AI bots
 * crawl 45% HTML, 28% JSON, 15% PDFs") — an underused leading
 * indicator of where the next wave of AI products will pull data.
 */
function normalizeAiBotContentType(
  raw: { summary: Record<string, string | number> },
  lastUpdated: string | null,
): Signal {
  const breakdown = Object.entries(raw.summary)
    .map(([type, share]) => {
      const pct = typeof share === 'string' ? Number.parseFloat(share) : share;
      return { type, pct: Number.isFinite(pct) ? pct : 0 };
    })
    .filter((r) => r.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)
    .map((r) => `${r.type} ${r.pct.toFixed(1)}%`)
    .join(', ');
  const title = `AI bot content-type breakdown: ${breakdown.split(', ').slice(0, 2).join(', ')}…`;
  const snippet =
    `Cloudflare Radar AI bot content-type breakdown (last 7d): ${breakdown}. ` +
    `Reveals what content AI crawlers prioritize — leading indicator for next-wave AI product targeting.`;
  return {
    source: 'cloudflare',
    title,
    url: 'https://radar.cloudflare.com/ai-insights',
    date: lastUpdated,
    snippet,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'adoption',
    raw,
  };
}

/**
 * Surface-aware normalize. Reads the transport-only `_surface` flag
 * the fetch loop attached to every RawItem and dispatches to the
 * matching mapper. Falls back to the trending-rise mapper if the
 * flag is missing (defensive — should never happen since fetch sets
 * it on every item).
 */
function normalize(raw: RawItem): Signal {
  const wrapper = raw.data as {
    _surface?: Surface;
    raw: unknown;
    category?: string;
    lastUpdated?: string | null;
  };
  const surface: Surface = wrapper?._surface ?? 'trending_rise';
  const lastUpdated = wrapper?.lastUpdated ?? null;
  if (surface === 'service_top') {
    return normalizeServiceRow(
      wrapper.raw as ServiceRow,
      wrapper.category,
      lastUpdated,
    );
  }
  if (surface === 'ai_bot_user_agent') {
    return normalizeAiBotUserAgent(
      wrapper.raw as { userAgent: string; share: number },
      lastUpdated,
    );
  }
  if (surface === 'ai_bot_content_type') {
    return normalizeAiBotContentType(
      wrapper.raw as { summary: Record<string, string | number> },
      lastUpdated,
    );
  }
  return normalizeTrendingDomain(wrapper.raw as TrendingDomain, surface, lastUpdated);
}

/**
 * Cloudflare Radar adapter — queries 5 surfaces (trending domains
 * × 2, services × N, AI bots × 2). Adapter name matches the
 * `signal.source` field on every emitted Signal (= 'cloudflare') so
 * the conformance test passes and no alias mapping is needed in
 * scanner.ts (the directive alias 'cloudflare' resolves directly).
 */
export const cloudflareRadarAdapter: SourceAdapter = {
  name: 'cloudflare',
  planQueries,
  fetch: (queries, opts) => fetchQueries(queries, opts),
  normalize,
};
