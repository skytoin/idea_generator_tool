import { describe, it, expect } from 'vitest';
import { runDryRun, type DryRunDeps } from '../../../scripts/frame-dry-run';
import { InMemoryKVStore } from '../../lib/utils/kv-store';
import { ok, err } from '../../lib/utils/result';
import type { FrameOutput } from '../../lib/types/frame-output';

const FIXED_DATE = new Date('2026-05-01T00:00:00Z');

/** Build a valid FrameOutput fixture used as the runFrame stub return value. */
function buildOutput(): FrameOutput {
  return {
    mode: 'explore',
    existing_idea: null,
    profile: {
      skills: { value: ['React'], source: 'stated' },
      time_per_week: { value: '10', source: 'stated' },
      money_available: { value: 'lt_500', source: 'stated' },
      ambition: { value: 'side_project', source: 'stated' },
      domain: { value: [], source: 'assumed' },
      insider_knowledge: { value: null, source: 'assumed' },
      anti_targets: { value: [], source: 'assumed' },
      network: { value: null, source: 'assumed' },
      audience: { value: null, source: 'assumed' },
      proprietary_access: { value: null, source: 'assumed' },
      rare_combinations: { value: null, source: 'assumed' },
      recurring_frustration: { value: null, source: 'assumed' },
      four_week_mvp: { value: null, source: 'assumed' },
      previous_attempts: { value: null, source: 'assumed' },
      customer_affinity: { value: null, source: 'assumed' },
      time_to_revenue: { value: 'no_preference', source: 'assumed' },
      customer_type_preference: { value: 'no_preference', source: 'assumed' },
      trigger: { value: null, source: 'assumed' },
      legal_constraints: { value: null, source: 'assumed' },
      additional_context_raw: '',
      schema_version: 1,
      profile_hash: 'abcdef0123456789',
    },
    narrative: {
      prose: 'A prose narrative about the founder.'.padEnd(60, '.'),
      word_count: 7,
      generated_at: FIXED_DATE.toISOString(),
    },
    directives: {
      tech_scout: {
        keywords: ['react'],
        exclude: [],
        notes: 'tech notes',
        target_sources: ['hn'],
        timeframe: 'last 12 months',
      },
      pain_scanner: {
        keywords: ['pain'],
        exclude: [],
        notes: 'pain notes',
        target_subreddits: ['r/webdev'],
        personas: ['solo founder'],
      },
      market_scanner: {
        keywords: ['saas'],
        exclude: [],
        notes: 'market notes',
        competitor_domains: ['acme.com'],
        yc_batches_to_scan: ['S23'],
      },
      change_scanner: {
        keywords: ['regs'],
        exclude: [],
        notes: 'change notes',
        regulatory_areas: ['GDPR'],
        geographic: ['US'],
      },
    },
    debug: {
      trace: [
        { field: 'skills', consumer: 'narrative' },
        { field: 'ambition', consumer: 'narrative' },
      ],
      cost_usd: 0.01,
      generated_at: FIXED_DATE.toISOString(),
    },
  };
}

type Captured = { out: string[]; err: string[] };

/** Build a dry-run deps object with capture arrays for stdout/stderr. */
function buildDeps(overrides: Partial<DryRunDeps>): { deps: DryRunDeps; captured: Captured } {
  const captured: Captured = { out: [], err: [] };
  const deps: DryRunDeps = {
    readFile: () => {
      throw new Error('readFile not provided');
    },
    write: (msg) => captured.out.push(msg),
    error: (msg) => captured.err.push(msg),
    runFrame: async () => ok(buildOutput()),
    clock: () => FIXED_DATE,
    kv: new InMemoryKVStore(),
    ...overrides,
  };
  return { deps, captured };
}

describe('runDryRun', () => {
  it('prints usage and exits 1 when no argument is supplied', async () => {
    const { deps, captured } = buildDeps({});
    const code = await runDryRun([], deps);
    expect(code).toBe(1);
    expect(captured.err.join('\n')).toContain('Usage');
  });

  it('exits 4 when readFile throws', async () => {
    const { deps, captured } = buildDeps({
      readFile: () => {
        throw new Error('ENOENT');
      },
    });
    const code = await runDryRun(['missing.json'], deps);
    expect(code).toBe(4);
    expect(captured.err.join('\n')).toContain('ENOENT');
  });

  it('exits 2 when the file contents are not valid JSON', async () => {
    const { deps, captured } = buildDeps({ readFile: () => '{not json' });
    const code = await runDryRun(['bad.json'], deps);
    expect(code).toBe(2);
    expect(captured.err.join('\n').toLowerCase()).toContain('json');
  });

  it('exits 2 when the fixture fails FRAME_INPUT_SCHEMA validation', async () => {
    const { deps, captured } = buildDeps({
      readFile: () =>
        JSON.stringify({
          mode: 'explore',
          skills: [],
          time_per_week: '10',
          money_available: 'lt_500',
          ambition: 'side_project',
        }),
    });
    const code = await runDryRun(['bad-fixture.json'], deps);
    expect(code).toBe(2);
    expect(captured.err.join('\n')).toContain('validation');
  });

  it('exits 3 when runFrame returns an error', async () => {
    const { deps, captured } = buildDeps({
      readFile: () =>
        JSON.stringify({
          mode: 'explore',
          skills: ['React'],
          time_per_week: '10',
          money_available: 'lt_500',
          ambition: 'side_project',
        }),
      runFrame: async () => err({ kind: 'extract_failed', message: 'boom' }),
    });
    const code = await runDryRun(['ok.json'], deps);
    expect(code).toBe(3);
    expect(captured.err.join('\n')).toContain('extract_failed');
  });

  it('prints every section header on a successful run', async () => {
    const { deps, captured } = buildDeps({
      readFile: () =>
        JSON.stringify({
          mode: 'explore',
          skills: ['React'],
          time_per_week: '10',
          money_available: 'lt_500',
          ambition: 'side_project',
        }),
    });
    const code = await runDryRun(['ok.json'], deps);
    expect(code).toBe(0);
    const out = captured.out.join('\n');
    expect(out).toContain('Profile');
    expect(out).toContain('Narrative');
    expect(out).toContain('Directives');
    expect(out).toContain('Trace');
    expect(out).toContain('Cost');
  });
});
