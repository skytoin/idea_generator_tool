import { describe, it, expect } from 'vitest';
import {
  SCANNER_REPORT_SCHEMA,
  SCANNER_STATUS,
} from '../../../lib/types/scanner-report';

function buildMinValidReport() {
  return {
    scanner: 'tech_scout',
    status: 'ok' as const,
    signals: [],
    source_reports: [],
    expansion_plan: null,
    total_raw_items: 0,
    signals_after_dedupe: 0,
    signals_after_exclude: 0,
    cost_usd: 0,
    elapsed_ms: 0,
    generated_at: '2026-04-08T12:00:00.000Z',
    errors: [],
    warnings: [],
  };
}

function buildSignal(overrides: Record<string, unknown> = {}) {
  return {
    source: 'hn_algolia',
    title: 'Sample Signal',
    url: 'https://example.com/a',
    date: '2026-04-01T00:00:00.000Z',
    snippet: 'snippet',
    score: { novelty: 5, specificity: 5, recency: 5 },
    category: 'tech_capability' as const,
    raw: {},
    ...overrides,
  };
}

function buildSourceReport(name: string) {
  return {
    name,
    status: 'ok' as const,
    signals_count: 3,
    queries_ran: [`${name}: q`],
    queries_with_zero_results: [],
    error: null,
    elapsed_ms: 500,
    cost_usd: 0.001,
  };
}

describe('SCANNER_REPORT_SCHEMA', () => {
  it('parses a minimum valid report', () => {
    const result = SCANNER_REPORT_SCHEMA.safeParse(buildMinValidReport());
    expect(result.success).toBe(true);
  });

  it('rejects unknown scanner status broken', () => {
    const r = { ...buildMinValidReport(), status: 'broken' };
    expect(SCANNER_REPORT_SCHEMA.safeParse(r).success).toBe(false);
  });

  it('accepts expansion_plan: null', () => {
    const r = { ...buildMinValidReport(), expansion_plan: null };
    expect(SCANNER_REPORT_SCHEMA.safeParse(r).success).toBe(true);
  });

  it('accepts expansion_plan as an arbitrary record', () => {
    const r = {
      ...buildMinValidReport(),
      expansion_plan: { expanded_keywords: ['a', 'b'] },
    };
    expect(SCANNER_REPORT_SCHEMA.safeParse(r).success).toBe(true);
  });

  it('parses a report with 3 source_reports, 10 signals, 1 error, 1 warning', () => {
    const r = {
      ...buildMinValidReport(),
      status: 'partial' as const,
      signals: Array.from({ length: 10 }, (_, i) =>
        buildSignal({ url: `https://example.com/${i}` }),
      ),
      source_reports: [
        buildSourceReport('hn_algolia'),
        buildSourceReport('arxiv'),
        buildSourceReport('github'),
      ],
      total_raw_items: 42,
      signals_after_dedupe: 20,
      signals_after_exclude: 10,
      errors: [{ kind: 'network', message: 'connection reset' }],
      warnings: ['expansion plan returned zero extra keywords'],
    };
    expect(SCANNER_REPORT_SCHEMA.safeParse(r).success).toBe(true);
  });

  it('rejects invalid ISO datetime in generated_at', () => {
    const r = { ...buildMinValidReport(), generated_at: 'not-a-date' };
    expect(SCANNER_REPORT_SCHEMA.safeParse(r).success).toBe(false);
  });

  it('SCANNER_STATUS.options equals the expected list', () => {
    expect(SCANNER_STATUS.options).toEqual(['ok', 'partial', 'failed']);
  });
});
