import { describe, it, expect, afterEach } from 'vitest';
import { runFrame, computeProfileHash, type FrameDeps } from '../../../pipeline/steps/00-frame';
import { InMemoryKVStore, type KVStore } from '../../../lib/utils/kv-store';
import { setOpenAIResponse, resetOpenAIMock } from '../../mocks/openai-mock';
import { FRAME_OUTPUT_SCHEMA } from '../../../lib/types/frame-output';
import type { FrameInput } from '../../../lib/types/frame-input';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import aliceRaw from '../frame/fixtures/alice-minimum.json';
import bobRaw from '../frame/fixtures/bob-medium.json';
import carolRaw from '../frame/fixtures/carol-full.json';

const alice = aliceRaw as FrameInput;
const bob = bobRaw as FrameInput;
const carol = carolRaw as FrameInput;

const FIXED_DATE = new Date('2026-04-09T12:00:00Z');

function buildDeps(
  scenarios: Partial<Record<'extract' | 'narrative' | 'directives', string>>,
  kv?: KVStore,
): FrameDeps {
  return {
    clock: () => FIXED_DATE,
    kv: kv ?? new InMemoryKVStore(),
    scenarios,
  };
}

const NARRATIVE_PROSE = 'A'.repeat(60);

function extractionNullJson(): string {
  return JSON.stringify({
    domain: null,
    insider_knowledge: null,
    anti_targets: null,
    network: null,
    audience: null,
    proprietary_access: null,
    rare_combinations: null,
    recurring_frustration: null,
    four_week_mvp: null,
    previous_attempts: null,
    customer_affinity: null,
    trigger: null,
    legal_constraints: null,
  });
}

function defaultDirectives(): ScannerDirectives {
  return {
    tech_scout: {
      keywords: ['fraud ml'],
      exclude: [],
      notes: 'tech notes',
      target_sources: ['hn'],
      timeframe: 'last 12 months',
    },
    pain_scanner: {
      keywords: ['audit prep'],
      exclude: [],
      notes: 'pain notes',
      target_subreddits: ['r/soc2'],
      personas: ['solo founder'],
    },
    market_scanner: {
      keywords: ['compliance saas'],
      exclude: [],
      notes: 'market notes',
      competitor_domains: ['drata.com'],
      yc_batches_to_scan: ['S23'],
    },
    change_scanner: {
      keywords: ['aicpa'],
      exclude: [],
      notes: 'change notes',
      regulatory_areas: ['SOC-2'],
      geographic: ['US'],
    },
  };
}

function registerAllMockScenarios(prefix: string): void {
  setOpenAIResponse(`${prefix}-extract`, { content: extractionNullJson() });
  setOpenAIResponse(`${prefix}-narrative`, { content: NARRATIVE_PROSE });
  setOpenAIResponse(`${prefix}-directives`, {
    content: JSON.stringify(defaultDirectives()),
  });
}

describe('runFrame — happy paths', () => {
  afterEach(() => resetOpenAIMock());

  it('produces a valid FrameOutput for alice minimum', async () => {
    registerAllMockScenarios('alice');
    const deps = buildDeps({
      extract: 'alice-extract',
      narrative: 'alice-narrative',
      directives: 'alice-directives',
    });
    const result = await runFrame(alice, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = FRAME_OUTPUT_SCHEMA.safeParse(result.value);
    expect(parsed.success).toBe(true);
    expect(result.value.profile.skills.source).toBe('stated');
    expect(result.value.profile.audience.source).toBe('assumed');
    expect(result.value.mode).toBe('explore');
    expect(result.value.existing_idea).toBeNull();
    expect(result.value.debug.generated_at).toBe(FIXED_DATE.toISOString());
    // KV was written
    const hash = computeProfileHash(alice);
    const stored = await deps.kv.get(hash);
    expect(stored).not.toBeNull();
  });

  it('merges bob extracted audience as inferred', async () => {
    setOpenAIResponse('bob-extract', {
      content: JSON.stringify({
        domain: null,
        insider_knowledge: null,
        anti_targets: null,
        network: null,
        audience: '400 customers from theme shop',
        proprietary_access: null,
        rare_combinations: null,
        recurring_frustration: null,
        four_week_mvp: null,
        previous_attempts: null,
        customer_affinity: null,
        trigger: null,
        legal_constraints: null,
      }),
    });
    setOpenAIResponse('bob-narrative', { content: NARRATIVE_PROSE });
    setOpenAIResponse('bob-directives', {
      content: JSON.stringify(defaultDirectives()),
    });
    const result = await runFrame(bob, {
      clock: () => FIXED_DATE,
      kv: new InMemoryKVStore(),
      scenarios: {
        extract: 'bob-extract',
        narrative: 'bob-narrative',
        directives: 'bob-directives',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.profile.audience.source).toBe('inferred');
    expect(result.value.profile.audience.value).toBe('400 customers from theme shop');
  });

  it('carol refine mode produces existing_idea + directives include anti_targets', async () => {
    registerAllMockScenarios('carol');
    const result = await runFrame(carol, {
      clock: () => FIXED_DATE,
      kv: new InMemoryKVStore(),
      scenarios: {
        extract: 'carol-extract',
        narrative: 'carol-narrative',
        directives: 'carol-directives',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe('refine');
    expect(result.value.existing_idea?.description).toBe(carol.existing_idea);
    // Anti-targets propagated to every scanner exclude
    const antiTargets = result.value.profile.anti_targets.value;
    for (const scanner of [
      'tech_scout',
      'pain_scanner',
      'market_scanner',
      'change_scanner',
    ] as const) {
      for (const a of antiTargets) {
        expect(result.value.directives[scanner].exclude).toContain(a);
      }
      // existing idea in notes
      expect(result.value.directives[scanner].notes).toContain(
        carol.existing_idea ?? '',
      );
    }
  });
});

describe('runFrame — error paths', () => {
  afterEach(() => resetOpenAIMock());

  it('returns invalid_input for an input missing skills', async () => {
    const broken = { ...alice } as Record<string, unknown>;
    delete broken.skills;
    const result = await runFrame(broken as FrameInput, buildDeps({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid_input');
  });

  it('returns extract_failed when extraction LLM fails', async () => {
    // bob has non-empty additional_context, so Phase 2 runs. An unregistered
    // scenario falls through to the default response which does not match
    // the extraction schema -> llm_failed surface as extract_failed.
    const result = await runFrame(bob, buildDeps({ extract: 'no-such-scenario' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('extract_failed');
  });

  it('returns narrative_failed when narrative LLM fails', async () => {
    setOpenAIResponse('extract-ok', { content: extractionNullJson() });
    const result = await runFrame(
      bob,
      buildDeps({ extract: 'extract-ok', narrative: 'no-such-narrative' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('narrative_failed');
  });

  it('returns directives_failed when directives LLM fails', async () => {
    setOpenAIResponse('extract-ok', { content: extractionNullJson() });
    setOpenAIResponse('narrative-ok', { content: NARRATIVE_PROSE });
    const result = await runFrame(
      bob,
      buildDeps({
        extract: 'extract-ok',
        narrative: 'narrative-ok',
        directives: 'no-such-directives',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('directives_failed');
  });

  it('returns persistence_failed when KV throws', async () => {
    registerAllMockScenarios('persist');
    const brokenKV: KVStore = {
      get: async () => null,
      set: async () => {
        throw new Error('disk full');
      },
      delete: async () => {},
      has: async () => false,
    };
    const result = await runFrame(alice, {
      clock: () => FIXED_DATE,
      kv: brokenKV,
      scenarios: {
        extract: 'persist-extract',
        narrative: 'persist-narrative',
        directives: 'persist-directives',
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('persistence_failed');
  });
});

describe('runFrame — idempotence and persistence round-trip', () => {
  afterEach(() => resetOpenAIMock());

  it('identical inputs + fixed clock produce identical FrameOutput', async () => {
    registerAllMockScenarios('idem');
    const a = await runFrame(
      alice,
      buildDeps({
        extract: 'idem-extract',
        narrative: 'idem-narrative',
        directives: 'idem-directives',
      }),
    );
    const b = await runFrame(
      alice,
      buildDeps({
        extract: 'idem-extract',
        narrative: 'idem-narrative',
        directives: 'idem-directives',
      }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).toEqual(b.value);
  });

  it('persisted KV entry round-trips back through FRAME_OUTPUT_SCHEMA', async () => {
    registerAllMockScenarios('round');
    const kv = new InMemoryKVStore();
    const result = await runFrame(alice, {
      clock: () => FIXED_DATE,
      kv,
      scenarios: {
        extract: 'round-extract',
        narrative: 'round-narrative',
        directives: 'round-directives',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hash = computeProfileHash(alice);
    const raw = await kv.get(hash);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    const parsed = FRAME_OUTPUT_SCHEMA.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
  });
});

describe('computeProfileHash', () => {
  it('produces a stable 16-char hex hash', () => {
    const a = computeProfileHash(alice);
    const b = computeProfileHash(alice);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs for different inputs', () => {
    const a = computeProfileHash(alice);
    const c = computeProfileHash(carol);
    expect(a).not.toBe(c);
  });
});
