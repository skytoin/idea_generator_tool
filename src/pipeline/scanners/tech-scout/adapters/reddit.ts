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
import { selectPainPhrases, expandPainPhrase } from '../reddit-pain-phrases';

/**
 * Reddit uses `.json` URL endpoints that return structured Listing
 * data without any OAuth or API key. The only requirements are a
 * descriptive User-Agent header (Reddit blocks generic/empty UAs)
 * and respectful pacing to stay under the ~10-requests-per-minute
 * unauthenticated limit. Compared to the OAuth flow, this pattern
 * removes ~40% of the adapter code (no token cache, no refresh
 * logic, no 401-retry) while still giving us every public post
 * field we need.
 */
const REDDIT_BASE_URL = 'https://www.reddit.com';

/**
 * Per-run query budget. Tier-1 plan: ONE cross-sub pain query that OR's
 * multiple base phrases (each expanded to variants) across multiple
 * subs in a single request, plus up to 3 per-sub topic queries. Total
 * = 4 requests, down from 6 in the pre-Tier-1 design — same recall
 * envelope at lower request cost.
 */
const TOPIC_QUERY_COUNT = 3;

/**
 * Number of distinct base pain phrases bundled into the single
 * cross-sub pain query. Each base expands to ~3-4 variants via
 * REDDIT_PAIN_PHRASE_VARIANTS, so 3 bases → ~9-12 OR'd phrases.
 * Capped to keep the URL well under Reddit's ~4kB practical limit
 * even when combined with the subreddit OR list.
 */
const PAIN_BASE_PHRASE_COUNT = 3;

/**
 * Maximum subreddits OR'd into the cross-sub pain query. Combined
 * with PAIN_BASE_PHRASE_COUNT × ~4 variants this stays well under
 * Reddit's URL length limit while covering the founder's whole
 * sub set. If `mergeAndDedupeSubs` produces more than this, we take
 * the first N (plan subs first, baseline tail).
 */
const MAX_CROSS_SUB_SUBS = 6;

/**
 * 6.1s between requests matches arXiv's pacing pattern and keeps us
 * just under Reddit's unauthenticated 10 req/min ceiling. Kept
 * slightly above the strict 6.0s minimum so clock skew doesn't
 * accidentally bunch two requests into the same second.
 */
const REDDIT_SLEEP_MS = 6100;

/**
 * Per-request limit. Reddit caps at 100; we use the maximum so each
 * request returns 4× the prior `25` baseline at zero extra cost. The
 * 10 QPM unauthenticated cap stops being painful once each request
 * delivers a full 100-item page.
 */
const DEFAULT_LIMIT = 100;

/**
 * Exponential back-off configuration for 429 (rate-limit) retries.
 * Reddit returns 429 when the rolling 10-minute QPM average is
 * exceeded. Reddit usually includes a `Retry-After` header (integer
 * seconds) telling us exactly how long to wait — when present we
 * honor it (clamped). When absent, we sleep BACKOFF_BASE_MS × 2^attempt
 * for at most MAX_RETRY_ATTEMPTS attempts before giving up on that
 * ONE query and continuing with the rest.
 *
 * The base / cap (5s × 2^attempt = 5/10/20s, sum 35s) is sized so the
 * worst-case retry budget per query stays under PER_SOURCE_TIMEOUT_MS
 * (60s in scanner.ts). Larger values cause withTimeout to mark the
 * source as `timeout` mid-retry, which in turn can push the whole
 * request past the browser's practical fetch tolerance. The sleep
 * helper also honors the abort signal so withTimeout's cancellation
 * propagates cleanly into back-off pauses.
 *
 * Only 429 is retried. 401/403 mean genuine auth/IP problems —
 * retrying just makes them worse, so those still throw immediately.
 */
const MAX_RETRY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5_000;

/**
 * Engagement floor applied per-post in fetch(). A Reddit post with
 * <5 net upvotes and <2 comments on a top-of-period search is
 * essentially noise — the subreddit community didn't engage. These
 * bars are LOWER than HN's (points>5, num_comments>3) because niche
 * subs have smaller populations; 5/2 on r/microsaas is meaningful
 * where the same numbers on r/programming would be floor-scraping.
 */
const MIN_SCORE = 5;
const MIN_COMMENTS = 2;

const SELFTEXT_SNIPPET_MAX = 200;

/**
 * Profile-agnostic baseline subs always merged into the per-run
 * plan. These are startup-universal and useful regardless of the
 * founder's domain — r/startups for general founder pain,
 * r/microsaas for indie-SaaS "I built X" posts, r/smallbusiness
 * for non-technical-founder pain the tech communities miss. When
 * the LLM planner emits its own subs, they take precedence in the
 * cycling order; baseline fills the tail.
 */
const BASELINE_SUBREDDITS: readonly string[] = [
  'startups',
  'microsaas',
  'smallbusiness',
] as const;

/**
 * Reddit's own sub naming rule: 3-21 characters, ASCII letters,
 * digits, or underscore. Enforced client-side so we never send a
 * request that will 404 — invalid sub names fail silently during
 * planQueries, not at fetch time where they'd poison the error
 * accounting.
 */
const SUBREDDIT_REGEX = /^[A-Za-z0-9_]{3,21}$/;

/**
 * User-Agent sent on every Reddit request. Reddit's docs require a
 * descriptive UA identifying the app and owner; requests with
 * generic axios/curl UAs are silently rate-limited harder or
 * blocked outright. Can be overridden via REDDIT_USER_AGENT when
 * operators want to include a Reddit username per the official
 * `<platform>:<app>:<version> (by /u/<user>)` convention.
 */
const DEFAULT_USER_AGENT =
  'idea-generator-tech-scout/1.0 (research scanner; https://github.com/skytoin/idea-generator)';

/**
 * Thrown when Reddit rejects a request with 401/403/429. The scanner
 * orchestrator maps this specific class to the `denied` source
 * status via classify-error.ts, distinguishing rate-limit/auth
 * failures from generic network/5xx failures.
 */
export class RedditDeniedError extends Error {
  constructor(public readonly status: number) {
    super(`Reddit denied (${status})`);
    this.name = 'RedditDeniedError';
  }
}

type RedditChild = { kind?: string; data?: RedditPost };
type RedditListing = {
  kind?: string;
  data?: {
    after?: string | null;
    before?: string | null;
    children?: RedditChild[];
  };
};

type RedditPost = {
  id: string;
  title: string;
  url?: string;
  permalink: string;
  created_utc: number;
  score?: number;
  num_comments?: number;
  author?: string;
  subreddit: string;
  selftext?: string;
  is_self?: boolean;
  over_18?: boolean;
  upvote_ratio?: number;
  link_flair_text?: string | null;
};

/**
 * Strip a leading `r/` or `/r/` (any case) so downstream validation
 * and URL building see just the bare sub name. Returns the trimmed
 * input verbatim when no prefix is present.
 */
function stripSubPrefix(s: string): string {
  return s.replace(/^\/?r\//i, '').trim();
}

/**
 * True when `s` matches Reddit's 3-21 character rule for sub
 * names. Callers use this to drop invalid entries before building
 * queries so a malformed LLM output can't take the whole adapter
 * down with repeated 404s.
 */
function isValidSubreddit(s: string): boolean {
  return SUBREDDIT_REGEX.test(s);
}

/**
 * Merge the LLM-picked subs with the profile-agnostic baseline,
 * drop invalid entries, and dedupe case-insensitively while
 * preserving the first-seen spelling. `fromPlan` is placed FIRST so
 * the founder-specific picks get the earliest query slots; baseline
 * fills the tail as a safety net when the plan list is short or
 * entirely invalid.
 */
export function mergeAndDedupeSubs(
  fromPlan: readonly string[],
  baseline: readonly string[] = BASELINE_SUBREDDITS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...fromPlan, ...baseline]) {
    const clean = stripSubPrefix(raw);
    if (!isValidSubreddit(clean)) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * Map a backward-looking timeframe into Reddit's coarse `t` param.
 * Reddit only accepts {hour,day,week,month,year,all}, so we pick
 * the narrowest bucket that still covers the requested window.
 * The scanner's post-process `filterByTimeframe` step re-enforces
 * the precise cutoff client-side — this coarse bucket just
 * controls how much Reddit returns before we trim.
 *
 * Negative diffs (future-dated timeframe, usually an LLM bug) fall
 * into the tightest bucket (`day`) so we don't accidentally pull
 * years of history when the intent was clearly "right now".
 */
export function timeframeToT(
  timeframeIso: string,
  now: Date,
): 'day' | 'week' | 'month' | 'year' | 'all' {
  const ts = new Date(timeframeIso).getTime();
  if (Number.isNaN(ts)) return 'all';
  const diffMs = now.getTime() - ts;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  if (diffMs <= 36 * HOUR) return 'day';
  if (diffMs <= 10 * DAY) return 'week';
  if (diffMs <= 45 * DAY) return 'month';
  if (diffMs <= 400 * DAY) return 'year';
  return 'all';
}

/**
 * Build the shared params block for one PER-SUB Reddit search query.
 * Every per-sub query asks for top-of-period within `t`, restricts to
 * the target sub via `restrict_sr=true`, requests raw-json (no HTML
 * entity escaping in text fields), and explicitly excludes NSFW at
 * the API level. The `_sub` transport field carries the subreddit
 * into the URL builder and is stripped before the request goes out;
 * `_endpoint='per_sub'` tells the URL builder to route to
 * `/r/{sub}/search.json` rather than the cross-sub endpoint.
 */
function buildPerSubParams(
  sub: string,
  q: string,
  t: string,
): Record<string, unknown> {
  return {
    _sub: sub,
    _endpoint: 'per_sub',
    q,
    restrict_sr: 'true',
    sort: 'top',
    t,
    limit: String(DEFAULT_LIMIT),
    include_over_18: 'false',
    raw_json: '1',
  };
}

/**
 * Build the params block for the CROSS-SUB pain query. Hits Reddit's
 * site-wide `/search.json` endpoint (no `/r/{sub}` prefix, no
 * `restrict_sr` since the OR'd `subreddit:` clauses already scope
 * the search). The `_endpoint='cross_sub'` transport flag tells the
 * URL builder to skip the per-sub URL pattern.
 */
function buildCrossSubParams(q: string, t: string): Record<string, unknown> {
  return {
    _endpoint: 'cross_sub',
    q,
    sort: 'top',
    t,
    limit: String(DEFAULT_LIMIT),
    include_over_18: 'false',
    raw_json: '1',
  };
}

/**
 * Build the OR-clause body for a cross-sub pain search. Joins the
 * provided phrases with ` OR `, wraps each multi-word phrase in
 * double quotes so Reddit treats them as exact phrases. Single-word
 * phrases stay unquoted (Reddit treats unquoted single tokens as
 * keyword searches, which is what we want).
 */
function buildOrPhraseClause(phrases: readonly string[]): string {
  const quoted = phrases.map((p) => (p.includes(' ') ? `"${p}"` : p));
  return quoted.join(' OR ');
}

/**
 * Build the OR-clause body for the subreddit filter on a cross-sub
 * pain search. Each sub becomes a `subreddit:<name>` clause and
 * they're OR'd together. The result is parenthesized by the caller
 * when combined with the phrase clause.
 */
function buildSubredditOrClause(subs: readonly string[]): string {
  return subs.map((s) => `subreddit:${s}`).join(' OR ');
}

/**
 * Compose the full `q` parameter for the cross-sub pain query:
 *   (subreddit:a OR subreddit:b) AND (phrase1 OR phrase2) AND self:yes AND nsfw:no
 *
 * `self:yes` filters to self-posts where pain articulation lives.
 * `nsfw:no` is a defense-in-depth alongside `include_over_18=false`.
 * Both AND/OR operators are uppercase per Reddit's search syntax.
 */
function buildCrossSubPainQ(subs: readonly string[], phrases: readonly string[]): string {
  const subClause = `(${buildSubredditOrClause(subs)})`;
  const phraseClause = `(${buildOrPhraseClause(phrases)})`;
  return `${subClause} AND ${phraseClause} AND self:yes AND nsfw:no`;
}

/**
 * Plan the Reddit queries as two strategies (Tier-1 design):
 *
 *   Slot 0 — ONE cross-sub PAIN query.
 *     Picks PAIN_BASE_PHRASE_COUNT base pain phrases from the
 *     profile-agnostic pool, expands each via expandPainPhrase()
 *     into ~3-4 OR'd variants, OR's the first MAX_CROSS_SUB_SUBS
 *     subreddits into a `subreddit:...` clause, and adds
 *     `self:yes` + `nsfw:no` filters. Hits Reddit's site-wide
 *     `/search.json` rather than `/r/{sub}/search.json`. One
 *     request replaces what used to be 3 per-sub pain queries.
 *
 *   Slots 1..TOPIC_QUERY_COUNT — TOPIC queries.
 *     Each reddit_keyword is decomposed to its first 2 content
 *     tokens (shared helper) and paired with the next sub in the
 *     cycle. Topic queries STAY per-sub because they often look
 *     for tool launches and link posts where `self:yes` would
 *     hurt recall.
 *
 * Empty `reddit_keywords` is OK — the cross-sub pain query still
 * runs alone. Empty `reddit_subreddits` is also fine because the
 * baseline sub set is always merged in. Returns [] only in the
 * unreachable case where mergeAndDedupeSubs produces no subs.
 */
function planQueries(
  plan: ExpandedQueryPlan,
  _directive: ScannerDirectives['tech_scout'],
): SourceQuery[] {
  const subs = mergeAndDedupeSubs(plan.reddit_subreddits ?? []);
  if (subs.length === 0) return [];
  const t = timeframeToT(plan.timeframe_iso, new Date());
  const queries: SourceQuery[] = [];

  const painQuery = buildPainQuery(subs, t);
  if (painQuery !== null) queries.push(painQuery);

  const topicSources = plan.reddit_keywords.slice(0, TOPIC_QUERY_COUNT);
  for (let j = 0; j < topicSources.length; j++) {
    const kw = decomposeKeywordToString(topicSources[j]!);
    if (kw.length === 0) continue;
    const sub = subs[j % subs.length]!;
    queries.push({
      label: `reddit: r/${sub} × ${kw}`,
      params: buildPerSubParams(sub, kw, t),
    });
  }

  return queries;
}

/**
 * Build the single cross-sub pain SourceQuery from the merged sub
 * list and timeframe bucket. Returns null if there are zero usable
 * pain phrases (the pain pool would have to be empty — currently
 * impossible — but we guard anyway). The label "reddit: cross-sub"
 * is recognizable in scanner reports as the OR'd query rather than
 * a per-sub one, so the debug UI can tell them apart.
 */
function buildPainQuery(subs: readonly string[], t: string): SourceQuery | null {
  const basePhrases = selectPainPhrases(PAIN_BASE_PHRASE_COUNT);
  if (basePhrases.length === 0) return null;
  const expandedPhrases = basePhrases.flatMap((b) => expandPainPhrase(b));
  const cappedSubs = subs.slice(0, MAX_CROSS_SUB_SUBS);
  const q = buildCrossSubPainQ(cappedSubs, expandedPhrases);
  return {
    label: `reddit: cross-sub × pain (${cappedSubs.length} subs, ${expandedPhrases.length} phrases)`,
    params: buildCrossSubParams(q, t),
  };
}

/**
 * Serialize a planned query into a fully-qualified .json URL. Routes
 * to either `/r/{sub}/search.json` (per-sub) or the site-wide
 * `/search.json` (cross-sub) based on the `_endpoint` transport
 * field. Both transport-only fields (`_sub`, `_endpoint`) are
 * stripped before the request goes out so they never appear in the
 * query string. URL-encoding (spaces → `+`, quotes → `%22`, etc.)
 * is delegated to URLSearchParams.
 */
function buildRedditUrl(params: Record<string, unknown>): string {
  const endpoint = String(params._endpoint ?? 'per_sub');
  const u =
    endpoint === 'cross_sub'
      ? new URL(`${REDDIT_BASE_URL}/search.json`)
      : new URL(`${REDDIT_BASE_URL}/r/${String(params._sub ?? '')}/search.json`);
  for (const [k, v] of Object.entries(params)) {
    if (k === '_sub' || k === '_endpoint') continue;
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * Default sleep implementation. Honors an optional abort signal so
 * the scanner's withTimeout wrapper can cancel an in-flight back-off
 * pause when the per-source budget elapses. Without this, a 30s+
 * back-off would orphan the adapter past its source-timeout
 * deadline, blocking the whole scan from finishing.
 *
 * Tests inject a no-op so unit tests finish in milliseconds rather
 * than waiting real wall-clock seconds.
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
 * Compute the back-off sleep for retry attempt N (0-indexed first
 * retry). When Reddit included a `Retry-After` header (integer
 * seconds), honor it verbatim — Reddit knows its own rate-limit
 * window better than we do. Otherwise fall back to exponential:
 * 30s, 60s, 120s. Header values are clamped to [1s, 5min] so a
 * misbehaving response can't park the scanner forever.
 */
export function computeBackoffMs(attempt: number, retryAfterHeader: string | null): number {
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
 * Execute ONE planned Reddit query with up to MAX_RETRY_ATTEMPTS
 * retries on 429. On 429 we read the `Retry-After` response header
 * (when present), sleep, and retry. 401/403 throw immediately as
 * RedditDeniedError because retrying just makes auth/IP issues
 * worse. After exhausting retries on persistent 429, throws
 * RedditDeniedError(429) so the caller can record the failure and
 * move on to other queries.
 *
 * Note: retry sleeps DO use the injected sleep fn so tests can
 * pass a no-op and finish in milliseconds. Production sleeps are
 * real wall-clock time.
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
      throw new RedditDeniedError(res.status);
    }
    if (res.status !== 429) return res;
    if (attempt >= MAX_RETRY_ATTEMPTS) {
      throw new RedditDeniedError(429);
    }
    const retryAfter = res.headers.get('retry-after');
    await sleep(computeBackoffMs(attempt, retryAfter), signal ?? undefined);
  }
}

/**
 * Filter, dedupe, and wrap one Reddit Listing's children into
 * RawItems. Drops posts that are NSFW or below the engagement
 * floor (MIN_SCORE / MIN_COMMENTS) so the scanner's enricher never
 * pays LLM tokens on noise the adapter could've cheaply dropped.
 */
function listingToRawItems(body: RedditListing): RawItem[] {
  const out: RawItem[] = [];
  const children = body?.data?.children ?? [];
  for (const child of children) {
    const p = child?.data;
    if (!p) continue;
    if (p.over_18 === true) continue;
    if ((p.score ?? 0) < MIN_SCORE) continue;
    if ((p.num_comments ?? 0) < MIN_COMMENTS) continue;
    out.push({ source: 'reddit', data: p });
  }
  return out;
}

/**
 * Execute the planned Reddit queries sequentially. Sleeps
 * REDDIT_SLEEP_MS between successive requests so the batch stays
 * under Reddit's 10-req/min unauthenticated ceiling. Each query
 * gets up to MAX_RETRY_ATTEMPTS retries on 429 with exponential
 * back-off (or `Retry-After` header when present), so a single
 * rate-limit hit no longer abandons subsequent queries.
 *
 * PARTIAL-SUCCESS HANDLING (arXiv pattern): per-query errors are
 * tracked but do not abort the loop. If every query errors we
 * rethrow the first error so the orchestrator can classify the
 * source; if at least one query returned posts we keep them and
 * swallow the errors. A mid-loop 429 (after retries exhausted)
 * shouldn't discard earlier successful pulls.
 *
 * 401/403 throw RedditDeniedError immediately (no retry — auth
 * failures don't get better with time). 429 retries up to
 * MAX_RETRY_ATTEMPTS times, then throws RedditDeniedError(429).
 * Other non-2xx codes and JSON parse failures become plain Errors
 * classified as `failed`.
 *
 * Test scenario routing: TECH_SCOUT_SCENARIO_REDDIT is forwarded as
 * `x-test-scenario` so MSW handlers can serve pre-registered
 * bodies. The sleep function is injectable so tests can pass a
 * no-op and finish in milliseconds.
 */
export async function fetchQueries(
  queries: SourceQuery[],
  opts: FetchOpts,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = defaultSleep,
): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const headers = buildRedditHeaders();
  const errors: Error[] = [];

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(REDDIT_SLEEP_MS, opts.signal ?? undefined);
    const q = queries[i];
    if (!q) continue;
    const url = buildRedditUrl(q.params);
    try {
      const res = await fetchOneWithRetry(url, headers, opts.signal, sleep);
      if (!res.ok) throw new Error(`reddit ${res.status}`);
      const body = (await res.json()) as RedditListing;
      out.push(...listingToRawItems(body));
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }

  if (out.length === 0 && errors.length > 0) {
    throw errors[0];
  }
  return out;
}

/** Assemble the fixed header set for every Reddit request. */
function buildRedditHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT,
    Accept: 'application/json',
  };
  const scenario = process.env.TECH_SCOUT_SCENARIO_REDDIT;
  if (scenario) headers['x-test-scenario'] = scenario;
  return headers;
}

/**
 * Convert a Reddit post record into a canonical Signal. The URL is
 * ALWAYS the Reddit permalink rather than the post's external `url`
 * field — permalinks dedupe reliably (one per Reddit thread) and
 * preserve the "this is Reddit discussion" semantic that the
 * enricher uses to weight the signal. External URLs belong to the
 * linked article, which would collapse cross-sub discussions of the
 * same link into one signal and lose the discussion context.
 *
 * Snippet layout mirrors HN's format: `r/{sub}: N upvotes, M
 * comments, by u/{author}` optionally followed by a 200-char
 * whitespace-collapsed excerpt of the post body. Category is
 * `adoption` because Reddit signals are community-engagement
 * indicators, not new-capability announcements (HN/arxiv territory).
 */
function normalize(raw: RawItem): Signal {
  const p = raw.data as RedditPost;
  const permalink = `${REDDIT_BASE_URL}${p.permalink}`;
  const selftext = (p.selftext ?? '').replace(/\s+/g, ' ').trim();
  const bodyTrim =
    selftext.length > SELFTEXT_SNIPPET_MAX
      ? `${selftext.slice(0, SELFTEXT_SNIPPET_MAX)}…`
      : selftext;
  const bodySuffix = bodyTrim ? `. ${bodyTrim}` : '';
  const author = p.author ?? 'unknown';
  const sub = p.subreddit ?? 'unknown';
  const score = p.score ?? 0;
  const comments = p.num_comments ?? 0;
  const createdSec = p.created_utc ?? 0;
  return {
    source: 'reddit',
    title: p.title,
    url: permalink,
    date: new Date(createdSec * 1000).toISOString(),
    snippet: `r/${sub}: ${score} upvotes, ${comments} comments, by u/${author}${bodySuffix}`,
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'adoption',
    raw: p,
  };
}

/** Reddit adapter — queries www.reddit.com/r/<sub>/search.json via OAuth-free .json endpoints. */
export const redditAdapter: SourceAdapter = {
  name: 'reddit',
  planQueries,
  fetch: (queries, opts) => fetchQueries(queries, opts),
  normalize,
};
