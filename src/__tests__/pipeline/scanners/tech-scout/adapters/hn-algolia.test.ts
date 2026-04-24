import { describe, it, expect, afterEach, vi } from 'vitest';
import { hnAlgoliaAdapter } from '../../../../../pipeline/scanners/tech-scout/adapters/hn-algolia';
import { setHnResponse, resetScannerMocks } from '../../../../mocks/scanner-mocks';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  RawItem,
} from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';

/** Build a minimum valid ExpandedQueryPlan for test reuse. */
function buildPlan(overrides: Partial<ExpandedQueryPlan> = {}): ExpandedQueryPlan {
  return {
    hn_keywords: [
      'fraud detection',
      'anomaly detection',
      'risk scoring',
      'payments fraud',
      'ML',
    ],
    arxiv_keywords: ['fraud detection paper'],
    github_keywords: ['fraud detection kit'],
    reddit_keywords: [],
    huggingface_keywords: [],
    arxiv_categories: ['cs.LG'],
    github_languages: ['python'],
    reddit_subreddits: [],
    domain_tags: ['fintech'],
    timeframe_iso: '2025-10-11T12:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimum valid tech_scout directive for test reuse. */
function buildDirective(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: [],
    notes: '',
    target_sources: ['hn'],
    timeframe: 'last 6 months',
  };
}

/** Build a canonical HN Algolia hit for normalize() tests. */
function buildHit(
  overrides: Partial<{
    objectID: string;
    title: string;
    url: string | null | undefined;
    author: string | undefined;
    points: number | undefined;
    num_comments: number | undefined;
    created_at: string | undefined;
    created_at_i: number;
    _tags: string[];
  }> = {},
) {
  return {
    objectID: overrides.objectID ?? '12345',
    title: overrides.title ?? 'Show HN: Python fraud detection library',
    url: 'url' in overrides ? overrides.url : 'https://example.com/foo',
    author: 'author' in overrides ? overrides.author : 'alice',
    points: 'points' in overrides ? overrides.points : 150,
    num_comments: 'num_comments' in overrides ? overrides.num_comments : 42,
    created_at:
      'created_at' in overrides ? overrides.created_at : '2026-03-14T12:00:00.000Z',
    created_at_i: overrides.created_at_i ?? 1742558400,
    _tags: overrides._tags ?? ['story', 'author_alice', 'story_12345'],
  };
}

describe('hnAlgoliaAdapter.planQueries', () => {
  it('produces one query per hn_keyword (capped at MAX_QUERIES=6)', () => {
    const queries = hnAlgoliaAdapter.planQueries(buildPlan(), buildDirective());
    // buildPlan has 5 hn_keywords, all under the MAX_QUERIES cap.
    expect(queries).toHaveLength(5);
    expect(queries.map((q) => q.params.query)).toEqual([
      'fraud detection',
      'anomaly detection',
      'risk scoring',
      'payments fraud',
      'ML',
    ]);
  });

  it('caps at MAX_QUERIES when hn_keywords has more than 6 entries', () => {
    const many = Array.from({ length: 10 }, (_, i) => `kw${i} token`);
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({ hn_keywords: many }),
      buildDirective(),
    );
    expect(queries).toHaveLength(6);
  });

  it('uses HN tags=story and numericFilters with created_at_i + points', () => {
    const plan = buildPlan();
    const queries = hnAlgoliaAdapter.planQueries(plan, buildDirective());
    const cutoff = Math.floor(new Date(plan.timeframe_iso).getTime() / 1000);
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]!;
      // First 4 queries target product launches (show_hn), rest are broad (story)
      expect(q.params.tags).toBe(i < 4 ? 'show_hn' : 'story');
      expect(q.params.numericFilters).toBe(
        `created_at_i>${cutoff},points>5,num_comments>3`,
      );
      expect(q.params.hitsPerPage).toBe(30);
      expect(typeof q.params.query).toBe('string');
    }
  });

  it('labels are human-readable "hn: <query>"', () => {
    const queries = hnAlgoliaAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries.map((q) => q.label)).toEqual([
      'hn: fraud detection',
      'hn: anomaly detection',
      'hn: risk scoring',
      'hn: payments fraud',
      'hn: ML',
    ]);
  });

  it('returns 1 query when there is only 1 hn keyword', () => {
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({ hn_keywords: ['solo'] }),
      buildDirective(),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]?.params.query).toBe('solo');
    expect(queries[0]?.label).toBe('hn: solo');
  });

  it('returns empty array when hn_keywords is empty', () => {
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({ hn_keywords: [] }),
      buildDirective(),
    );
    expect(queries).toEqual([]);
  });
});

describe('hnAlgoliaAdapter.fetch', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('makes one HTTP call per query returning wrapped RawItems', async () => {
    const sampleHit = buildHit();
    setHnResponse('hn-fetch-smoke', { hits: [sampleHit] });
    vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hn-fetch-smoke');

    const items = await hnAlgoliaAdapter.fetch(
      [
        {
          label: 'hn: x',
          params: {
            query: 'x',
            tags: 'story',
            numericFilters: 'created_at_i>0,points>5',
            hitsPerPage: 30,
          },
        },
      ],
      { timeoutMs: 10_000, signal: undefined },
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('hn_algolia');
    expect(items[0]?.data).toEqual(sampleHit);
  });

  it('handles empty hits response by returning an empty array', async () => {
    setHnResponse('hn-empty', { hits: [] });
    vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hn-empty');

    const items = await hnAlgoliaAdapter.fetch(
      [
        {
          label: 'hn: nothing',
          params: {
            query: 'nothing',
            tags: 'story',
            numericFilters: 'created_at_i>0,points>5',
            hitsPerPage: 30,
          },
        },
      ],
      { timeoutMs: 10_000 },
    );

    expect(items).toEqual([]);
  });

  it('honors AbortSignal by throwing when the signal is already aborted', async () => {
    setHnResponse('hn-abort', { hits: [buildHit()] });
    vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hn-abort');
    const controller = new AbortController();
    controller.abort();

    await expect(
      hnAlgoliaAdapter.fetch(
        [
          {
            label: 'hn: x',
            params: {
              query: 'x',
              tags: 'story',
              numericFilters: 'created_at_i>0,points>5',
              hitsPerPage: 30,
            },
          },
        ],
        { timeoutMs: 10_000, signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});

describe('hnAlgoliaAdapter.normalize', () => {
  it('converts a standard HN hit into a canonical Signal', () => {
    const hit = buildHit();
    const raw: RawItem = { source: 'hn_algolia', data: hit };
    const signal = hnAlgoliaAdapter.normalize(raw);

    expect(signal.source).toBe('hn_algolia');
    expect(signal.title).toBe('Show HN: Python fraud detection library');
    expect(signal.url).toBe('https://example.com/foo');
    expect(signal.date).toBe('2026-03-14T12:00:00.000Z');
    expect(signal.snippet).toContain('150 points');
    expect(signal.snippet).toContain('42 comments');
    expect(signal.snippet).toContain('alice');
    expect(signal.score).toEqual({
      novelty: 5,
      specificity: 5,
      recency: 5,
      relevance: 5,
    });
    expect(signal.category).toBe('tech_capability');
    expect(signal.raw).toBe(hit);
  });

  it('falls back to HN permalink when url is null (Ask HN)', () => {
    const hit = buildHit({ objectID: '67890', url: null });
    const signal = hnAlgoliaAdapter.normalize({
      source: 'hn_algolia',
      data: hit,
    });
    expect(signal.url).toBe('https://news.ycombinator.com/item?id=67890');
  });

  it('falls back to HN permalink when url is undefined', () => {
    const hit = buildHit({ objectID: '67890', url: undefined });
    const signal = hnAlgoliaAdapter.normalize({
      source: 'hn_algolia',
      data: hit,
    });
    expect(signal.url).toBe('https://news.ycombinator.com/item?id=67890');
  });

  it('handles missing author/points/num_comments without leaking "undefined"', () => {
    const hit = buildHit({
      author: undefined,
      points: undefined,
      num_comments: undefined,
    });
    const signal = hnAlgoliaAdapter.normalize({
      source: 'hn_algolia',
      data: hit,
    });
    expect(typeof signal.snippet).toBe('string');
    expect(signal.snippet).not.toContain('undefined');
  });
});

describe('hnAlgoliaAdapter interface', () => {
  it('exports name "hn_algolia"', () => {
    expect(hnAlgoliaAdapter.name).toBe('hn_algolia');
  });

  it('conforms to the SourceAdapter interface (type check)', () => {
    const _typed: SourceAdapter = hnAlgoliaAdapter;
    expect(_typed).toBe(hnAlgoliaAdapter);
  });
});

/**
 * HN Algolia search is token-AND with no OR operator (verified against
 * Algolia docs). A keyword like "MCP consumer insights platform" (4
 * content tokens) almost never matches an HN story title, which is
 * why the previous production run returned 0 hits. The adapter must
 * decompose long keywords into 1-2 content-token queries BEFORE
 * sending them to Algolia.
 *
 * These tests verify the rule is PROFILE-AGNOSTIC — it works for
 * tech, healthcare, legal, retail, and any other founder profile,
 * not just the MCP case that motivated the fix.
 */
describe('hnAlgoliaAdapter.planQueries — keyword decomposition (profile-agnostic)', () => {
  /** Get the `query` param from the first query of a plan with one keyword. */
  function queryFor(keyword: string): string {
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({ hn_keywords: [keyword] }),
      buildDirective(),
    );
    return String(queries[0]!.params.query);
  }

  it('passes a 1-token keyword through unchanged', () => {
    expect(queryFor('MCP')).toBe('MCP');
  });

  it('passes a 2-token keyword through unchanged', () => {
    expect(queryFor('fraud detection')).toBe('fraud detection');
  });

  it('shortens a 4-token tech keyword to 2 content tokens', () => {
    // Previous production drift: 4-token phrases starved HN Algolia.
    expect(queryFor('MCP consumer insights platform')).toBe('MCP consumer');
  });

  it('shortens a 5-token tech keyword to 2 content tokens', () => {
    expect(queryFor('data aggregation for small businesses')).toBe('data aggregation');
  });

  it('strips English stopwords before picking the first 2 content tokens', () => {
    // "for" is a stopword and should be skipped; first 2 content tokens are MCP, platform.
    expect(queryFor('MCP platform for users')).toBe('MCP platform');
  });

  it('works for a HEALTHCARE profile keyword (nurse, clinical, workflow)', () => {
    expect(queryFor('clinical documentation workflow automation')).toBe(
      'clinical documentation',
    );
  });

  it('works for a LEGAL profile keyword (contract review)', () => {
    expect(queryFor('contract review ai assistant')).toBe('contract review');
  });

  it('works for a RETAIL profile keyword (inventory, small business)', () => {
    expect(queryFor('inventory management for small retail shops')).toBe(
      'inventory management',
    );
  });

  it('works for an EDUCATION profile keyword (lesson, parents)', () => {
    expect(queryFor('lesson planning tools for parents')).toBe('lesson planning');
  });

  it('preserves an uppercase acronym when it is one of the top 2 tokens', () => {
    // The acronym-preservation guard runs at the planner, but the
    // adapter decomposition must NOT accidentally lowercase or drop it.
    expect(queryFor('RAG pipeline tooling')).toBe('RAG pipeline');
  });

  it('collapses multi-space input and trims whitespace', () => {
    expect(queryFor('   data   science   bootcamp   ')).toBe('data science');
  });

  it('drops a keyword that is entirely stopwords after stripping', () => {
    // "for the and" → all stopwords → empty → adapter drops the query.
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({ hn_keywords: ['for the and', 'real keyword'] }),
      buildDirective(),
    );
    // Only the second keyword produces a query.
    expect(queries).toHaveLength(1);
    expect(queries[0]!.params.query).toBe('real keyword');
  });

  it('labels reflect the decomposed query, not the original long keyword', () => {
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({ hn_keywords: ['MCP consumer insights platform'] }),
      buildDirective(),
    );
    expect(queries[0]!.label).toBe('hn: MCP consumer');
  });

  it('treats a hyphenated compound as a single token', () => {
    // "AI-driven SaaS for marketing" → tokens: AI-driven, SaaS, marketing.
    // First 2 content tokens = "AI-driven SaaS".
    expect(queryFor('AI-driven SaaS for marketing')).toBe('AI-driven SaaS');
  });

  it('applies decomposition independently across a batch of hn_keywords', () => {
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({
        hn_keywords: [
          'MCP consumer insights platform',
          'clever data collection tools',
          'innovative consumer tech',
          'AI-driven SaaS for marketing',
          'online marketing analytics',
        ],
      }),
      buildDirective(),
    );
    const queryStrings = queries.map((q) => String(q.params.query));
    expect(queryStrings).toEqual([
      'MCP consumer',
      'clever data',
      'innovative consumer',
      'AI-driven SaaS',
      'online marketing',
    ]);
  });

  it('does not mangle a 3-token keyword (passes first 2 content tokens)', () => {
    // 3-token keywords are borderline. The rule is consistent: take
    // the first 2 content tokens. Callers who need different behavior
    // should produce a shorter keyword upstream.
    expect(queryFor('fraud detection system')).toBe('fraud detection');
  });
});
