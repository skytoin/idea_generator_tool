import { describe, it, expect } from 'vitest';
import { SOURCE_REPORT_SCHEMA, SOURCE_STATUS } from '../../../lib/types/source-report';

function buildValidReport() {
  return {
    name: 'hn',
    status: 'ok' as const,
    signals_count: 5,
    queries_ran: ['hn: x'],
    queries_with_zero_results: [],
    error: null,
    elapsed_ms: 1200,
    cost_usd: 0.01,
  };
}

describe('SOURCE_REPORT_SCHEMA', () => {
  it('parses a valid ok report', () => {
    const result = SOURCE_REPORT_SCHEMA.safeParse(buildValidReport());
    expect(result.success).toBe(true);
  });

  it('parses a timeout report with non-null error', () => {
    const r = {
      ...buildValidReport(),
      status: 'timeout' as const,
      error: { kind: 'timeout', message: 'exceeded 8000ms' },
    };
    expect(SOURCE_REPORT_SCHEMA.safeParse(r).success).toBe(true);
  });

  it('rejects unknown status wtf', () => {
    const r = { ...buildValidReport(), status: 'wtf' };
    expect(SOURCE_REPORT_SCHEMA.safeParse(r).success).toBe(false);
  });

  it('rejects negative elapsed_ms', () => {
    const r = { ...buildValidReport(), elapsed_ms: -1 };
    expect(SOURCE_REPORT_SCHEMA.safeParse(r).success).toBe(false);
  });

  it('rejects negative cost_usd', () => {
    const r = { ...buildValidReport(), cost_usd: -0.01 };
    expect(SOURCE_REPORT_SCHEMA.safeParse(r).success).toBe(false);
  });

  it('SOURCE_STATUS.options equals the expected list in order', () => {
    expect(SOURCE_STATUS.options).toEqual([
      'ok',
      'ok_empty',
      'timeout',
      'denied',
      'failed',
    ]);
  });
});
