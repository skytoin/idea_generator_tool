import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  cloudflareRadarAdapter,
  fetchQueries,
  computeRadarBackoffMs,
  CloudflareRadarDeniedError,
} from '../../../../../pipeline/scanners/tech-scout/adapters/cloudflare-radar';
import {
  setCloudflareRadarResponse,
  resetScannerMocks,
} from '../../../../mocks/scanner-mocks';
import { server } from '../../../../mocks/server';
import { SIGNAL_SCHEMA } from '../../../../../lib/types/signal';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  RawItem,
} from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';

/** Minimum valid plan for the adapter — Radar doesn't use keywords. */
function buildPlan(overrides: Partial<ExpandedQueryPlan> = {}): ExpandedQueryPlan {
  return {
    hn_keywords: ['x'],
    arxiv_keywords: ['x'],
    github_keywords: ['x'],
    reddit_keywords: ['x'],
    huggingface_keywords: [],
    arxiv_categories: [],
    github_languages: [],
    reddit_subreddits: [],
    domain_tags: ['fintech'],
    timeframe_iso: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildDirective(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: [],
    notes: '',
    target_sources: ['cloudflare'],
    timeframe: 'last 6 months',
  };
}

/** Build a Radar trending-domain row matching the live response shape. */
function buildTrending(
  overrides: Partial<{
    domain: string;
    rank: number;
    pctRankChange: number;
    categories: Array<{ id: number; name: string; superCategoryId: number }>;
  }> = {},
) {
  return {
    domain: overrides.domain ?? 'perplexity.ai',
    rank: overrides.rank ?? 200,
    pctRankChange: overrides.pctRankChange ?? 75,
    categories: overrides.categories ?? [
      { id: 1, name: 'AI / Chatbot', superCategoryId: 0 },
    ],
  };
}

/** Build a Radar internet-services-top row. */
function buildService(
  overrides: Partial<{ service: string; rank: number }> = {},
) {
  return {
    service: overrides.service ?? 'OpenAI',
    rank: overrides.rank ?? 1,
  };
}

/** Build a full Radar API response envelope. */
function buildEnvelope(
  result:
    | { top_0: unknown[] }
    | { summary_0: Record<string, string | number> }
    | Record<string, unknown>,
) {
  return {
    success: true,
    errors: [],
    result: {
      meta: {
        dateRange: { startTime: '2026-04-18T00:00:00Z', endTime: '2026-04-25T00:00:00Z' },
        lastUpdated: '2026-04-25T00:00:00Z',
      },
      ...result,
    },
  };
}

const noSleep = (): Promise<void> => Promise.resolve();
const TOKEN = 'cf_test_token_xxx';

// ────────────────────────────────────────────────────────────────────────────
// planQueries
// ────────────────────────────────────────────────────────────────────────────

describe('cloudflareRadarAdapter.planQueries', () => {
  it('emits exactly 9 queries: 2 trending + 5 services + 2 ai-bots', () => {
    const queries = cloudflareRadarAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries).toHaveLength(9);
    expect(queries.filter((q) => q.label.startsWith('cf-radar: trending'))).toHaveLength(2);
    expect(queries.filter((q) => q.label.startsWith('cf-radar: services'))).toHaveLength(5);
    expect(queries.filter((q) => q.label.startsWith('cf-radar: ai-bots'))).toHaveLength(2);
  });

  it('trending queries use rankingType TRENDING_RISE and TRENDING_STEADY', () => {
    const queries = cloudflareRadarAdapter.planQueries(buildPlan(), buildDirective());
    const ranks = queries
      .filter((q) => String(q.params._surface).startsWith('trending_'))
      .map((q) => q.params.rankingType);
    expect(ranks).toContain('TRENDING_RISE');
    expect(ranks).toContain('TRENDING_STEADY');
  });

  it('service queries carry _category transport field with the category name', () => {
    const queries = cloudflareRadarAdapter.planQueries(buildPlan(), buildDirective());
    const services = queries.filter((q) => String(q.params._surface) === 'service_top');
    for (const s of services) {
      expect(typeof s.params._category).toBe('string');
      expect(String(s.params._category).length).toBeGreaterThan(0);
    }
  });

  it('every query carries _surface and _path transport fields', () => {
    const queries = cloudflareRadarAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(typeof q.params._surface).toBe('string');
      expect(typeof q.params._path).toBe('string');
      expect(String(q.params._path).startsWith('/')).toBe(true);
    }
  });

  it('every query sets dateRange=7d and format=JSON', () => {
    const queries = cloudflareRadarAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(q.params.dateRange).toBe('7d');
      expect(q.params.format).toBe('JSON');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — auth gating
// ────────────────────────────────────────────────────────────────────────────

describe('cloudflareRadarAdapter.fetch — auth gating', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('returns [] without making any HTTP calls when CLOUDFLARE_RADAR_TOKEN is unset', async () => {
    let callCount = 0;
    server.use(
      http.get('https://api.cloudflare.com/client/v4/radar/ranking/top', () => {
        callCount++;
        return HttpResponse.json(buildEnvelope({ top_0: [buildTrending()] }));
      }),
    );
    const items = await fetchQueries(
      [
        {
          label: 'q',
          params: { _surface: 'trending_rise', _path: '/ranking/top' },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toEqual([]);
    expect(callCount).toBe(0);
  });

  it('sends Authorization: Bearer <token> when CLOUDFLARE_RADAR_TOKEN is set', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    const captured: Record<string, string> = {};
    server.use(
      http.get('https://api.cloudflare.com/client/v4/radar/ranking/top', ({ request }) => {
        request.headers.forEach((v, k) => {
          captured[k.toLowerCase()] = v;
        });
        return HttpResponse.json(buildEnvelope({ top_0: [] }));
      }),
    );
    await fetchQueries(
      [{ label: 'q', params: { _surface: 'trending_rise', _path: '/ranking/top' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(captured.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('treats whitespace-only token as missing (returns [])', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '   ');
    let callCount = 0;
    server.use(
      http.get('https://api.cloudflare.com/client/v4/radar/ranking/top', () => {
        callCount++;
        return HttpResponse.json(buildEnvelope({ top_0: [] }));
      }),
    );
    const items = await fetchQueries(
      [{ label: 'q', params: { _surface: 'trending_rise', _path: '/ranking/top' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toEqual([]);
    expect(callCount).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — URL construction
// ────────────────────────────────────────────────────────────────────────────

describe('cloudflareRadarAdapter.fetch — URL construction', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('routes to /ranking/top with rankingType in query string (strips _surface/_path)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    let capturedUrl = '';
    server.use(
      http.get(
        'https://api.cloudflare.com/client/v4/radar/ranking/top',
        ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(buildEnvelope({ top_0: [] }));
        },
      ),
    );
    await fetchQueries(
      [
        {
          label: 'q',
          params: {
            _surface: 'trending_rise',
            _path: '/ranking/top',
            rankingType: 'TRENDING_RISE',
            limit: '50',
            dateRange: '7d',
            format: 'JSON',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedUrl).toContain('/ranking/top');
    expect(capturedUrl).toContain('rankingType=TRENDING_RISE');
    expect(capturedUrl).toContain('limit=50');
    expect(capturedUrl).toContain('dateRange=7d');
    expect(capturedUrl).not.toContain('_surface');
    expect(capturedUrl).not.toContain('_path');
  });

  it('routes service queries with serviceCategory= built from _category transport field', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    let capturedUrl = '';
    server.use(
      http.get(
        'https://api.cloudflare.com/client/v4/radar/ranking/internet_services/top',
        ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(buildEnvelope({ top_0: [] }));
        },
      ),
    );
    await fetchQueries(
      [
        {
          label: 'q',
          params: {
            _surface: 'service_top',
            _path: '/ranking/internet_services/top',
            _category: 'Generative AI',
            limit: '10',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedUrl).toContain('/ranking/internet_services/top');
    // Spaces in the category get URL-encoded.
    expect(capturedUrl).toMatch(/serviceCategory=Generative[+%20]AI/);
    expect(capturedUrl).not.toContain('_category');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — response parsing & engagement floor
// ────────────────────────────────────────────────────────────────────────────

describe('cloudflareRadarAdapter.fetch — parsing & engagement floor', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('parses trending domains and tags items with _surface=trending_rise', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    setCloudflareRadarResponse(
      'cf-trend',
      buildEnvelope({
        top_0: [
          buildTrending({ domain: 'a.com', pctRankChange: 50 }),
          buildTrending({ domain: 'b.com', pctRankChange: 30 }),
        ],
      }),
    );
    vi.stubEnv('TECH_SCOUT_SCENARIO_CLOUDFLARE', 'cf-trend');
    const items = await fetchQueries(
      [
        {
          label: 'q',
          params: { _surface: 'trending_rise', _path: '/ranking/top' },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.source).toBe('cloudflare');
      expect((item.data as { _surface: string })._surface).toBe('trending_rise');
    }
  });

  it('drops trending domains with pctRankChange below MIN_PCT_RANK_CHANGE (20%)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    setCloudflareRadarResponse(
      'cf-low',
      buildEnvelope({
        top_0: [
          buildTrending({ domain: 'big.com', pctRankChange: 50 }),
          buildTrending({ domain: 'noise.com', pctRankChange: 5 }),
        ],
      }),
    );
    vi.stubEnv('TECH_SCOUT_SCENARIO_CLOUDFLARE', 'cf-low');
    const items = await fetchQueries(
      [{ label: 'q', params: { _surface: 'trending_rise', _path: '/ranking/top' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
    expect(((items[0]!.data as { raw: { domain: string } }).raw).domain).toBe('big.com');
  });

  it('keeps service rows without engagement floor (already top-N capped)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    setCloudflareRadarResponse(
      'cf-svc',
      buildEnvelope({
        top_0: [
          buildService({ service: 'OpenAI', rank: 1 }),
          buildService({ service: 'Anthropic', rank: 2 }),
        ],
      }),
    );
    vi.stubEnv('TECH_SCOUT_SCENARIO_CLOUDFLARE', 'cf-svc');
    const items = await fetchQueries(
      [
        {
          label: 'q',
          params: {
            _surface: 'service_top',
            _path: '/ranking/internet_services/top',
            _category: 'Generative AI',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(2);
    expect((items[0]!.data as { category: string }).category).toBe('Generative AI');
  });

  it('extracts ai-bot user_agent rows and drops shares < 1%', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    setCloudflareRadarResponse(
      'cf-bots',
      buildEnvelope({
        summary_0: { GPTBot: '35.2', PerplexityBot: '12.3', NicheBot: '0.5' },
      }),
    );
    vi.stubEnv('TECH_SCOUT_SCENARIO_CLOUDFLARE', 'cf-bots');
    const items = await fetchQueries(
      [
        {
          label: 'q',
          params: {
            _surface: 'ai_bot_user_agent',
            _path: '/ai/bots/summary/user_agent',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    // GPTBot + PerplexityBot survive; NicheBot dropped.
    expect(items).toHaveLength(2);
  });

  it('emits ONE summary signal for ai-bot content_type (not per-row)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    setCloudflareRadarResponse(
      'cf-content',
      buildEnvelope({
        summary_0: { html: '45.0', json: '28.0', pdf: '15.0', text: '12.0' },
      }),
    );
    vi.stubEnv('TECH_SCOUT_SCENARIO_CLOUDFLARE', 'cf-content');
    const items = await fetchQueries(
      [
        {
          label: 'q',
          params: {
            _surface: 'ai_bot_content_type',
            _path: '/ai/bots/summary/content_type',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
  });

  it('returns [] when summary_0 is empty for ai-bot content_type', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    setCloudflareRadarResponse('cf-empty-content', buildEnvelope({ summary_0: {} }));
    vi.stubEnv('TECH_SCOUT_SCENARIO_CLOUDFLARE', 'cf-empty-content');
    const items = await fetchQueries(
      [
        {
          label: 'q',
          params: {
            _surface: 'ai_bot_content_type',
            _path: '/ai/bots/summary/content_type',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toEqual([]);
  });

  it('returns [] when result.top_0 is missing or empty', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    setCloudflareRadarResponse('cf-empty', buildEnvelope({ top_0: [] }));
    vi.stubEnv('TECH_SCOUT_SCENARIO_CLOUDFLARE', 'cf-empty');
    const items = await fetchQueries(
      [{ label: 'q', params: { _surface: 'trending_rise', _path: '/ranking/top' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — error classification & retry
// ────────────────────────────────────────────────────────────────────────────

describe('cloudflareRadarAdapter.fetch — error classification', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('throws CloudflareRadarDeniedError(401) immediately (no retry)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    let calls = 0;
    server.use(
      http.get('https://api.cloudflare.com/client/v4/radar/ranking/top', () => {
        calls++;
        return new HttpResponse(JSON.stringify({ success: false }), { status: 401 });
      }),
    );
    await expect(
      fetchQueries(
        [{ label: 'q', params: { _surface: 'trending_rise', _path: '/ranking/top' } }],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'CloudflareRadarDeniedError', status: 401 });
    expect(calls).toBe(1);
  });

  it('retries on 429 and recovers when the second attempt succeeds', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    let calls = 0;
    server.use(
      http.get('https://api.cloudflare.com/client/v4/radar/ranking/top', () => {
        calls++;
        if (calls === 1) {
          return new HttpResponse(JSON.stringify({ success: false }), { status: 429 });
        }
        return HttpResponse.json(buildEnvelope({ top_0: [buildTrending()] }));
      }),
    );
    const items = await fetchQueries(
      [{ label: 'q', params: { _surface: 'trending_rise', _path: '/ranking/top' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(calls).toBe(2);
    expect(items).toHaveLength(1);
  });

  it('exhausts retries on persistent 429 → CloudflareRadarDeniedError(429)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    let calls = 0;
    server.use(
      http.get('https://api.cloudflare.com/client/v4/radar/ranking/top', () => {
        calls++;
        return new HttpResponse(JSON.stringify({ success: false }), { status: 429 });
      }),
    );
    await expect(
      fetchQueries(
        [{ label: 'q', params: { _surface: 'trending_rise', _path: '/ranking/top' } }],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'CloudflareRadarDeniedError', status: 429 });
    // initial + 3 retries = 4 fetch calls
    expect(calls).toBe(4);
  });

  it('throws plain Error on 5xx (not CloudflareRadarDeniedError)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', TOKEN);
    server.use(
      http.get('https://api.cloudflare.com/client/v4/radar/ranking/top', () =>
        new HttpResponse(JSON.stringify({ success: false }), { status: 503 }),
      ),
    );
    let caught: unknown;
    try {
      await fetchQueries(
        [{ label: 'q', params: { _surface: 'trending_rise', _path: '/ranking/top' } }],
        { timeoutMs: 10_000 },
        noSleep,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(CloudflareRadarDeniedError);
    expect(String(caught)).toContain('503');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// computeRadarBackoffMs
// ────────────────────────────────────────────────────────────────────────────

describe('computeRadarBackoffMs', () => {
  it('honors Retry-After header when valid (in seconds → ms)', () => {
    expect(computeRadarBackoffMs(0, '7')).toBe(7_000);
    expect(computeRadarBackoffMs(2, '60')).toBe(60_000);
  });

  it('falls back to 5s × 2^attempt when Retry-After is null', () => {
    expect(computeRadarBackoffMs(0, null)).toBe(5_000);
    expect(computeRadarBackoffMs(1, null)).toBe(10_000);
    expect(computeRadarBackoffMs(2, null)).toBe(20_000);
  });

  it('falls back when Retry-After is malformed', () => {
    expect(computeRadarBackoffMs(0, 'not-a-number')).toBe(5_000);
    expect(computeRadarBackoffMs(0, '-3')).toBe(5_000);
  });

  it('clamps a giant Retry-After to 5 minutes', () => {
    expect(computeRadarBackoffMs(0, '999999')).toBe(300_000);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// normalize
// ────────────────────────────────────────────────────────────────────────────

describe('cloudflareRadarAdapter.normalize', () => {
  it('converts a trending-domain wrapper into a Signal with category=adoption', () => {
    const raw: RawItem = {
      source: 'cloudflare',
      data: {
        _surface: 'trending_rise',
        raw: buildTrending({ domain: 'perplexity.ai', rank: 200, pctRankChange: 75 }),
        lastUpdated: '2026-04-25T00:00:00Z',
      },
    };
    const sig = cloudflareRadarAdapter.normalize(raw);
    expect(sig.source).toBe('cloudflare');
    expect(sig.url).toBe('https://perplexity.ai');
    expect(sig.category).toBe('adoption');
    expect(sig.title).toContain('perplexity.ai');
    expect(sig.title).toContain('+75%');
    expect(sig.snippet).toContain('Cloudflare Radar');
    expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
  });

  it('uses "compounding" wording for trending_steady (vs "surging" for trending_rise)', () => {
    const raw: RawItem = {
      source: 'cloudflare',
      data: {
        _surface: 'trending_steady',
        raw: buildTrending({ domain: 'foo.com', rank: 50, pctRankChange: 25 }),
        lastUpdated: null,
      },
    };
    const sig = cloudflareRadarAdapter.normalize(raw);
    expect(sig.title).toContain('compounding');
    expect(sig.title).not.toContain('surging');
  });

  it('converts a service-top wrapper into a Signal with category in title', () => {
    const raw: RawItem = {
      source: 'cloudflare',
      data: {
        _surface: 'service_top',
        raw: buildService({ service: 'OpenAI', rank: 1 }),
        category: 'Generative AI',
        lastUpdated: '2026-04-25T00:00:00Z',
      },
    };
    const sig = cloudflareRadarAdapter.normalize(raw);
    expect(sig.title).toBe('OpenAI #1 in Generative AI on Cloudflare Radar');
    expect(sig.url).toBe('https://radar.cloudflare.com/services');
    expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
  });

  it('converts an ai_bot_user_agent wrapper into a Signal with formatted share', () => {
    const raw: RawItem = {
      source: 'cloudflare',
      data: {
        _surface: 'ai_bot_user_agent',
        raw: { userAgent: 'PerplexityBot', share: 12.345 },
        lastUpdated: '2026-04-25T00:00:00Z',
      },
    };
    const sig = cloudflareRadarAdapter.normalize(raw);
    expect(sig.title).toContain('PerplexityBot');
    expect(sig.title).toContain('12.3%');
    expect(sig.url).toBe('https://radar.cloudflare.com/ai-insights');
    expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
  });

  it('converts an ai_bot_content_type wrapper into a Signal summarizing the breakdown', () => {
    const raw: RawItem = {
      source: 'cloudflare',
      data: {
        _surface: 'ai_bot_content_type',
        raw: { summary: { html: '45.0', json: '28.0', pdf: '15.0' } },
        lastUpdated: '2026-04-25T00:00:00Z',
      },
    };
    const sig = cloudflareRadarAdapter.normalize(raw);
    expect(sig.snippet).toContain('html');
    expect(sig.snippet).toContain('45.0%');
    expect(sig.snippet).toContain('json');
    expect(sig.url).toBe('https://radar.cloudflare.com/ai-insights');
    expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
  });

  it('produces SIGNAL_SCHEMA-valid output for every surface', () => {
    const wrappers = [
      {
        _surface: 'trending_rise' as const,
        raw: buildTrending(),
        lastUpdated: '2026-04-25T00:00:00Z',
      },
      {
        _surface: 'trending_steady' as const,
        raw: buildTrending(),
        lastUpdated: '2026-04-25T00:00:00Z',
      },
      {
        _surface: 'service_top' as const,
        raw: buildService(),
        category: 'Cloud',
        lastUpdated: '2026-04-25T00:00:00Z',
      },
      {
        _surface: 'ai_bot_user_agent' as const,
        raw: { userAgent: 'GPTBot', share: 35.2 },
        lastUpdated: '2026-04-25T00:00:00Z',
      },
      {
        _surface: 'ai_bot_content_type' as const,
        raw: { summary: { html: '50.0' } },
        lastUpdated: '2026-04-25T00:00:00Z',
      },
    ];
    for (const data of wrappers) {
      const sig = cloudflareRadarAdapter.normalize({ source: 'cloudflare', data });
      expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
    }
  });

  it('preserves the raw payload on the signal for debugging', () => {
    const trending = buildTrending({ domain: 'preserve.me' });
    const sig = cloudflareRadarAdapter.normalize({
      source: 'cloudflare',
      data: {
        _surface: 'trending_rise',
        raw: trending,
        lastUpdated: null,
      },
    });
    expect(sig.raw).toBe(trending);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// adapter interface
// ────────────────────────────────────────────────────────────────────────────

describe('cloudflareRadarAdapter interface', () => {
  it('exports name "cloudflare" (matches signal.source so conformance passes)', () => {
    expect(cloudflareRadarAdapter.name).toBe('cloudflare');
  });

  it('conforms to the SourceAdapter interface (type check)', () => {
    const _typed: SourceAdapter = cloudflareRadarAdapter;
    expect(_typed).toBe(cloudflareRadarAdapter);
  });
});
