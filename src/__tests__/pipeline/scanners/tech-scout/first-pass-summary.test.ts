import { describe, it, expect } from 'vitest';
import { summarizeFirstPass } from '../../../../pipeline/scanners/tech-scout/first-pass-summary';
import type { Signal } from '../../../../lib/types/signal';
import type { SourceReport } from '../../../../lib/types/source-report';

/** Build a minimum-valid SourceReport for test reuse. */
function buildReport(overrides: Partial<SourceReport> = {}): SourceReport {
  return {
    name: 'hn_algolia',
    status: 'ok',
    signals_count: 0,
    queries_ran: [],
    queries_with_zero_results: [],
    error: null,
    elapsed_ms: 100,
    cost_usd: 0,
    ...overrides,
  };
}

/** Build a minimum-valid Signal for test reuse. */
function buildSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    source: 'hn_algolia',
    title: 'Test',
    url: 'https://example.com/x',
    snippet: 'snippet',
    date: '2026-03-01T00:00:00Z',
    score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
    category: 'tech_capability',
    raw: {},
    ...overrides,
  };
}

describe('summarizeFirstPass — classification', () => {
  it('classifies a query with zero results into empty_queries', () => {
    const report = buildReport({
      name: 'hn_algolia',
      signals_count: 0,
      queries_ran: ['hn: q1'],
      queries_with_zero_results: ['hn: q1'],
    });
    const s = summarizeFirstPass({ sourceReports: [report], enrichedSignals: [] });
    expect(s.empty_queries).toEqual(['hn: q1']);
    expect(s.dense_directions).toEqual([]);
    expect(s.sparse_directions).toEqual([]);
  });

  it('classifies a query returning 10+ per-query avg into dense and exhausted', () => {
    const report = buildReport({
      name: 'hn_algolia',
      signals_count: 12,
      queries_ran: ['hn: dense'],
      queries_with_zero_results: [],
    });
    const s = summarizeFirstPass({ sourceReports: [report], enrichedSignals: [] });
    expect(s.dense_directions).toContain('hn: dense');
    expect(s.exhausted_terms).toContain('hn: dense');
  });

  it('classifies mid-count queries as sparse (>=1, <5)', () => {
    // Two queries ran, non-empty count=2, signals_count=4 → avg=2 per query → sparse.
    const report = buildReport({
      name: 'hn_algolia',
      signals_count: 4,
      queries_ran: ['hn: a', 'hn: b'],
      queries_with_zero_results: [],
    });
    const s = summarizeFirstPass({ sourceReports: [report], enrichedSignals: [] });
    expect(s.sparse_directions).toContain('hn: a');
    expect(s.sparse_directions).toContain('hn: b');
  });

  it('handles mixed buckets across one source', () => {
    const report = buildReport({
      name: 'hn_algolia',
      signals_count: 6,
      queries_ran: ['hn: fresh', 'hn: nada'],
      queries_with_zero_results: ['hn: nada'],
    });
    const s = summarizeFirstPass({ sourceReports: [report], enrichedSignals: [] });
    // One non-empty query, signals_count=6 → avg=6 → dense + exhausted.
    expect(s.dense_directions).toContain('hn: fresh');
    expect(s.empty_queries).toContain('hn: nada');
  });

  it('captures queries_run entries for every query across every source', () => {
    const reports = [
      buildReport({
        name: 'hn_algolia',
        signals_count: 3,
        queries_ran: ['hn: a'],
      }),
      buildReport({
        name: 'arxiv',
        signals_count: 8,
        queries_ran: ['arxiv: a'],
      }),
    ];
    const s = summarizeFirstPass({ sourceReports: reports, enrichedSignals: [] });
    expect(s.queries_run).toHaveLength(2);
    expect(s.queries_run.some((q) => q.source === 'hn_algolia')).toBe(true);
    expect(s.queries_run.some((q) => q.source === 'arxiv')).toBe(true);
  });
});

describe('summarizeFirstPass — top signal collection', () => {
  it('picks the top 5 enriched signals per source sorted by relevance+recency', () => {
    const signals = [
      buildSignal({
        source: 'hn_algolia',
        title: 'top',
        url: 'https://a.com',
        score: { novelty: 5, specificity: 5, recency: 9, relevance: 9 },
      }),
      buildSignal({
        source: 'hn_algolia',
        title: 'mid',
        url: 'https://b.com',
        score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
      }),
      buildSignal({
        source: 'hn_algolia',
        title: 'low',
        url: 'https://c.com',
        score: { novelty: 5, specificity: 5, recency: 1, relevance: 1 },
      }),
    ];
    const s = summarizeFirstPass({ sourceReports: [], enrichedSignals: signals });
    expect(s.top_signal_summary[0]!.title).toBe('top');
  });

  it('caps at 5 per source even when more are provided', () => {
    const signals = Array.from({ length: 10 }, (_, i) =>
      buildSignal({
        source: 'hn_algolia',
        title: `s${i}`,
        url: `https://x.com/${i}`,
      }),
    );
    const s = summarizeFirstPass({ sourceReports: [], enrichedSignals: signals });
    expect(s.top_signal_summary.filter((t) => t.source === 'hn_algolia')).toHaveLength(5);
  });

  it('returns empty top_signal_summary when no enriched signals are given', () => {
    const s = summarizeFirstPass({ sourceReports: [], enrichedSignals: [] });
    expect(s.top_signal_summary).toEqual([]);
  });
});

describe('summarizeFirstPass — regression: 2026-04-12 fixture shape', () => {
  it('correctly partitions the production-run directions (empty github, dense hn)', () => {
    const reports = [
      buildReport({
        name: 'hn_algolia',
        signals_count: 16,
        queries_ran: ['hn: MCP launch', 'hn: saas for collection'],
        queries_with_zero_results: [],
      }),
      buildReport({
        name: 'arxiv',
        signals_count: 20,
        queries_ran: ['arxiv: data fusion', 'arxiv: transfer learning'],
        queries_with_zero_results: [],
      }),
      buildReport({
        name: 'github',
        signals_count: 0,
        queries_ran: [
          'github: python MCP',
          'github: user-centric SAAS',
          'github: ML model kit',
        ],
        queries_with_zero_results: [
          'github: python MCP',
          'github: user-centric SAAS',
          'github: ML model kit',
        ],
        status: 'ok_empty',
      }),
    ];
    const s = summarizeFirstPass({ sourceReports: reports, enrichedSignals: [] });
    // All github queries land in empty_queries (absence channel)
    expect(s.empty_queries).toContain('github: python MCP');
    expect(s.empty_queries).toContain('github: user-centric SAAS');
    // HN and arxiv queries saturated → dense (signals_count/queries_ran high)
    expect(s.dense_directions.some((d) => d.startsWith('hn:'))).toBe(true);
    expect(s.dense_directions.some((d) => d.startsWith('arxiv:'))).toBe(true);
  });
});

describe('summarizeFirstPass — edge cases', () => {
  it('returns a fully-empty summary when sourceReports is empty', () => {
    const s = summarizeFirstPass({ sourceReports: [], enrichedSignals: [] });
    expect(s.queries_run).toHaveLength(0);
    expect(s.dense_directions).toHaveLength(0);
    expect(s.sparse_directions).toHaveLength(0);
    expect(s.empty_queries).toHaveLength(0);
    expect(s.exhausted_terms).toHaveLength(0);
    expect(s.top_signal_summary).toHaveLength(0);
  });

  it('classifies every query as empty when a source has zero signals and no queries_with_zero_results', () => {
    // Odd-but-possible shape: adapter reported 0 signals but didn't flag zero queries.
    // avgNonZero divides signals_count by nonZeroQueries.length → 0 when both are 0.
    const report = buildReport({
      name: 'github',
      signals_count: 0,
      queries_ran: ['github: q1', 'github: q2'],
      queries_with_zero_results: [],
    });
    const s = summarizeFirstPass({ sourceReports: [report], enrichedSignals: [] });
    expect(s.empty_queries).toHaveLength(2);
  });

  it('treats a failed source as contributing 0 queries (still honors its queries_ran list)', () => {
    // A failed adapter (status: 'failed') still recorded the queries it tried.
    // Those go into the summary as zero-result queries.
    const report = buildReport({
      name: 'hn_algolia',
      status: 'failed',
      signals_count: 0,
      queries_ran: ['hn: tried'],
      queries_with_zero_results: [],
      error: { kind: 'failed', message: 'network' },
    });
    const s = summarizeFirstPass({ sourceReports: [report], enrichedSignals: [] });
    expect(s.empty_queries).toContain('hn: tried');
    expect(s.exhausted_terms).not.toContain('hn: tried');
  });

  it('top_signal_summary includes top 5 per source, not top 5 total', () => {
    // Give 3 sources 6 signals each; expect 5+5+5 = 15 in output (respecting schema max).
    const makeFor = (source: string): Signal[] =>
      Array.from({ length: 6 }, (_, i) =>
        buildSignal({
          source,
          title: `${source}-${i}`,
          url: `https://${source}.com/${i}`,
          score: { novelty: 5, specificity: 5, recency: 9 - i, relevance: 9 - i },
        }),
      );
    const all = [...makeFor('hn_algolia'), ...makeFor('arxiv'), ...makeFor('github')];
    const s = summarizeFirstPass({ sourceReports: [], enrichedSignals: all });
    expect(s.top_signal_summary).toHaveLength(15);
    const perSource = (name: string) =>
      s.top_signal_summary.filter((t) => t.source === name).length;
    expect(perSource('hn_algolia')).toBe(5);
    expect(perSource('arxiv')).toBe(5);
    expect(perSource('github')).toBe(5);
  });

  it('sorts top signals within a source by relevance+recency descending (highest first)', () => {
    const signals = [
      buildSignal({
        source: 'hn_algolia',
        title: 'mid',
        url: 'https://a.com',
        score: { novelty: 5, specificity: 5, recency: 5, relevance: 5 },
      }),
      buildSignal({
        source: 'hn_algolia',
        title: 'top',
        url: 'https://b.com',
        score: { novelty: 5, specificity: 5, recency: 10, relevance: 10 },
      }),
      buildSignal({
        source: 'hn_algolia',
        title: 'low',
        url: 'https://c.com',
        score: { novelty: 5, specificity: 5, recency: 1, relevance: 1 },
      }),
    ];
    const s = summarizeFirstPass({ sourceReports: [], enrichedSignals: signals });
    expect(s.top_signal_summary[0]!.title).toBe('top');
    expect(s.top_signal_summary[1]!.title).toBe('mid');
    expect(s.top_signal_summary[2]!.title).toBe('low');
  });
});
