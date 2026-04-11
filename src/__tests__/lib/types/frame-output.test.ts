import { describe, it, expect } from 'vitest';
import { FRAME_OUTPUT_SCHEMA } from '../../../lib/types/frame-output';
import type { FounderProfile } from '../../../lib/types/founder-profile';

function buildValidProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['React']),
    time_per_week: stated('10'),
    money_available: stated('lt_500'),
    ambition: stated('side_project'),
    domain: stated([{ area: 'fintech', years: 3 }]),
    insider_knowledge: stated('Internal QA'),
    anti_targets: stated(['crypto']),
    network: stated('Some'),
    audience: stated('Small'),
    proprietary_access: stated('None'),
    rare_combinations: stated('None'),
    recurring_frustration: stated('Slow builds'),
    four_week_mvp: stated('Scheduler'),
    previous_attempts: stated('Newsletter'),
    customer_affinity: stated('Developers'),
    time_to_revenue: stated('2_months'),
    customer_type_preference: stated('b2b'),
    trigger: stated('Layoff'),
    legal_constraints: stated('None'),
    divergence_level: stated('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'abc',
  };
}

function buildValidFrameOutput() {
  return {
    mode: 'explore' as const,
    existing_idea: null,
    profile: buildValidProfile(),
    narrative: {
      prose: 'A seasoned founder with diverse skills and realistic ambitions for a side project.',
      word_count: 14,
      generated_at: '2026-04-08T12:00:00.000Z',
    },
    directives: {
      tech_scout: {
        keywords: [],
        exclude: [],
        notes: '',
        target_sources: [],
        timeframe: '',
      },
      pain_scanner: {
        keywords: [],
        exclude: [],
        notes: '',
        target_subreddits: [],
        personas: [],
      },
      market_scanner: {
        keywords: [],
        exclude: [],
        notes: '',
        competitor_domains: [],
        yc_batches_to_scan: [],
      },
      change_scanner: {
        keywords: [],
        exclude: [],
        notes: '',
        regulatory_areas: [],
        geographic: [],
      },
    },
    debug: {
      trace: [{ field: 'skills', consumer: 'narrative' }],
      cost_usd: 0.01,
      generated_at: '2026-04-08T12:00:00.000Z',
    },
  };
}

function buildMinValidScannerReport() {
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

describe('FRAME_OUTPUT_SCHEMA', () => {
  it('accepts a valid FrameOutput', () => {
    const result = FRAME_OUTPUT_SCHEMA.safeParse(buildValidFrameOutput());
    expect(result.success).toBe(true);
  });

  it('rejects if profile is missing', () => {
    const o = buildValidFrameOutput() as Record<string, unknown>;
    delete o.profile;
    expect(FRAME_OUTPUT_SCHEMA.safeParse(o).success).toBe(false);
  });

  it('accepts existing_idea: null when mode: explore', () => {
    const o = { ...buildValidFrameOutput(), mode: 'explore' as const, existing_idea: null };
    expect(FRAME_OUTPUT_SCHEMA.safeParse(o).success).toBe(true);
  });

  it('rejects negative cost_usd', () => {
    const o = buildValidFrameOutput();
    const bad = { ...o, debug: { ...o.debug, cost_usd: -1 } };
    expect(FRAME_OUTPUT_SCHEMA.safeParse(bad).success).toBe(false);
  });

  it('rejects malformed trace entries', () => {
    const o = buildValidFrameOutput();
    const bad = {
      ...o,
      debug: { ...o.debug, trace: [{ field: 'skills' }] },
    };
    expect(FRAME_OUTPUT_SCHEMA.safeParse(bad).success).toBe(false);
  });

  it('accepts a FrameOutput without scanners (backward-compat)', () => {
    const o = buildValidFrameOutput();
    expect(FRAME_OUTPUT_SCHEMA.safeParse(o).success).toBe(true);
  });

  it('accepts a FrameOutput with scanners.tech_scout set to a minimum valid ScannerReport', () => {
    const o = {
      ...buildValidFrameOutput(),
      scanners: { tech_scout: buildMinValidScannerReport() },
    };
    expect(FRAME_OUTPUT_SCHEMA.safeParse(o).success).toBe(true);
  });

  it('rejects scanners.tech_scout with an unknown scanner status', () => {
    const o = {
      ...buildValidFrameOutput(),
      scanners: {
        tech_scout: { ...buildMinValidScannerReport(), status: 'broken' },
      },
    };
    expect(FRAME_OUTPUT_SCHEMA.safeParse(o).success).toBe(false);
  });

  it('accepts scanners: undefined and scanners: {}', () => {
    const o1 = { ...buildValidFrameOutput(), scanners: undefined };
    expect(FRAME_OUTPUT_SCHEMA.safeParse(o1).success).toBe(true);
    const o2 = { ...buildValidFrameOutput(), scanners: {} };
    expect(FRAME_OUTPUT_SCHEMA.safeParse(o2).success).toBe(true);
  });
});
