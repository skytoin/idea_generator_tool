import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  arxivAdapter,
  fetchQueries,
} from '../../../../../pipeline/scanners/tech-scout/adapters/arxiv';
import {
  setArxivResponse,
  resetScannerMocks,
} from '../../../../mocks/scanner-mocks';
import { SAMPLE_ARXIV_XML } from '../../../../mocks/arxiv-fixtures';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
} from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';

/** Build a minimum valid ExpandedQueryPlan for arxiv adapter tests. */
function buildPlan(
  overrides: Partial<ExpandedQueryPlan> = {},
): ExpandedQueryPlan {
  return {
    expanded_keywords: ['fraud', 'anomaly', 'ML'],
    arxiv_categories: ['cs.LG', 'cs.CR', 'stat.ML'],
    github_languages: ['python'],
    domain_tags: ['fintech'],
    timeframe_iso: '2025-10-11T12:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimum valid tech_scout directive for arxiv adapter tests. */
function buildDirective(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: [],
    notes: '',
    target_sources: ['arxiv'],
    timeframe: 'last 6 months',
  };
}

/** No-op sleep used across fetch tests so we don't wait 3+ seconds. */
const noSleep = (): Promise<void> => Promise.resolve();

describe('arxivAdapter.planQueries', () => {
  it('cross-products top 2 categories × top 2 keywords, capped at MAX_QUERIES=4', () => {
    const queries = arxivAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries).toHaveLength(4);
    const labels = queries.map((q) => q.label);
    expect(labels).toEqual([
      'arxiv: cat:cs.LG × "fraud"',
      'arxiv: cat:cs.LG × "anomaly"',
      'arxiv: cat:cs.CR × "fraud"',
      'arxiv: cat:cs.CR × "anomaly"',
    ]);
  });

  it('returns an empty array when arxiv_categories is empty (no crash)', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({ arxiv_categories: [] }),
      buildDirective(),
    );
    expect(queries).toEqual([]);
  });

  it('labels follow the "arxiv: cat:<cat> × \\"<keyword>\\"" format', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        expanded_keywords: ['fraud'],
      }),
      buildDirective(),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]?.label).toBe('arxiv: cat:cs.LG × "fraud"');
  });

  it('every query has sortBy, sortOrder, max_results, and a search_query param', () => {
    const queries = arxivAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(q.params.sortBy).toBe('submittedDate');
      expect(q.params.sortOrder).toBe('descending');
      expect(q.params.max_results).toBe('20');
      expect(typeof q.params.search_query).toBe('string');
      expect(q.params.search_query as string).toMatch(/^cat:.+\+AND\+abs:/);
    }
  });

  it('search_query URL-encodes the keyword with surrounding quotes', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        expanded_keywords: ['fraud detection'],
      }),
      buildDirective(),
    );
    expect(queries[0]?.params.search_query).toBe(
      `cat:cs.LG+AND+abs:${encodeURIComponent('"fraud detection"')}`,
    );
  });
});

describe('arxivAdapter.fetch', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('parses arxiv XML into 3 RawItems from SAMPLE_ARXIV_XML', async () => {
    setArxivResponse('arxiv-smoke', SAMPLE_ARXIV_XML);
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-smoke');

    const query: SourceQuery = {
      label: 'arxiv: cat:cs.LG × "fraud"',
      params: {
        search_query: `cat:cs.LG+AND+abs:${encodeURIComponent('"fraud"')}`,
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    };

    const items = await fetchQueries(
      [query],
      { timeoutMs: 10_000, signal: undefined },
      noSleep,
    );

    expect(items).toHaveLength(3);
    expect(items[0]?.source).toBe('arxiv');
    expect(items.every((i) => i.source === 'arxiv')).toBe(true);
  });

  it('returns an empty array when feed has zero entries', async () => {
    setArxivResponse(
      'arxiv-empty',
      '<feed xmlns="http://www.w3.org/2005/Atom"/>',
    );
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-empty');

    const query: SourceQuery = {
      label: 'arxiv: cat:cs.LG × "fraud"',
      params: {
        search_query: 'cat:cs.LG+AND+abs:%22fraud%22',
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    };

    const items = await fetchQueries(
      [query],
      { timeoutMs: 10_000, signal: undefined },
      noSleep,
    );

    expect(items).toEqual([]);
  });

  it('handles single-entry response (object-vs-array fast-xml-parser quirk)', async () => {
    const singleEntryXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2601.99999v1</id>
    <title>Only One Paper</title>
    <summary>Just a single entry.</summary>
    <published>2026-03-14T12:00:00Z</published>
    <updated>2026-03-14T12:00:00Z</updated>
    <category term="cs.LG"/>
  </entry>
</feed>`;
    setArxivResponse('arxiv-single', singleEntryXml);
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-single');

    const query: SourceQuery = {
      label: 'arxiv: cat:cs.LG × "fraud"',
      params: {
        search_query: 'cat:cs.LG+AND+abs:%22fraud%22',
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    };

    const items = await fetchQueries(
      [query],
      { timeoutMs: 10_000, signal: undefined },
      noSleep,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('arxiv');
  });

  it('sleeps between queries (once, for ≥3000ms) but not before first or after last', async () => {
    setArxivResponse('arxiv-sleep', SAMPLE_ARXIV_XML);
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-sleep');

    const sleepSpy = vi.fn<(ms: number) => Promise<void>>(() =>
      Promise.resolve(),
    );

    const queries: SourceQuery[] = [
      {
        label: 'arxiv: cat:cs.LG × "fraud"',
        params: {
          search_query: 'cat:cs.LG+AND+abs:%22fraud%22',
          max_results: '20',
          sortBy: 'submittedDate',
          sortOrder: 'descending',
        },
      },
      {
        label: 'arxiv: cat:cs.LG × "anomaly"',
        params: {
          search_query: 'cat:cs.LG+AND+abs:%22anomaly%22',
          max_results: '20',
          sortBy: 'submittedDate',
          sortOrder: 'descending',
        },
      },
    ];

    await fetchQueries(
      queries,
      { timeoutMs: 10_000, signal: undefined },
      sleepSpy,
    );

    expect(sleepSpy).toHaveBeenCalledTimes(1);
    const sleepMs = sleepSpy.mock.calls[0]?.[0] ?? 0;
    expect(sleepMs).toBeGreaterThanOrEqual(3000);
  });
});

describe('arxivAdapter.normalize', () => {
  it('converts an arxiv entry into a canonical Signal', () => {
    const entry = {
      id: 'http://arxiv.org/abs/2601.12345v1',
      title: 'Some title',
      summary: '  Long abstract text describing the method.  ',
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }, { '@_term': 'cs.CR' }],
    };
    const raw: RawItem = { source: 'arxiv', data: entry };
    const signal = arxivAdapter.normalize(raw);

    expect(signal.source).toBe('arxiv');
    expect(signal.title).toBe('Some title');
    expect(signal.url).toBe('http://arxiv.org/abs/2601.12345');
    expect(signal.date).toBe('2026-03-14T12:00:00Z');
    expect(signal.snippet).toBe(
      'Long abstract text describing the method.',
    );
    expect(signal.category).toBe('research');
    expect(signal.raw).toBe(entry);
    expect(signal.score).toEqual({ novelty: 5, specificity: 5, recency: 5 });
  });

  it('strips v<N> version suffix from id URL for dedupe consistency (v2 case)', () => {
    const entry = {
      id: 'http://arxiv.org/abs/2401.12345v2',
      title: 'Versioned paper',
      summary: 'A paper revised several times.',
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }],
    };
    const signal = arxivAdapter.normalize({ source: 'arxiv', data: entry });
    expect(signal.url).toBe('http://arxiv.org/abs/2401.12345');
    expect(signal.url.endsWith('2401.12345')).toBe(true);
  });

  it('truncates abstracts longer than 200 chars and appends an ellipsis', () => {
    const longAbstract = 'a'.repeat(250);
    const entry = {
      id: 'http://arxiv.org/abs/2601.00001v1',
      title: 'Long abstract paper',
      summary: longAbstract,
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }],
    };
    const signal = arxivAdapter.normalize({ source: 'arxiv', data: entry });
    expect(signal.snippet.length).toBe(201);
    expect(signal.snippet.startsWith('a'.repeat(200))).toBe(true);
    expect(signal.snippet.endsWith('…')).toBe(true);
  });

  it('keeps the full abstract (no ellipsis) when shorter than 200 chars', () => {
    const shortAbstract = 'A short abstract.';
    const entry = {
      id: 'http://arxiv.org/abs/2601.00002v1',
      title: 'Short abstract paper',
      summary: shortAbstract,
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }],
    };
    const signal = arxivAdapter.normalize({ source: 'arxiv', data: entry });
    expect(signal.snippet).toBe(shortAbstract);
    expect(signal.snippet.endsWith('…')).toBe(false);
  });

  it('collapses internal whitespace in title', () => {
    const entry = {
      id: 'http://arxiv.org/abs/2601.00003v1',
      title: 'Paper  with\n  extra   spaces',
      summary: 'abstract',
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }],
    };
    const signal = arxivAdapter.normalize({ source: 'arxiv', data: entry });
    expect(signal.title).toBe('Paper with extra spaces');
  });
});

describe('arxivAdapter interface', () => {
  it('exports name "arxiv"', () => {
    expect(arxivAdapter.name).toBe('arxiv');
  });

  it('conforms to the SourceAdapter interface (type check)', () => {
    const _typed: SourceAdapter = arxivAdapter;
    expect(_typed).toBe(arxivAdapter);
  });
});
