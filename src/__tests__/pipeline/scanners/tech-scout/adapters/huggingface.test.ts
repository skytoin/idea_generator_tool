import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  huggingfaceAdapter,
  fetchQueries,
  computeHfBackoffMs,
  HuggingFaceDeniedError,
} from '../../../../../pipeline/scanners/tech-scout/adapters/huggingface';
import {
  setHuggingfaceResponse,
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

/** Minimum valid plan for adapter tests; override fields per case. */
function buildPlan(overrides: Partial<ExpandedQueryPlan> = {}): ExpandedQueryPlan {
  return {
    hn_keywords: ['fraud hn'],
    arxiv_keywords: ['fraud arxiv'],
    github_keywords: ['fraud github'],
    reddit_keywords: ['fraud reddit'],
    huggingface_keywords: ['tabular forecasting', 'entity resolution', 'agent orchestration'],
    arxiv_categories: ['cs.LG'],
    github_languages: ['python'],
    reddit_subreddits: [],
    domain_tags: ['fintech', 'machine learning'],
    timeframe_iso: '2026-01-11T12:00:00.000Z',
    ...overrides,
  };
}

/** Minimum valid tech_scout directive for adapter tests. */
function buildDirective(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: [],
    notes: '',
    target_sources: ['huggingface'],
    timeframe: 'last 6 months',
  };
}

/** Sample HF model record (matches the live API response shape). */
function buildModel(
  overrides: Partial<{
    id: string;
    likes: number;
    downloads: number;
    trendingScore: number;
    pipeline_tag: string;
    library_name: string;
    tags: string[];
    private: boolean;
    lastModified: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'Qwen/Qwen3-7B',
    modelId: overrides.id ?? 'Qwen/Qwen3-7B',
    author: 'Qwen',
    likes: overrides.likes ?? 200,
    downloads: overrides.downloads ?? 45000,
    trendingScore: overrides.trendingScore ?? 800,
    pipeline_tag: overrides.pipeline_tag ?? 'text-generation',
    library_name: overrides.library_name ?? 'transformers',
    tags: overrides.tags ?? ['transformers', 'safetensors', 'license:apache-2.0'],
    createdAt: '2026-04-01T00:00:00.000Z',
    lastModified: overrides.lastModified ?? '2026-04-15T00:00:00.000Z',
    private: overrides.private ?? false,
    gated: false,
  };
}

/** Sample HF space record (matches the live API response shape). */
function buildSpace(
  overrides: Partial<{
    id: string;
    likes: number;
    trendingScore: number;
    sdk: string;
    title: string;
    description: string;
    private: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? 'r3gm/wan2-preview',
    author: 'r3gm',
    likes: overrides.likes ?? 500,
    trendingScore: overrides.trendingScore ?? 134,
    sdk: overrides.sdk ?? 'gradio',
    tags: ['gradio'],
    createdAt: '2025-10-27T03:20:43.000Z',
    lastModified: '2026-03-26T22:35:15.000Z',
    cardData: {
      title: overrides.title ?? 'Wan2 Preview',
      short_description:
        overrides.description ?? 'generate a video from an image with a text prompt',
      sdk: 'gradio',
    },
    private: overrides.private ?? false,
  };
}

/** Sample Daily Papers record (matches the live API response shape). */
function buildDailyPaper(
  overrides: Partial<{
    paperId: string;
    title: string;
    upvotes: number;
    githubStars: number;
    publishedAt: string;
    aiSummary: string;
    org: string;
  }> = {},
) {
  return {
    paper: {
      id: overrides.paperId ?? '2604.19835',
      title: overrides.title ?? 'Expert Upcycling for Mixture of Experts',
      summary: 'Long abstract here.',
      authors: [{ _id: '1', name: 'Alice', hidden: false }],
      publishedAt: overrides.publishedAt ?? '2026-04-21T00:00:00.000Z',
      upvotes: overrides.upvotes ?? 42,
      discussionId: 'd1',
      githubRepo: 'https://github.com/example/upcycling',
      githubStars: overrides.githubStars ?? 3,
      ai_summary:
        overrides.aiSummary ??
        'Expert upcycling expands MoE capacity by recycling pretrained experts.',
      ai_keywords: ['Mixture-of-Experts', 'sparse expert routing'],
      organization: { name: 'amazon', fullname: overrides.org ?? 'Amazon' },
    },
    publishedAt: overrides.publishedAt ?? '2026-04-21T00:00:00.000Z',
    title: overrides.title ?? 'Expert Upcycling for Mixture of Experts',
    summary: 'Top-level summary.',
    numComments: 1,
    isAuthorParticipating: false,
  };
}

/** No-op sleep for tests so we don't burn 600ms × N requests. */
const noSleep = (): Promise<void> => Promise.resolve();

// ────────────────────────────────────────────────────────────────────────────
// planQueries
// ────────────────────────────────────────────────────────────────────────────

describe('huggingfaceAdapter.planQueries — happy path', () => {
  it('emits 3 model + 3 space + 7 daily-paper queries with the expected labels', () => {
    const queries = huggingfaceAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries.length).toBe(13);
    const modelLabels = queries.filter((q) => q.label.startsWith('hf-models:'));
    const spaceLabels = queries.filter((q) => q.label.startsWith('hf-spaces:'));
    const paperLabels = queries.filter((q) => q.label.startsWith('hf-papers:'));
    expect(modelLabels).toHaveLength(3);
    expect(spaceLabels).toHaveLength(3);
    expect(paperLabels).toHaveLength(7);
  });

  it('every model query carries _surface=models and the search keyword', () => {
    const queries = huggingfaceAdapter.planQueries(buildPlan(), buildDirective());
    const models = queries.filter((q) => String(q.params._surface) === 'models');
    expect(models).toHaveLength(3);
    for (const m of models) {
      expect(m.params.sort).toBe('trendingScore');
      expect(m.params.direction).toBe('-1');
      expect(m.params.full).toBe('true');
      expect(typeof m.params.search).toBe('string');
      expect((m.params.search as string).length).toBeGreaterThan(0);
    }
  });

  it('every space query carries _surface=spaces and the search keyword', () => {
    const queries = huggingfaceAdapter.planQueries(buildPlan(), buildDirective());
    const spaces = queries.filter((q) => String(q.params._surface) === 'spaces');
    expect(spaces).toHaveLength(3);
    for (const s of spaces) {
      expect(s.params.sort).toBe('trendingScore');
      expect(s.params.direction).toBe('-1');
    }
  });

  it('every daily-paper query carries _surface=daily_papers and a YYYY-MM-DD _date', () => {
    const queries = huggingfaceAdapter.planQueries(buildPlan(), buildDirective());
    const papers = queries.filter((q) => String(q.params._surface) === 'daily_papers');
    expect(papers).toHaveLength(7);
    for (const p of papers) {
      expect(typeof p.params._date).toBe('string');
      expect(String(p.params._date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('daily-paper queries do NOT set sort= (HF returns 400 when sort=hot combines with date=)', () => {
    // 2026-04-24 regression: `sort=hot` + `date=YYYY-MM-DD` → HTTP 400
    // which aborted all 7 daily-paper calls and marked the whole HF
    // source as `failed`. The default order is fine for a day's view.
    const queries = huggingfaceAdapter.planQueries(buildPlan(), buildDirective());
    const papers = queries.filter((q) => String(q.params._surface) === 'daily_papers');
    for (const p of papers) {
      expect(p.params.sort).toBeUndefined();
    }
  });

  it('uses up to MAX_KEYWORD_QUERIES_PER_SURFACE keywords from huggingface_keywords first', () => {
    const queries = huggingfaceAdapter.planQueries(
      buildPlan({
        huggingface_keywords: ['kw-a', 'kw-b', 'kw-c', 'kw-d'],
      }),
      buildDirective(),
    );
    const modelSearches = queries
      .filter((q) => String(q.params._surface) === 'models')
      .map((q) => String(q.params.search));
    expect(modelSearches).toEqual(['kw-a', 'kw-b', 'kw-c']);
  });

  it('falls back to domain_tags when huggingface_keywords is empty', () => {
    const queries = huggingfaceAdapter.planQueries(
      buildPlan({
        huggingface_keywords: [],
        domain_tags: ['martech', 'data-engineering', 'analytics'],
      }),
      buildDirective(),
    );
    const modelSearches = queries
      .filter((q) => String(q.params._surface) === 'models')
      .map((q) => String(q.params.search));
    expect(modelSearches).toEqual(['martech', 'data-engineering', 'analytics']);
  });

  it('still emits 7 daily-paper queries when no keywords are provided at all', () => {
    const queries = huggingfaceAdapter.planQueries(
      buildPlan({ huggingface_keywords: [], domain_tags: [] }),
      buildDirective(),
    );
    const papers = queries.filter((q) => String(q.params._surface) === 'daily_papers');
    expect(papers).toHaveLength(7);
  });

  it('all queries set limit per surface (50 listings, 50 papers)', () => {
    const queries = huggingfaceAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(q.params.limit).toBe('50');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — URL construction
// ────────────────────────────────────────────────────────────────────────────

describe('huggingfaceAdapter.fetch — URL construction', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('builds /api/models for model queries (no _surface in query string)', async () => {
    let capturedUrl = '';
    server.use(
      http.get('https://huggingface.co/api/models', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await fetchQueries(
      [
        {
          label: 'hf-models: "fraud"',
          params: {
            _surface: 'models',
            search: 'fraud',
            sort: 'trendingScore',
            direction: '-1',
            limit: '50',
            full: 'true',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedUrl).toContain('/api/models');
    expect(capturedUrl).toContain('search=fraud');
    expect(capturedUrl).not.toContain('_surface');
  });

  it('builds /api/spaces for space queries', async () => {
    let capturedUrl = '';
    server.use(
      http.get('https://huggingface.co/api/spaces', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await fetchQueries(
      [
        {
          label: 'hf-spaces: "video"',
          params: {
            _surface: 'spaces',
            search: 'video',
            sort: 'trendingScore',
            direction: '-1',
            limit: '50',
            full: 'true',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedUrl).toContain('/api/spaces');
    expect(capturedUrl).toContain('search=video');
  });

  it('builds /api/daily_papers with date= for daily-paper queries (strips _date transport field)', async () => {
    let capturedUrl = '';
    server.use(
      http.get('https://huggingface.co/api/daily_papers', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await fetchQueries(
      [
        {
          label: 'hf-papers: 2026-04-23',
          params: {
            _surface: 'daily_papers',
            _date: '2026-04-23',
            limit: '50',
          },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(capturedUrl).toContain('/api/daily_papers');
    expect(capturedUrl).toContain('date=2026-04-23');
    expect(capturedUrl).not.toContain('_surface');
    expect(capturedUrl).not.toContain('_date=');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — parsing & engagement floor
// ────────────────────────────────────────────────────────────────────────────

describe('huggingfaceAdapter.fetch — parsing and engagement floor', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('parses a list of models into RawItems tagged with _surface=models', async () => {
    setHuggingfaceResponse('hf-models', [buildModel({ id: 'a/b' }), buildModel({ id: 'c/d' })]);
    vi.stubEnv('TECH_SCOUT_SCENARIO_HF', 'hf-models');
    const items = await fetchQueries(
      [
        {
          label: 'hf-models: "fraud"',
          params: { _surface: 'models', search: 'fraud' },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.source).toBe('huggingface');
      const wrapper = item.data as { _surface: string };
      expect(wrapper._surface).toBe('models');
    }
  });

  it('drops models with 0 likes (MIN_MODEL_LIKES = 1: only literal-zero-engagement entries are cut)', async () => {
    // 2026-04-24 tuning: engagement floor dropped from 5 → 1 because
    // precise search terms (e.g. "RAG evaluation", "customer churn")
    // return top-trending results with 0-4 likes that are still
    // on-topic. Floor=1 rejects only the abandoned-upload junk.
    setHuggingfaceResponse('hf-low', [
      buildModel({ id: 'good/model', likes: 100 }),
      buildModel({ id: 'dead/model', likes: 0 }),
    ]);
    vi.stubEnv('TECH_SCOUT_SCENARIO_HF', 'hf-low');
    const items = await fetchQueries(
      [{ label: 'hf-models: "x"', params: { _surface: 'models', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
    expect(((items[0]!.data as { raw: { id: string } }).raw).id).toBe('good/model');
  });

  it('keeps low-engagement models (likes=2) so niche search results survive', async () => {
    setHuggingfaceResponse('hf-niche', [buildModel({ id: 'niche/model', likes: 2 })]);
    vi.stubEnv('TECH_SCOUT_SCENARIO_HF', 'hf-niche');
    const items = await fetchQueries(
      [{ label: 'hf-models: "x"', params: { _surface: 'models', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
  });

  it('drops spaces with 0 likes (MIN_SPACE_LIKES = 1)', async () => {
    setHuggingfaceResponse('hf-spaces-low', [
      buildSpace({ id: 'good/space', likes: 50 }),
      buildSpace({ id: 'dead/space', likes: 0 }),
    ]);
    vi.stubEnv('TECH_SCOUT_SCENARIO_HF', 'hf-spaces-low');
    const items = await fetchQueries(
      [{ label: 'hf-spaces: "x"', params: { _surface: 'spaces', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
    expect(((items[0]!.data as { raw: { id: string } }).raw).id).toBe('good/space');
  });

  it('drops private models even when they meet the likes floor', async () => {
    setHuggingfaceResponse('hf-priv', [
      buildModel({ id: 'priv/model', likes: 100, private: true }),
      buildModel({ id: 'pub/model', likes: 100, private: false }),
    ]);
    vi.stubEnv('TECH_SCOUT_SCENARIO_HF', 'hf-priv');
    const items = await fetchQueries(
      [{ label: 'hf-models: "x"', params: { _surface: 'models', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(1);
    expect(((items[0]!.data as { raw: { id: string } }).raw).id).toBe('pub/model');
  });

  it('passes daily-papers through without any engagement floor (HF curation does that work)', async () => {
    setHuggingfaceResponse('hf-papers', [
      buildDailyPaper({ paperId: '1.0', upvotes: 1 }),
      buildDailyPaper({ paperId: '1.1', upvotes: 50 }),
    ]);
    vi.stubEnv('TECH_SCOUT_SCENARIO_HF', 'hf-papers');
    const items = await fetchQueries(
      [
        {
          label: 'hf-papers: 2026-04-23',
          params: { _surface: 'daily_papers', _date: '2026-04-23' },
        },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(2);
  });

  it('returns [] when the response is an empty array (no error)', async () => {
    setHuggingfaceResponse('hf-empty', []);
    vi.stubEnv('TECH_SCOUT_SCENARIO_HF', 'hf-empty');
    const items = await fetchQueries(
      [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — auth header
// ────────────────────────────────────────────────────────────────────────────

describe('huggingfaceAdapter.fetch — auth header', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('does NOT send Authorization when HF_TOKEN is unset', async () => {
    const captured: Record<string, string> = {};
    server.use(
      http.get('https://huggingface.co/api/models', ({ request }) => {
        request.headers.forEach((v, k) => {
          captured[k.toLowerCase()] = v;
        });
        return HttpResponse.json([]);
      }),
    );
    await fetchQueries(
      [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(captured.authorization).toBeUndefined();
  });

  it('sends Authorization: Bearer <token> when HF_TOKEN is set', async () => {
    vi.stubEnv('HF_TOKEN', 'hf_secret_xxx');
    const captured: Record<string, string> = {};
    server.use(
      http.get('https://huggingface.co/api/models', ({ request }) => {
        request.headers.forEach((v, k) => {
          captured[k.toLowerCase()] = v;
        });
        return HttpResponse.json([]);
      }),
    );
    await fetchQueries(
      [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(captured.authorization).toBe('Bearer hf_secret_xxx');
  });

  it('sends a User-Agent on every request', async () => {
    const captured: Record<string, string> = {};
    server.use(
      http.get('https://huggingface.co/api/models', ({ request }) => {
        request.headers.forEach((v, k) => {
          captured[k.toLowerCase()] = v;
        });
        return HttpResponse.json([]);
      }),
    );
    await fetchQueries(
      [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(captured['user-agent']).toBeTruthy();
    expect(captured['user-agent']!.length).toBeGreaterThan(10);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — error classification & retry
// ────────────────────────────────────────────────────────────────────────────

describe('huggingfaceAdapter.fetch — error classification', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('throws HuggingFaceDeniedError(401) immediately (no retry)', async () => {
    let calls = 0;
    server.use(
      http.get('https://huggingface.co/api/models', () => {
        calls++;
        return new HttpResponse(JSON.stringify({ error: 'unauth' }), { status: 401 });
      }),
    );
    await expect(
      fetchQueries(
        [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'HuggingFaceDeniedError', status: 401 });
    expect(calls).toBe(1);
  });

  it('throws HuggingFaceDeniedError(403) immediately (no retry)', async () => {
    let calls = 0;
    server.use(
      http.get('https://huggingface.co/api/models', () => {
        calls++;
        return new HttpResponse(JSON.stringify({ error: 'forbid' }), { status: 403 });
      }),
    );
    await expect(
      fetchQueries(
        [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'HuggingFaceDeniedError', status: 403 });
    expect(calls).toBe(1);
  });

  it('retries on 429 and recovers when the second attempt succeeds', async () => {
    let calls = 0;
    server.use(
      http.get('https://huggingface.co/api/models', () => {
        calls++;
        if (calls === 1) {
          return new HttpResponse(JSON.stringify({ error: 'rate' }), { status: 429 });
        }
        return HttpResponse.json([buildModel({ id: 'recovered/model' })]);
      }),
    );
    const items = await fetchQueries(
      [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(calls).toBe(2);
    expect(items).toHaveLength(1);
  });

  it('exhausts retries on persistent 429 → HuggingFaceDeniedError(429)', async () => {
    let calls = 0;
    server.use(
      http.get('https://huggingface.co/api/models', () => {
        calls++;
        return new HttpResponse(JSON.stringify({ error: 'rate' }), { status: 429 });
      }),
    );
    await expect(
      fetchQueries(
        [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toMatchObject({ name: 'HuggingFaceDeniedError', status: 429 });
    // initial + 3 retries = 4 fetch calls
    expect(calls).toBe(4);
  });

  it('throws a plain Error on 5xx (not HuggingFaceDeniedError)', async () => {
    server.use(
      http.get('https://huggingface.co/api/models', () =>
        new HttpResponse(JSON.stringify({ error: 'boom' }), { status: 503 }),
      ),
    );
    let caught: unknown;
    try {
      await fetchQueries(
        [{ label: 'q', params: { _surface: 'models', search: 'x' } }],
        { timeoutMs: 10_000 },
        noSleep,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(HuggingFaceDeniedError);
    expect(String(caught)).toContain('503');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fetch — partial-success pattern
// ────────────────────────────────────────────────────────────────────────────

describe('huggingfaceAdapter.fetch — partial-success', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('returns partial results when ONE query fails mid-loop and others succeed', async () => {
    let calls = 0;
    server.use(
      http.get('https://huggingface.co/api/models', () => {
        calls++;
        if (calls === 2) {
          return new HttpResponse(JSON.stringify({ error: 'oops' }), { status: 500 });
        }
        return HttpResponse.json([buildModel({ id: `m/${calls}` })]);
      }),
    );
    const items = await fetchQueries(
      [
        { label: 'q1', params: { _surface: 'models', search: 'a' } },
        { label: 'q2', params: { _surface: 'models', search: 'b' } },
        { label: 'q3', params: { _surface: 'models', search: 'c' } },
      ],
      { timeoutMs: 10_000 },
      noSleep,
    );
    expect(items).toHaveLength(2);
  });

  it('throws when EVERY query fails', async () => {
    server.use(
      http.get('https://huggingface.co/api/models', () =>
        new HttpResponse(JSON.stringify({ error: 'oops' }), { status: 500 }),
      ),
    );
    await expect(
      fetchQueries(
        [
          { label: 'q1', params: { _surface: 'models', search: 'a' } },
          { label: 'q2', params: { _surface: 'models', search: 'b' } },
        ],
        { timeoutMs: 10_000 },
        noSleep,
      ),
    ).rejects.toThrow(/500/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// computeHfBackoffMs
// ────────────────────────────────────────────────────────────────────────────

describe('computeHfBackoffMs', () => {
  it('returns Retry-After header value (in ms) when present and valid', () => {
    expect(computeHfBackoffMs(0, '7')).toBe(7_000);
    expect(computeHfBackoffMs(2, '60')).toBe(60_000);
  });

  it('falls back to 5s × 2^attempt when Retry-After is null', () => {
    expect(computeHfBackoffMs(0, null)).toBe(5_000);
    expect(computeHfBackoffMs(1, null)).toBe(10_000);
    expect(computeHfBackoffMs(2, null)).toBe(20_000);
  });

  it('falls back to exponential when Retry-After is malformed', () => {
    expect(computeHfBackoffMs(0, 'not-a-number')).toBe(5_000);
    expect(computeHfBackoffMs(0, '')).toBe(5_000);
    expect(computeHfBackoffMs(0, '-1')).toBe(5_000);
  });

  it('clamps a giant Retry-After to 5 minutes', () => {
    expect(computeHfBackoffMs(0, '999999')).toBe(300_000);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// normalize
// ────────────────────────────────────────────────────────────────────────────

describe('huggingfaceAdapter.normalize', () => {
  it('converts a model wrapper into a Signal with category=tech_capability and HF model URL', () => {
    const raw: RawItem = {
      source: 'huggingface',
      data: { _surface: 'models', raw: buildModel({ id: 'Qwen/Qwen3-7B' }) },
    };
    const sig = huggingfaceAdapter.normalize(raw);
    expect(sig.source).toBe('huggingface');
    expect(sig.title).toBe('Qwen/Qwen3-7B');
    expect(sig.url).toBe('https://huggingface.co/Qwen/Qwen3-7B');
    expect(sig.category).toBe('tech_capability');
    expect(sig.snippet).toContain('text-generation');
    expect(sig.snippet).toContain('likes');
    expect(sig.snippet).toContain('downloads');
    expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
  });

  it('converts a space wrapper into a Signal with category=product_launch and /spaces/ URL', () => {
    const raw: RawItem = {
      source: 'huggingface',
      data: { _surface: 'spaces', raw: buildSpace({ id: 'r3gm/wan2-preview' }) },
    };
    const sig = huggingfaceAdapter.normalize(raw);
    expect(sig.title).toBe('Wan2 Preview');
    expect(sig.url).toBe('https://huggingface.co/spaces/r3gm/wan2-preview');
    expect(sig.category).toBe('product_launch');
    expect(sig.snippet).toContain('gradio');
    expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
  });

  it('falls back to space.id when cardData.title is empty', () => {
    const raw: RawItem = {
      source: 'huggingface',
      data: { _surface: 'spaces', raw: buildSpace({ id: 'foo/bar', title: '' }) },
    };
    const sig = huggingfaceAdapter.normalize(raw);
    expect(sig.title).toBe('foo/bar');
  });

  it('converts a daily-paper wrapper into a Signal with category=research and /papers/ URL', () => {
    const raw: RawItem = {
      source: 'huggingface',
      data: {
        _surface: 'daily_papers',
        raw: buildDailyPaper({
          paperId: '2604.19835',
          title: 'Expert Upcycling',
          upvotes: 42,
          githubStars: 3,
        }),
      },
    };
    const sig = huggingfaceAdapter.normalize(raw);
    expect(sig.title).toBe('Expert Upcycling');
    expect(sig.url).toBe('https://huggingface.co/papers/2604.19835');
    expect(sig.category).toBe('research');
    expect(sig.snippet).toContain('Amazon');
    expect(sig.snippet).toContain('42 upvotes');
    expect(sig.snippet).toContain('3 GitHub stars');
    expect(sig.snippet).toContain('Expert upcycling');
    expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
  });

  it('truncates long ai_summary at SNIPPET_MAX with an ellipsis', () => {
    const longSummary = 'x'.repeat(500);
    const raw: RawItem = {
      source: 'huggingface',
      data: {
        _surface: 'daily_papers',
        raw: buildDailyPaper({ aiSummary: longSummary }),
      },
    };
    const sig = huggingfaceAdapter.normalize(raw);
    expect(sig.snippet).toContain('…');
    expect(sig.snippet.length).toBeLessThan(500);
  });

  it('handles a daily-paper missing ai_summary by falling back to summary', () => {
    const noAiSummary = buildDailyPaper();
    delete (noAiSummary.paper as { ai_summary?: string }).ai_summary;
    const raw: RawItem = {
      source: 'huggingface',
      data: { _surface: 'daily_papers', raw: noAiSummary },
    };
    const sig = huggingfaceAdapter.normalize(raw);
    expect(sig.snippet).toContain('Long abstract');
  });

  it('produces a Signal that passes SIGNAL_SCHEMA for all three surfaces', () => {
    const wrappers = [
      { _surface: 'models' as const, raw: buildModel() },
      { _surface: 'spaces' as const, raw: buildSpace() },
      { _surface: 'daily_papers' as const, raw: buildDailyPaper() },
    ];
    for (const data of wrappers) {
      const sig = huggingfaceAdapter.normalize({ source: 'huggingface', data });
      expect(SIGNAL_SCHEMA.safeParse(sig).success).toBe(true);
    }
  });

  it('preserves the raw payload on the signal for debugging', () => {
    const m = buildModel({ id: 'preserve/this' });
    const raw: RawItem = {
      source: 'huggingface',
      data: { _surface: 'models', raw: m },
    };
    const sig = huggingfaceAdapter.normalize(raw);
    expect(sig.raw).toBe(m);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// adapter interface
// ────────────────────────────────────────────────────────────────────────────

describe('huggingfaceAdapter interface', () => {
  it('exports name "huggingface"', () => {
    expect(huggingfaceAdapter.name).toBe('huggingface');
  });

  it('conforms to the SourceAdapter interface (type check)', () => {
    const _typed: SourceAdapter = huggingfaceAdapter;
    expect(_typed).toBe(huggingfaceAdapter);
  });
});
