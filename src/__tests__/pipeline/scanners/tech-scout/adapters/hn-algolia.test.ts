import { describe, it, expect, afterEach, vi } from 'vitest';
import { hnAlgoliaAdapter } from '../../../../../pipeline/scanners/tech-scout/adapters/hn-algolia';
import {
  setHnResponse,
  resetScannerMocks,
} from '../../../../mocks/scanner-mocks';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  RawItem,
} from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';

/** Build a minimum valid ExpandedQueryPlan for test reuse. */
function buildPlan(
  overrides: Partial<ExpandedQueryPlan> = {},
): ExpandedQueryPlan {
  return {
    expanded_keywords: [
      'fraud detection',
      'anomaly detection',
      'risk scoring',
      'payments fraud',
      'ML',
    ],
    arxiv_categories: ['cs.LG'],
    github_languages: ['python'],
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
      'created_at' in overrides
        ? overrides.created_at
        : '2026-03-14T12:00:00.000Z',
    created_at_i: overrides.created_at_i ?? 1742558400,
    _tags: overrides._tags ?? ['story', 'author_alice', 'story_12345'],
  };
}

describe('hnAlgoliaAdapter.planQueries', () => {
  it('picks top 3 expanded_keywords (caps at MAX_QUERIES)', () => {
    const queries = hnAlgoliaAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries).toHaveLength(3);
    expect(queries.map((q) => q.params.query)).toEqual([
      'fraud detection',
      'anomaly detection',
      'risk scoring',
    ]);
  });

  it('uses HN tags=story and numericFilters with created_at_i + points', () => {
    const plan = buildPlan();
    const queries = hnAlgoliaAdapter.planQueries(plan, buildDirective());
    const cutoff = Math.floor(new Date(plan.timeframe_iso).getTime() / 1000);
    for (const q of queries) {
      expect(q.params.tags).toBe('story');
      expect(q.params.numericFilters).toBe(
        `created_at_i>${cutoff},points>5`,
      );
      expect(q.params.hitsPerPage).toBe(30);
      expect(typeof q.params.query).toBe('string');
    }
  });

  it('labels are human-readable "hn: <keyword>"', () => {
    const queries = hnAlgoliaAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries.map((q) => q.label)).toEqual([
      'hn: fraud detection',
      'hn: anomaly detection',
      'hn: risk scoring',
    ]);
  });

  it('returns 1 query when there is only 1 expanded keyword', () => {
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({ expanded_keywords: ['x'] }),
      buildDirective(),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]?.params.query).toBe('x');
    expect(queries[0]?.label).toBe('hn: x');
  });

  it('returns empty array when expanded_keywords is empty', () => {
    const queries = hnAlgoliaAdapter.planQueries(
      buildPlan({ expanded_keywords: [] }),
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
    expect(signal.score).toEqual({ novelty: 5, specificity: 5, recency: 5 });
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
