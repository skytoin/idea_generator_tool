import { describe, it, expect } from 'vitest';
import {
  FIRST_PASS_SUMMARY_SCHEMA,
  QUERY_RUN_SCHEMA,
  TOP_SIGNAL_SUMMARY_SCHEMA,
} from '../../../lib/types/two-pass-state';

describe('QUERY_RUN_SCHEMA', () => {
  it('parses a valid query run entry', () => {
    const parsed = QUERY_RUN_SCHEMA.parse({
      source: 'hn_algolia',
      label: 'hn: MCP launches',
      result_count: 12,
    });
    expect(parsed.result_count).toBe(12);
  });

  it('rejects a negative result_count', () => {
    expect(() =>
      QUERY_RUN_SCHEMA.parse({ source: 'hn', label: 'x', result_count: -1 }),
    ).toThrow();
  });

  it('rejects a missing label', () => {
    expect(() =>
      QUERY_RUN_SCHEMA.parse({ source: 'hn', result_count: 5 }),
    ).toThrow();
  });
});

describe('TOP_SIGNAL_SUMMARY_SCHEMA', () => {
  it('parses a valid entry with relevance and recency scores', () => {
    const parsed = TOP_SIGNAL_SUMMARY_SCHEMA.parse({
      source: 'arxiv',
      title: 'Paper on X',
      relevance: 8,
      recency: 9,
    });
    expect(parsed.title).toBe('Paper on X');
  });

  it('rejects relevance > 10', () => {
    expect(() =>
      TOP_SIGNAL_SUMMARY_SCHEMA.parse({
        source: 'arxiv',
        title: 'x',
        relevance: 11,
        recency: 5,
      }),
    ).toThrow();
  });
});

describe('FIRST_PASS_SUMMARY_SCHEMA', () => {
  it('parses a full summary with all fields populated', () => {
    const parsed = FIRST_PASS_SUMMARY_SCHEMA.parse({
      queries_run: [
        { source: 'hn_algolia', label: 'hn: q1', result_count: 10 },
        { source: 'arxiv', label: 'arxiv: q1', result_count: 0 },
      ],
      dense_directions: ['hn: q1'],
      sparse_directions: [],
      empty_queries: ['arxiv: q1'],
      top_signal_summary: [
        { source: 'hn_algolia', title: 'Top A', relevance: 9, recency: 8 },
      ],
      exhausted_terms: ['q1'],
    });
    expect(parsed.empty_queries).toEqual(['arxiv: q1']);
  });

  it('accepts an empty summary with all arrays empty', () => {
    const parsed = FIRST_PASS_SUMMARY_SCHEMA.parse({
      queries_run: [],
      dense_directions: [],
      sparse_directions: [],
      empty_queries: [],
      top_signal_summary: [],
      exhausted_terms: [],
    });
    expect(parsed.queries_run).toHaveLength(0);
  });

  it('rejects more than 15 top_signal_summary entries', () => {
    const many = Array.from({ length: 16 }, (_, i) => ({
      source: 'hn_algolia',
      title: `t${i}`,
      relevance: 5,
      recency: 5,
    }));
    expect(() =>
      FIRST_PASS_SUMMARY_SCHEMA.parse({
        queries_run: [],
        dense_directions: [],
        sparse_directions: [],
        empty_queries: [],
        top_signal_summary: many,
        exhausted_terms: [],
      }),
    ).toThrow();
  });
});
