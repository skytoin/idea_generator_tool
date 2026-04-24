import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  redditAdapter,
  fetchQueries,
  RedditDeniedError,
  mergeAndDedupeSubs,
  timeframeToT,
  computeBackoffMs,
} from '../../../../../pipeline/scanners/tech-scout/adapters/reddit';
import {
  setRedditResponse,
  resetScannerMocks,
} from '../../../../mocks/scanner-mocks';
import { server } from '../../../../mocks/server';
import { SIGNAL_SCHEMA } from '../../../../../lib/types/signal';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
} from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';
import { REDDIT_PAIN_PHRASES } from '../../../../../pipeline/scanners/tech-scout/reddit-pain-phrases';

/** Build a minimum valid ExpandedQueryPlan for reddit adapter tests. */
function buildPlan(overrides: Partial<ExpandedQueryPlan> = {}): ExpandedQueryPlan {
  return {
    hn_keywords: ['fraud hn'],
    arxiv_keywords: ['fraud arxiv'],
    github_keywords: ['fraud github'],
    reddit_keywords: ['data collection', 'churn prediction', 'analytics dash'],
    huggingface_keywords: [],
    arxiv_categories: ['cs.LG'],
    github_languages: ['python'],
    reddit_subreddits: ['datascience', 'SaaS', 'Entrepreneur'],
    domain_tags: ['fintech'],
    timeframe_iso: '2026-01-11T12:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimum valid tech_scout directive for reddit adapter tests. */
function buildDirective(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: [],
    notes: '',
    target_sources: ['reddit'],
    timeframe: 'last 6 months',
  };
}

/** Build a canonical Reddit post record for normalize() tests. */
function buildPost(
  overrides: Partial<{
    id: string;
    title: string;
    url: string;
    permalink: string;
    created_utc: number;
    score: number | undefined;
    num_comments: number | undefined;
    author: string | undefined;
    subreddit: string;
    selftext: string | undefined;
    is_self: boolean;
    over_18: boolean;
    upvote_ratio: number;
    link_flair_text: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 'abc123',
    title: overrides.title ?? 'I would pay for a better analytics tool',
    url: overrides.url ?? 'https://www.reddit.com/r/SaaS/comments/abc123/foo/',
    permalink: overrides.permalink ?? '/r/SaaS/comments/abc123/foo/',
    created_utc: overrides.created_utc ?? 1_742_558_400,
    score: 'score' in overrides ? overrides.score : 42,
    num_comments: 'num_comments' in overrides ? overrides.num_comments : 12,
    author: 'author' in overrides ? overrides.author : 'alice',
    subreddit: overrides.subreddit ?? 'SaaS',
    selftext: 'selftext' in overrides ? overrides.selftext : 'Body of the post',
    is_self: overrides.is_self ?? true,
    over_18: overrides.over_18 ?? false,
    upvote_ratio: overrides.upvote_ratio ?? 0.95,
    link_flair_text: 'link_flair_text' in overrides ? overrides.link_flair_text : null,
  };
}

/** Wrap posts in the Listing envelope Reddit returns. */
function buildListing(posts: ReturnType<typeof buildPost>[]) {
  return {
    kind: 'Listing',
    data: {
      after: null,
      before: null,
      children: posts.map((p) => ({ kind: 't3', data: p })),
    },
  };
}

/** No-op sleep used across fetch tests so we don't wait 6s per call. */
const noSleep = (): Promise<void> => Promise.resolve();

// ────────────────────────────────────────────────────────────────────────────
// mergeAndDedupeSubs — pure helper
// ────────────────────────────────────────────────────────────────────────────

describe('mergeAndDedupeSubs', () => {
  it('places plan subs BEFORE baseline subs so founder-specific picks get earliest slots', () => {
    const out = mergeAndDedupeSubs(['datascience', 'SaaS']);
    const firstTwo = out.slice(0, 2);
    expect(firstTwo).toEqual(['datascience', 'SaaS']);
  });

  it('always appends the baseline subs when they are not already in the plan', () => {
    const out = mergeAndDedupeSubs(['datascience']);
    expect(out).toContain('startups');
    expect(out).toContain('microsaas');
    expect(out).toContain('smallbusiness');
  });

  it('strips leading "r/" and "/r/" (case-insensitive)', () => {
    const out = mergeAndDedupeSubs(['r/SaaS', '/R/DataScience', 'rust']);
    expect(out).toContain('SaaS');
    expect(out).toContain('DataScience');
    expect(out).toContain('rust');
    for (const s of out) {
      expect(s.startsWith('r/')).toBe(false);
      expect(s.startsWith('/')).toBe(false);
    }
  });

  it('drops invalid sub names (wrong chars, too short, too long)', () => {
    const out = mergeAndDedupeSubs([
      'sa', // 2 chars — too short for Reddit's 3-21 rule
      'this_is_way_too_long_for_reddit', // > 21
      'has spaces',
      'has-hyphen',
      'has.dot',
      'valid_sub',
    ]);
    expect(out).toContain('valid_sub');
    expect(out).not.toContain('sa');
    expect(out).not.toContain('has spaces');
    expect(out).not.toContain('has-hyphen');
    expect(out).not.toContain('has.dot');
    expect(out.every((s) => s.length <= 21 && s.length >= 3)).toBe(true);
  });

  it('dedupes case-insensitively preserving first-seen casing', () => {
    const out = mergeAndDedupeSubs(['SaaS', 'saas', 'SAAS']);
    const saasLike = out.filter((s) => s.toLowerCase() === 'saas');
    expect(saasLike).toHaveLength(1);
    expect(saasLike[0]).toBe('SaaS'); // first-seen case
  });

  it('deduplicates when a plan sub collides with a baseline sub', () => {
    // Plan picks 'startups' which also lives in baseline — output must
    // list it exactly once, in plan's position (first).
    const out = mergeAndDedupeSubs(['startups', 'datascience']);
    const starts = out.filter((s) => s.toLowerCase() === 'startups');
    expect(starts).toHaveLength(1);
    expect(out[0]).toBe('startups');
  });

  it('falls back to baseline-only when plan subs are all invalid', () => {
    const out = mergeAndDedupeSubs(['r/', '!!!', 'xx']);
    // The baseline is always valid, so output never crashes.
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out).toContain('startups');
  });

  it('falls back to baseline-only when fromPlan is empty', () => {
    const out = mergeAndDedupeSubs([]);
    expect(out).toEqual(['startups', 'microsaas', 'smallbusiness']);
  });

  it('accepts an injected baseline for testing (explicit second arg)', () => {
    // Passing [] as baseline yields plan subs only — used to pin the
    // "no baseline" edge case if someone ever empties the constant.
    const out = mergeAndDedupeSubs(['datascience'], []);
    expect(out).toEqual(['datascience']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// timeframeToT — pure helper
// ────────────────────────────────────────────────────────────────────────────

describe('timeframeToT', () => {
  const NOW = new Date('2026-04-22T00:00:00.000Z');

  it('returns "day" for a timeframe within the last 36 hours', () => {
    const twelveHoursAgo = new Date(NOW.getTime() - 12 * 3_600_000);
    expect(timeframeToT(twelveHoursAgo.toISOString(), NOW)).toBe('day');
  });

  it('returns "week" for a timeframe older than 36h but within 10 days', () => {
    const fiveDaysAgo = new Date(NOW.getTime() - 5 * 24 * 3_600_000);
    expect(timeframeToT(fiveDaysAgo.toISOString(), NOW)).toBe('week');
  });

  it('returns "month" for a timeframe older than 10 days but within 45', () => {
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * 24 * 3_600_000);
    expect(timeframeToT(thirtyDaysAgo.toISOString(), NOW)).toBe('month');
  });

  it('returns "year" for a timeframe older than 45 days but within 400', () => {
    const oneEightyDaysAgo = new Date(NOW.getTime() - 180 * 24 * 3_600_000);
    expect(timeframeToT(oneEightyDaysAgo.toISOString(), NOW)).toBe('year');
  });

  it('returns "all" for a timeframe older than 400 days', () => {
    const threeYearsAgo = new Date(NOW.getTime() - 3 * 365 * 24 * 3_600_000);
    expect(timeframeToT(threeYearsAgo.toISOString(), NOW)).toBe('all');
  });

  it('returns "day" for a future-dated timeframe (LLM hallucination safety)', () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 3_600_000);
    expect(timeframeToT(tomorrow.toISOString(), NOW)).toBe('day');
  });

  it('returns "all" for an unparseable timeframe string', () => {
    expect(timeframeToT('not-a-date', NOW)).toBe('all');
  });

  it('treats epoch-zero (pre-Unix) input as "all"', () => {
    // The scanner's timeframe parser falls back to epoch on unparseable
    // strings. That should map to "all" — show everything.
    expect(timeframeToT(new Date(0).toISOString(), NOW)).toBe('all');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// planQueries
// ────────────────────────────────────────────────────────────────────────────

describe('redditAdapter.planQueries — happy path (Tier-1)', () => {
  it('produces 4 queries by default: 1 cross-sub pain + 3 per-sub topic', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries).toHaveLength(4);
  });

  it('first query is the single cross-sub pain query (_endpoint=cross_sub)', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries[0]!.params._endpoint).toBe('cross_sub');
    expect(queries[0]!.params._sub).toBeUndefined();
  });

  it('cross-sub pain query OR\'s subreddit clauses, OR\'s phrase variants, adds self:yes and nsfw:no', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    const painQ = String(queries[0]!.params.q);
    expect(painQ).toContain('subreddit:');
    expect(painQ).toContain(' OR ');
    expect(painQ).toContain('self:yes');
    expect(painQ).toContain('nsfw:no');
    // At least one OR'd quoted pain phrase or its variant must appear.
    expect(painQ).toMatch(/"[^"]+"/);
  });

  it('cross-sub pain query expands base phrases into their variants (recall lift)', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    const painQ = String(queries[0]!.params.q);
    // "I would pay" base expands to include "would pay for" — both should be present.
    expect(painQ).toContain('"I would pay"');
    expect(painQ).toContain('"would pay for"');
  });

  it('topic queries (slots 1..3) are per-sub keyword searches with no quotes', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    const topicQueries = queries.slice(1);
    expect(topicQueries).toHaveLength(3);
    for (const q of topicQueries) {
      const qStr = String(q.params.q);
      expect(qStr).not.toContain('"');
      expect(qStr.length).toBeGreaterThan(0);
      expect(q.params._endpoint).toBe('per_sub');
      expect(typeof q.params._sub).toBe('string');
    }
  });

  it('topic queries decompose multi-word keywords to first 2 content tokens', () => {
    const plan = buildPlan({
      reddit_keywords: [
        'privacy-preserving data collection library',
        'open source ML model management',
        'inventory management for small retail shops',
      ],
    });
    const queries = redditAdapter.planQueries(plan, buildDirective());
    expect(String(queries[1]!.params.q).startsWith('privacy-preserving data')).toBe(
      true,
    );
    expect(String(queries[2]!.params.q).startsWith('open source')).toBe(true);
    expect(String(queries[3]!.params.q).startsWith('inventory management')).toBe(true);
  });

  it('every query (pain + topic) uses limit=100 (Tier-1 max-page lift)', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(q.params.limit).toBe('100');
    }
  });

  it('topic queries set restrict_sr=true, sort=top, include_over_18=false, raw_json=1', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    const topicQueries = queries.slice(1);
    for (const q of topicQueries) {
      expect(q.params.restrict_sr).toBe('true');
      expect(q.params.sort).toBe('top');
      expect(q.params.include_over_18).toBe('false');
      expect(q.params.raw_json).toBe('1');
    }
  });

  it('cross-sub pain query does NOT set restrict_sr (the OR\'d subreddit: clauses scope it)', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries[0]!.params.restrict_sr).toBeUndefined();
  });

  it('pain query label calls out cross-sub semantics; topic labels keep "reddit: r/<sub>" form', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries[0]!.label.startsWith('reddit: cross-sub')).toBe(true);
    for (const q of queries.slice(1)) {
      expect(q.label.startsWith('reddit: r/')).toBe(true);
      expect(q.label).toContain('×');
    }
  });

  it('REDDIT_PAIN_PHRASES base phrases are still drawn from the canonical pool', () => {
    // Sanity: the OR'd phrases inside the cross-sub query come from
    // REDDIT_PAIN_PHRASES (or their variants) — defends against future
    // regression where someone hardcodes a phrase outside the pool.
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    const painQ = String(queries[0]!.params.q);
    const anyPoolPhraseAppears = REDDIT_PAIN_PHRASES.some((p) => painQ.includes(`"${p}"`));
    expect(anyPoolPhraseAppears).toBe(true);
  });
});

describe('redditAdapter.planQueries — subreddit handling (Tier-1)', () => {
  it('cross-sub pain query OR\'s ALL merged subs (capped) into one subreddit clause', () => {
    const plan = buildPlan({
      reddit_subreddits: ['alpha_sub', 'beta_sub', 'gamma_sub'],
      // Baseline appends startups/microsaas/smallbusiness = 6 total subs.
    });
    const queries = redditAdapter.planQueries(plan, buildDirective());
    const painQ = String(queries[0]!.params.q);
    // All 6 merged subs should appear OR'd together (≤ MAX_CROSS_SUB_SUBS=6).
    expect(painQ).toContain('subreddit:alpha_sub');
    expect(painQ).toContain('subreddit:beta_sub');
    expect(painQ).toContain('subreddit:gamma_sub');
    expect(painQ).toContain('subreddit:startups');
  });

  it('topic queries cycle through merged subs by slot index (deterministic)', () => {
    const plan = buildPlan({
      reddit_subreddits: ['alpha_sub', 'beta_sub', 'gamma_sub'],
    });
    const queries = redditAdapter.planQueries(plan, buildDirective());
    const topicSubs = queries.slice(1).map((q) => String(q.params._sub));
    // 3 topic queries, 3 plan subs first → topic sub assignments are alpha/beta/gamma.
    expect(topicSubs[0]).toBe('alpha_sub');
    expect(topicSubs[1]).toBe('beta_sub');
    expect(topicSubs[2]).toBe('gamma_sub');
  });

  it('cross-sub pain query falls back to baseline subs when reddit_subreddits is empty', () => {
    const plan = buildPlan({ reddit_subreddits: [] });
    const queries = redditAdapter.planQueries(plan, buildDirective());
    const painQ = String(queries[0]!.params.q);
    expect(painQ).toContain('subreddit:startups');
    expect(painQ).toContain('subreddit:microsaas');
    expect(painQ).toContain('subreddit:smallbusiness');
  });

  it('cross-sub query caps subreddit count at MAX_CROSS_SUB_SUBS (URL length safety)', () => {
    const manySubs = Array.from({ length: 20 }, (_, i) => `sub${i}_xx`);
    const plan = buildPlan({ reddit_subreddits: manySubs });
    const queries = redditAdapter.planQueries(plan, buildDirective());
    const painQ = String(queries[0]!.params.q);
    const subClauseMatches = painQ.match(/subreddit:/g) ?? [];
    expect(subClauseMatches.length).toBeLessThanOrEqual(6);
  });

  it('does not duplicate subs in the cross-sub clause when plan/baseline overlap', () => {
    const plan = buildPlan({ reddit_subreddits: ['microsaas'] });
    const queries = redditAdapter.planQueries(plan, buildDirective());
    const painQ = String(queries[0]!.params.q);
    const microsaasMatches = painQ.match(/subreddit:microsaas/g) ?? [];
    expect(microsaasMatches.length).toBe(1);
  });
});

describe('redditAdapter.planQueries — edge cases (Tier-1)', () => {
  it('still emits the cross-sub pain query alone when reddit_keywords is empty', () => {
    const queries = redditAdapter.planQueries(
      buildPlan({ reddit_keywords: [] }),
      buildDirective(),
    );
    // Pain query is profile-universal — runs without topic kws.
    expect(queries).toHaveLength(1);
    expect(queries[0]!.params._endpoint).toBe('cross_sub');
  });

  it('emits pain query + topic queries proportional to reddit_keywords count', () => {
    const queries = redditAdapter.planQueries(
      buildPlan({ reddit_keywords: ['only one'] }),
      buildDirective(),
    );
    expect(queries).toHaveLength(2); // 1 pain + 1 topic
  });

  it('caps topic queries at TOPIC_QUERY_COUNT (3) even when reddit_keywords is long', () => {
    const many = Array.from({ length: 10 }, (_, i) => `topic ${i}`);
    const queries = redditAdapter.planQueries(
      buildPlan({ reddit_keywords: many }),
      buildDirective(),
    );
    expect(queries).toHaveLength(4); // 1 pain + 3 topic (capped)
  });

  it('drops a topic keyword that decomposes to empty (all stopwords)', () => {
    const queries = redditAdapter.planQueries(
      buildPlan({ reddit_keywords: ['for the and', 'real keyword', 'another kw'] }),
      buildDirective(),
    );
    // "for the and" is all stopwords → dropped; 2 topic queries survive + 1 pain.
    expect(queries).toHaveLength(3);
  });

  it('preserves uppercase acronym tokens verbatim in topic queries', () => {
    const queries = redditAdapter.planQueries(
      buildPlan({ reddit_keywords: ['MCP server alternatives'] }),
      buildDirective(),
    );
    // Slot 0 = pain query, slot 1 = first topic query.
    const topicQ = String(queries[1]!.params.q);
    expect(topicQ).toContain('MCP');
    expect(topicQ.startsWith('MCP server')).toBe(true);
  });

  it('still works when plan.reddit_subreddits contains "r/SaaS"-style prefixes', () => {
    const plan = buildPlan({
      reddit_subreddits: ['r/datascience', '/r/SaaS', 'Entrepreneur'],
    });
    const queries = redditAdapter.planQueries(plan, buildDirective());
    const painQ = String(queries[0]!.params.q);
    expect(painQ).toContain('subreddit:datascience');
    expect(painQ).toContain('subreddit:SaaS');
    expect(painQ).toContain('subreddit:Entrepreneur');
  });

  it('returns at least one query for any non-degenerate plan (baseline-driven)', () => {
    const queries = redditAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries.length).toBeGreaterThan(0);
  });

  it('maps the plan timeframe_iso through to Reddit\'s "t" param on every query', () => {
    // buildPlan uses 2026-01-11, tests run around 2026-04-22 → ~100d ago → year.
    const queries = redditAdapter.planQueries(
      buildPlan({ timeframe_iso: '2026-01-11T12:00:00.000Z' }),
      buildDirective(),
    );
    for (const q of queries) {
      expect(q.params.t).toBe('year');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch
// ────────────────────────────────────────────────────────────────────────────

describe('redditAdapter.fetch — headers', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('sends a User-Agent header on every request (Reddit blocks empty UAs)', async () => {
    const capturedHeaders: Record<string, string> = {};
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', ({ request }) => {
        request.headers.forEach((val, key) => {
          capturedHeaders[key.toLowerCase()] = val;
        });
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [
        {
          label: 'reddit: r/SaaS × "test"',
          params: {
            _sub: 'SaaS',
            q: '"test"',
            restrict_sr: 'true',
            sort: 'top',
            t: 'year',
            limit: '25',
            include_over_18: 'false',
            raw_json: '1',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedHeaders['user-agent']).toBeTruthy();
    expect(capturedHeaders['user-agent']!.length).toBeGreaterThan(10);
  });

  it('uses REDDIT_USER_AGENT env var when provided', async () => {
    vi.stubEnv('REDDIT_USER_AGENT', 'my-custom-ua/2.0 (by /u/test)');
    const capturedHeaders: Record<string, string> = {};
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', ({ request }) => {
        request.headers.forEach((val, key) => {
          capturedHeaders[key.toLowerCase()] = val;
        });
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [
        {
          label: 'reddit: r/SaaS × "test"',
          params: { _sub: 'SaaS', q: '"test"' },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedHeaders['user-agent']).toBe('my-custom-ua/2.0 (by /u/test)');
  });

  it('forwards x-test-scenario when TECH_SCOUT_SCENARIO_REDDIT is set', async () => {
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-smoke');
    const capturedHeaders: Record<string, string> = {};
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', ({ request }) => {
        request.headers.forEach((val, key) => {
          capturedHeaders[key.toLowerCase()] = val;
        });
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedHeaders['x-test-scenario']).toBe('reddit-smoke');
  });

  it('does NOT send x-test-scenario when the env var is unset', async () => {
    const capturedHeaders: Record<string, string> = {};
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', ({ request }) => {
        request.headers.forEach((val, key) => {
          capturedHeaders[key.toLowerCase()] = val;
        });
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedHeaders['x-test-scenario']).toBeUndefined();
  });
});

describe('redditAdapter.fetch — parsing and filtering', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('unwraps the Listing envelope and wraps each post as a RawItem', async () => {
    const p1 = buildPost({ id: 'a1', title: 'First' });
    const p2 = buildPost({ id: 'b2', title: 'Second' });
    setRedditResponse('reddit-two', buildListing([p1, p2]));
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-two');

    const items = await fetchQueries(
      [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(2);
    expect(items[0]!.source).toBe('reddit');
    expect((items[0]!.data as { id: string }).id).toBe('a1');
  });

  it('drops posts with over_18=true at source (never reaches the enricher)', async () => {
    const sfw = buildPost({ id: 'sfw', over_18: false });
    const nsfw = buildPost({ id: 'nsfw', over_18: true });
    setRedditResponse('reddit-nsfw', buildListing([sfw, nsfw]));
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-nsfw');

    const items = await fetchQueries(
      [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
    expect((items[0]!.data as { id: string }).id).toBe('sfw');
  });

  it('drops posts with score below MIN_SCORE (engagement floor)', async () => {
    const good = buildPost({ id: 'good', score: 10, num_comments: 5 });
    const tooLow = buildPost({ id: 'low', score: 1, num_comments: 5 });
    setRedditResponse('reddit-low-score', buildListing([good, tooLow]));
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-low-score');

    const items = await fetchQueries(
      [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
    expect((items[0]!.data as { id: string }).id).toBe('good');
  });

  it('drops posts with num_comments below MIN_COMMENTS', async () => {
    const good = buildPost({ id: 'good', score: 10, num_comments: 5 });
    const lonely = buildPost({ id: 'lonely', score: 10, num_comments: 0 });
    setRedditResponse('reddit-lonely', buildListing([good, lonely]));
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-lonely');

    const items = await fetchQueries(
      [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
    expect((items[0]!.data as { id: string }).id).toBe('good');
  });

  it('returns [] when the Listing has no children (valid empty response)', async () => {
    setRedditResponse('reddit-empty', buildListing([]));
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-empty');
    const items = await fetchQueries(
      [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toEqual([]);
  });

  it('handles a malformed Listing (missing data.children) without crashing', async () => {
    setRedditResponse('reddit-malformed', { kind: 'Listing', data: {} });
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-malformed');
    const items = await fetchQueries(
      [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toEqual([]);
  });
});

describe('redditAdapter.fetch — URL construction', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('builds /r/{sub}/search.json for per_sub queries with all non-transport params', async () => {
    let capturedUrl = '';
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [
        {
          label: 'reddit: r/datascience × test',
          params: {
            _sub: 'datascience',
            _endpoint: 'per_sub',
            q: 'data privacy',
            restrict_sr: 'true',
            sort: 'top',
            t: 'year',
            limit: '100',
            include_over_18: 'false',
            raw_json: '1',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedUrl).toContain('/r/datascience/search.json');
    expect(capturedUrl).toContain('restrict_sr=true');
    expect(capturedUrl).toContain('sort=top');
    expect(capturedUrl).toContain('t=year');
    expect(capturedUrl).toContain('limit=100');
    expect(capturedUrl).toContain('include_over_18=false');
    expect(capturedUrl).toContain('raw_json=1');
    // Transport-only fields must NOT leak into the query string.
    expect(capturedUrl).not.toContain('_sub=');
    expect(capturedUrl).not.toContain('_endpoint=');
  });

  it('builds the site-wide /search.json (no /r/ prefix) for cross_sub queries', async () => {
    let capturedUrl = '';
    server.use(
      http.get('https://www.reddit.com/search.json', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [
        {
          label: 'reddit: cross-sub × pain',
          params: {
            _endpoint: 'cross_sub',
            q: '(subreddit:SaaS OR subreddit:datascience) AND ("I would pay")',
            sort: 'top',
            t: 'year',
            limit: '100',
            include_over_18: 'false',
            raw_json: '1',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    // Must hit the site-wide search.json, NOT /r/something/search.json.
    expect(capturedUrl).toMatch(/reddit\.com\/search\.json/);
    expect(capturedUrl).not.toMatch(/\/r\/[^\/]+\/search\.json/);
    // restrict_sr is intentionally NOT set on cross-sub queries.
    expect(capturedUrl).not.toContain('restrict_sr');
    expect(capturedUrl).not.toContain('_endpoint=');
  });

  it('URL-encodes the quoted phrase q param correctly (per_sub)', async () => {
    let capturedUrl = '';
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [
        {
          label: 'reddit: r/SaaS × "I would pay"',
          params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"I would pay"' },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    // Encoded: %22 for ", + or %20 for space. Both valid per URL spec.
    expect(capturedUrl).toMatch(/q=%22I[+%20]would[+%20]pay%22/);
  });
});

describe('redditAdapter.fetch — error classification', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('throws RedditDeniedError(429) AFTER exhausting retry attempts on persistent 429', async () => {
    // Persistent 429: retry budget burns through (no Retry-After header
    // forces back-off path), then RedditDeniedError(429) bubbles up.
    setRedditResponse('reddit-429', { __denied: 429 });
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-429');
    await expect(
      fetchQueries(
        [
          {
            label: 'reddit: r/SaaS × "test"',
            params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"test"' },
          },
        ],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'RedditDeniedError', status: 429 });
  });

  it('throws RedditDeniedError(403) when Reddit responds with 403', async () => {
    setRedditResponse('reddit-403', { __denied: 403 });
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-403');
    await expect(
      fetchQueries(
        [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'RedditDeniedError', status: 403 });
  });

  it('throws RedditDeniedError(401) when Reddit responds with 401', async () => {
    setRedditResponse('reddit-401', { __denied: 401 });
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-401');
    await expect(
      fetchQueries(
        [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'RedditDeniedError', status: 401 });
  });

  it('throws a plain Error (not RedditDeniedError) on 5xx', async () => {
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () =>
        HttpResponse.json({ message: 'boom' }, { status: 503 }),
      ),
    );
    let caught: unknown;
    try {
      await fetchQueries(
        [{ label: 'reddit: r/SaaS × "test"', params: { _sub: 'SaaS', q: '"test"' } }],
        { timeoutMs: 10_000 },
        noSleep,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(RedditDeniedError);
    expect(String(caught)).toContain('503');
  });

  it('throws a plain Error on 404 (e.g., nonexistent sub)', async () => {
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 }),
      ),
    );
    let caught: unknown;
    try {
      await fetchQueries(
        [
          {
            label: 'reddit: r/fakeSubXYZ × "test"',
            params: { _sub: 'fakeSubXYZ', q: '"test"' },
          },
        ],
        { timeoutMs: 10_000 },
        noSleep,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(RedditDeniedError);
    expect(String(caught)).toContain('404');
  });
});

describe('redditAdapter.fetch — back-off retry on 429 (Tier-1)', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('retries when Reddit responds 429 once, then succeeds — returns the recovered post', async () => {
    let callCount = 0;
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () => {
        callCount++;
        if (callCount === 1) {
          return new HttpResponse(JSON.stringify({ message: 'rate limited' }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        }
        return HttpResponse.json(buildListing([buildPost({ id: 'recovered' })]));
      }),
    );
    const items = await fetchQueries(
      [
        {
          label: 'q1',
          params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"a"' },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(callCount).toBe(2); // first 429 + successful retry
    expect(items).toHaveLength(1);
    expect((items[0]!.data as { id: string }).id).toBe('recovered');
  });

  it('honors the Retry-After header when present (uses it for sleep duration)', async () => {
    let callCount = 0;
    const sleepCalls: number[] = [];
    const trackedSleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () => {
        callCount++;
        if (callCount === 1) {
          return new HttpResponse(JSON.stringify({ message: 'rate limited' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '5' },
          });
        }
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [
        {
          label: 'q1',
          params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"a"' },
        },
      ],
      { timeoutMs: 10_000 },
      trackedSleep,
    );
    // First sleep call is the 429 back-off; should equal 5s (header value).
    expect(sleepCalls[0]).toBe(5_000);
  });

  it('falls back to exponential back-off when Retry-After is missing (5s, 10s, 20s — sized to fit per-source 60s timeout)', async () => {
    let callCount = 0;
    const sleepCalls: number[] = [];
    const trackedSleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () => {
        callCount++;
        if (callCount <= 3) {
          return new HttpResponse(JSON.stringify({ message: 'rate limited' }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        }
        return HttpResponse.json(buildListing([]));
      }),
    );
    await fetchQueries(
      [
        {
          label: 'q1',
          params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"a"' },
        },
      ],
      { timeoutMs: 10_000 },
      trackedSleep,
    );
    // 3 retries = 3 back-off sleeps (no inter-query sleep since only 1 query).
    // 5s × 2^attempt = 5s, 10s, 20s — sums to 35s, fits inside the 60s
    // PER_SOURCE_TIMEOUT_MS budget so withTimeout doesn't truncate retries.
    expect(sleepCalls).toEqual([5_000, 10_000, 20_000]);
  });

  it('caps retries at MAX_RETRY_ATTEMPTS (3); throws RedditDeniedError(429) after', async () => {
    let callCount = 0;
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () => {
        callCount++;
        return new HttpResponse(JSON.stringify({ message: 'rate limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    await expect(
      fetchQueries(
        [
          {
            label: 'q1',
            params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"a"' },
          },
        ],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'RedditDeniedError', status: 429 });
    // 1 initial attempt + 3 retries = 4 total fetch calls.
    expect(callCount).toBe(4);
  });

  it('does NOT retry on 401 — throws RedditDeniedError(401) immediately', async () => {
    let callCount = 0;
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () => {
        callCount++;
        return new HttpResponse(JSON.stringify({ message: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    await expect(
      fetchQueries(
        [
          {
            label: 'q1',
            params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"a"' },
          },
        ],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'RedditDeniedError', status: 401 });
    expect(callCount).toBe(1); // no retry attempts
  });

  it('does NOT retry on 403 — throws RedditDeniedError(403) immediately', async () => {
    let callCount = 0;
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () => {
        callCount++;
        return new HttpResponse(JSON.stringify({ message: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    await expect(
      fetchQueries(
        [
          {
            label: 'q1',
            params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"a"' },
          },
        ],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'RedditDeniedError', status: 403 });
    expect(callCount).toBe(1);
  });

  it('preserves partial-success: one query exhausts retries, others still succeed', async () => {
    // Q1 hits permanent 429, Q2 succeeds. Q1 burns its retry budget then
    // fails; we keep Q2's posts and swallow Q1's RedditDeniedError.
    let q1Calls = 0;
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', ({ params }) => {
        if (params.sub === 'SaaS') {
          q1Calls++;
          return new HttpResponse(JSON.stringify({ message: 'rate limited' }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        }
        return HttpResponse.json(buildListing([buildPost({ id: 'q2_post' })]));
      }),
    );
    const items = await fetchQueries(
      [
        { label: 'q1', params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"a"' } },
        { label: 'q2', params: { _sub: 'datascience', _endpoint: 'per_sub', q: '"b"' } },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(q1Calls).toBe(4); // 1 + 3 retries
    expect(items).toHaveLength(1);
    expect((items[0]!.data as { id: string }).id).toBe('q2_post');
  });
});

describe('redditAdapter.fetch — abort-aware sleep (Tier-1 hot-fix)', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('forwards opts.signal into the inter-query sleep so withTimeout can cancel mid-pause', async () => {
    const sleepCalls: Array<{ ms: number; hadSignal: boolean }> = [];
    const recordingSleep = (ms: number, signal?: AbortSignal): Promise<void> => {
      sleepCalls.push({ ms, hadSignal: signal !== undefined });
      return Promise.resolve();
    };
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () =>
        HttpResponse.json(buildListing([])),
      ),
    );
    const controller = new AbortController();
    await fetchQueries(
      [
        { label: 'q1', params: { _sub: 'SaaS', _endpoint: 'per_sub', q: '"a"' } },
        { label: 'q2', params: { _sub: 'datascience', _endpoint: 'per_sub', q: '"b"' } },
      ],
      { timeoutMs: 10_000, signal: controller.signal },
      recordingSleep,
    );
    // One inter-query sleep between q1 and q2; it MUST receive the signal.
    expect(sleepCalls).toHaveLength(1);
    expect(sleepCalls[0]!.hadSignal).toBe(true);
  });
});

describe('computeBackoffMs (Tier-1 helper)', () => {
  it('uses Retry-After header value verbatim when valid (in seconds → ms)', () => {
    expect(computeBackoffMs(0, '7')).toBe(7_000);
    expect(computeBackoffMs(2, '60')).toBe(60_000);
  });

  it('falls back to 5s × 2^attempt when Retry-After is null', () => {
    expect(computeBackoffMs(0, null)).toBe(5_000);
    expect(computeBackoffMs(1, null)).toBe(10_000);
    expect(computeBackoffMs(2, null)).toBe(20_000);
  });

  it('falls back to exponential when Retry-After is malformed', () => {
    expect(computeBackoffMs(0, 'not-a-number')).toBe(5_000);
    expect(computeBackoffMs(0, '')).toBe(5_000);
    expect(computeBackoffMs(0, '-5')).toBe(5_000);
  });

  it('clamps an absurdly large Retry-After to 5 minutes', () => {
    expect(computeBackoffMs(0, '999999')).toBe(300_000);
  });

  it('clamps a sub-second Retry-After to 1 second minimum', () => {
    expect(computeBackoffMs(0, '0')).toBe(5_000); // 0 is treated as invalid → fallback
    expect(computeBackoffMs(0, '1')).toBe(1_000);
  });
});

describe('redditAdapter.fetch — partial-success pattern', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('returns partial results when ONE query fails mid-loop and others succeed', async () => {
    const goodPost = buildPost({ id: 'good', title: 'Good post' });
    const goodListing = buildListing([goodPost]);
    let callCount = 0;
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () => {
        callCount++;
        if (callCount === 2) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(goodListing);
      }),
    );
    const items = await fetchQueries(
      [
        { label: 'q1', params: { _sub: 'SaaS', q: '"a"' } },
        { label: 'q2', params: { _sub: 'datascience', q: '"b"' } },
        { label: 'q3', params: { _sub: 'Entrepreneur', q: '"c"' } },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    // Queries 1 and 3 succeeded → 2 posts survive; query 2 error swallowed.
    expect(items).toHaveLength(2);
  });

  it('throws the first error when EVERY query fails (no items returned)', async () => {
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    await expect(
      fetchQueries(
        [
          { label: 'q1', params: { _sub: 'SaaS', q: '"a"' } },
          { label: 'q2', params: { _sub: 'datascience', q: '"b"' } },
        ],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toThrow(/500/);
  });

  it('preserves the RedditDeniedError when a 429 is the first error in an all-fail batch', async () => {
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () =>
        HttpResponse.json({ message: 'denied' }, { status: 429 }),
      ),
    );
    await expect(
      fetchQueries(
        [{ label: 'q1', params: { _sub: 'SaaS', q: '"a"' } }],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'RedditDeniedError', status: 429 });
  });
});

describe('redditAdapter.fetch — sleep pacing', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('does NOT sleep before the first request (only between requests)', async () => {
    const sleepCalls: number[] = [];
    const trackedSleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () =>
        HttpResponse.json(buildListing([buildPost()])),
      ),
    );
    await fetchQueries(
      [{ label: 'q1', params: { _sub: 'SaaS', q: '"a"' } }],
      { timeoutMs: 10_000 },
      trackedSleep,
    );
    expect(sleepCalls).toEqual([]);
  });

  it('sleeps N-1 times for N queries (between, not before)', async () => {
    const sleepCalls: number[] = [];
    const trackedSleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };
    server.use(
      http.get('https://www.reddit.com/r/:sub/search.json', () =>
        HttpResponse.json(buildListing([buildPost()])),
      ),
    );
    await fetchQueries(
      [
        { label: 'q1', params: { _sub: 'SaaS', q: '"a"' } },
        { label: 'q2', params: { _sub: 'datascience', q: '"b"' } },
        { label: 'q3', params: { _sub: 'Entrepreneur', q: '"c"' } },
      ],
      { timeoutMs: 10_000 },
      trackedSleep,
    );
    expect(sleepCalls).toHaveLength(2);
    for (const ms of sleepCalls) expect(ms).toBeGreaterThanOrEqual(6_000);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// normalize
// ────────────────────────────────────────────────────────────────────────────

describe('redditAdapter.normalize', () => {
  it('converts a self-post into a canonical Signal with permalink URL', () => {
    const post = buildPost({
      permalink: '/r/SaaS/comments/abc123/my_post_title/',
      title: 'Wish there was a better tool',
      subreddit: 'SaaS',
      score: 87,
      num_comments: 34,
      author: 'alice',
      selftext: 'Has anyone found a good alternative to X?',
      created_utc: 1_742_558_400,
      is_self: true,
    });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    expect(signal.source).toBe('reddit');
    expect(signal.title).toBe('Wish there was a better tool');
    expect(signal.url).toBe(
      'https://www.reddit.com/r/SaaS/comments/abc123/my_post_title/',
    );
    expect(signal.snippet).toContain('r/SaaS');
    expect(signal.snippet).toContain('87 upvotes');
    expect(signal.snippet).toContain('34 comments');
    expect(signal.snippet).toContain('u/alice');
    expect(signal.snippet).toContain('Has anyone found a good alternative to X');
    expect(signal.category).toBe('adoption');
  });

  it('always uses permalink (NEVER external p.url) even for link posts', () => {
    const post = buildPost({
      permalink: '/r/programming/comments/xyz/link_post/',
      url: 'https://external-blog.example.com/article',
      is_self: false,
      selftext: '',
    });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    expect(signal.url).toBe(
      'https://www.reddit.com/r/programming/comments/xyz/link_post/',
    );
    expect(signal.url).not.toContain('external-blog');
  });

  it('truncates a long selftext at 200 chars with a trailing ellipsis', () => {
    const long = 'x'.repeat(500);
    const post = buildPost({ selftext: long });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    expect(signal.snippet).toContain('…');
    expect(signal.snippet.split('…')[0]!.length).toBeGreaterThanOrEqual(200);
    // Overall snippet is prefix + 200 chars + ellipsis, much less than 500.
    expect(signal.snippet.length).toBeLessThan(500);
  });

  it('collapses internal whitespace in selftext (newlines, tabs, multiple spaces)', () => {
    const messy = 'first line\n\n\tsecond   line\r\n   third';
    const post = buildPost({ selftext: messy });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    expect(signal.snippet).toContain('first line second line third');
    expect(signal.snippet).not.toContain('\n');
    expect(signal.snippet).not.toContain('\t');
  });

  it('omits the body suffix when selftext is empty', () => {
    const post = buildPost({ selftext: '' });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    // The snippet ends cleanly at "by u/<author>" with no trailing ". ...".
    expect(signal.snippet).toMatch(/by u\/\w+$/);
  });

  it('omits the body suffix when selftext is undefined', () => {
    const post = buildPost({ selftext: undefined });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    expect(signal.snippet).toMatch(/by u\/\w+$/);
  });

  it('renders "unknown" for a null/undefined author (deleted user)', () => {
    const post = buildPost({ author: undefined });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    expect(signal.snippet).toContain('u/unknown');
  });

  it('converts created_utc (seconds) to an ISO datetime string', () => {
    const post = buildPost({ created_utc: 1_742_558_400 });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    // 1742558400 = 2025-03-21T12:00:00.000Z
    expect(signal.date).toBe('2025-03-21T12:00:00.000Z');
  });

  it('produces a Signal that passes SIGNAL_SCHEMA validation', () => {
    const post = buildPost();
    const raw: RawItem = { source: 'reddit', data: post };
    const signal = redditAdapter.normalize(raw);
    const parsed = SIGNAL_SCHEMA.safeParse(signal);
    expect(parsed.success).toBe(true);
  });

  it('handles missing score / num_comments gracefully (treats as 0)', () => {
    const post = buildPost({ score: undefined, num_comments: undefined });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    expect(signal.snippet).toContain('0 upvotes');
    expect(signal.snippet).toContain('0 comments');
  });

  it('preserves the raw post on the signal for debugging', () => {
    const post = buildPost({ id: 'xyz' });
    const signal = redditAdapter.normalize({ source: 'reddit', data: post });
    expect(signal.raw).toBe(post);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// RedditDeniedError class
// ────────────────────────────────────────────────────────────────────────────

describe('RedditDeniedError class', () => {
  it('has name "RedditDeniedError" and carries status', () => {
    const err = new RedditDeniedError(429);
    expect(err.name).toBe('RedditDeniedError');
    expect(err.status).toBe(429);
  });

  it('is an instance of both RedditDeniedError and Error', () => {
    const err = new RedditDeniedError(403);
    expect(err).toBeInstanceOf(RedditDeniedError);
    expect(err).toBeInstanceOf(Error);
  });

  it('includes the status in the message', () => {
    const err = new RedditDeniedError(401);
    expect(err.message).toContain('401');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// adapter interface
// ────────────────────────────────────────────────────────────────────────────

describe('redditAdapter interface', () => {
  it('exports name "reddit"', () => {
    expect(redditAdapter.name).toBe('reddit');
  });

  it('conforms to the SourceAdapter interface (type check)', () => {
    const _typed: SourceAdapter = redditAdapter;
    expect(_typed).toBe(redditAdapter);
  });

  it('plan → fetch → normalize chain runs end-to-end for the happy path', async () => {
    const post = buildPost({ id: 'e2e', title: 'End-to-end post' });
    setRedditResponse('reddit-e2e', buildListing([post]));
    vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-e2e');

    const queries: SourceQuery[] = redditAdapter.planQueries(
      buildPlan(),
      buildDirective(),
    );
    const raws = await fetchQueries(
      queries.slice(0, 1),
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(raws).toHaveLength(1);
    const signal = redditAdapter.normalize(raws[0]!);
    expect(signal.source).toBe('reddit');
    expect(signal.title).toBe('End-to-end post');

    resetScannerMocks();
    vi.unstubAllEnvs();
  });
});
