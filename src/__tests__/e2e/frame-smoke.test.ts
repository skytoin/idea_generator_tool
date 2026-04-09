import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST, __resetKVForTest } from '../../app/api/frame/extract/route';
import { setOpenAIResponse, resetOpenAIMock } from '../mocks/openai-mock';
import { FRAME_OUTPUT_SCHEMA, type FrameOutput } from '../../lib/types/frame-output';
import { FIELD_COVERAGE } from '../../lib/types/field-coverage';
import type { ScannerDirectives } from '../../lib/types/scanner-directives';
import carolRaw from '../pipeline/frame/fixtures/carol-full.json';

const carol = carolRaw as Record<string, unknown>;

/**
 * All extractable LLM fields null — the carol fixture already provides
 * every field through the form, so the LLM extraction should produce
 * no additional overrides.
 */
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

/**
 * Narrative prose with the carol existing_idea embedded so the
 * refine-mode anchor check passes.
 */
function carolNarrative(): string {
  const idea = carol.existing_idea as string;
  return (
    `Carol is a backend engineer with 8 years of payments experience and ` +
    `deep SOC-2 audit knowledge. She is building: ${idea} She wants to replace ` +
    `her income in 12 months from a cabin in Vermont.`
  );
}

/** Build a full ScannerDirectives object covering all 4 scanners. */
function carolDirectives(): ScannerDirectives {
  return {
    tech_scout: {
      keywords: ['soc-2 automation', 'fraud ml'],
      exclude: [],
      notes: 'targets audit automation tools',
      target_sources: ['hn', 'github'],
      timeframe: 'last 12 months',
    },
    pain_scanner: {
      keywords: ['audit prep pain', 'compliance fatigue'],
      exclude: [],
      notes: 'solo founders and fraud analysts',
      target_subreddits: ['r/soc2', 'r/compliance'],
      personas: ['solo technical founder'],
    },
    market_scanner: {
      keywords: ['compliance saas', 'audit prep tools'],
      exclude: [],
      notes: 'competitor scan for B2B SaaS compliance tools',
      competitor_domains: ['drata.com', 'vanta.com'],
      yc_batches_to_scan: ['S23', 'W24'],
    },
    change_scanner: {
      keywords: ['aicpa updates'],
      exclude: [],
      notes: 'regulatory shifts in SOC-2',
      regulatory_areas: ['SOC-2'],
      geographic: ['US'],
    },
  };
}

/** Register every mock LLM response used by the smoke run. */
function registerSmokeScenarios(): void {
  setOpenAIResponse('smoke-extract', { content: extractionNullJson() });
  setOpenAIResponse('smoke-narrative', { content: carolNarrative() });
  setOpenAIResponse('smoke-directives', {
    content: JSON.stringify(carolDirectives()),
  });
}

/** Build a Request targeting the extract route with carol as the body. */
function buildRequest(): Request {
  return new Request('http://test/api/frame/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-scenarios': JSON.stringify({
        extract: 'smoke-extract',
        narrative: 'smoke-narrative',
        directives: 'smoke-directives',
      }),
    },
    body: JSON.stringify(carol),
  });
}

describe('Frame layer end-to-end smoke test', () => {
  beforeEach(() => {
    resetOpenAIMock();
    __resetKVForTest();
    registerSmokeScenarios();
  });

  afterEach(() => {
    resetOpenAIMock();
    __resetKVForTest();
  });

  it('accepts carol-full and produces a valid FrameOutput with full field coverage', async () => {
    const res = await POST(buildRequest());
    expect(res.status).toBe(200);
    const raw = await res.json();
    const parsed = FRAME_OUTPUT_SCHEMA.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const output: FrameOutput = parsed.data;
    // Every (field, consumer) pair from FIELD_COVERAGE must be in trace
    for (const [field, entry] of Object.entries(FIELD_COVERAGE)) {
      for (const consumer of entry.consumers) {
        const present = output.debug.trace.some(
          (t) => t.field === field && t.consumer === consumer,
        );
        expect(present, `trace missing (${field}, ${consumer})`).toBe(true);
      }
    }
    // Anti-targets propagate to every scanner exclude
    const antiTargets = output.profile.anti_targets.value;
    expect(antiTargets.length).toBeGreaterThan(0);
    for (const a of antiTargets) {
      expect(output.directives.tech_scout.exclude).toContain(a);
      expect(output.directives.pain_scanner.exclude).toContain(a);
      expect(output.directives.market_scanner.exclude).toContain(a);
      expect(output.directives.change_scanner.exclude).toContain(a);
    }
    // existing_idea lives in narrative prose and every scanner notes
    const existingIdea = carol.existing_idea as string;
    expect(output.narrative.prose).toContain(existingIdea);
    expect(output.directives.tech_scout.notes).toContain(existingIdea);
    expect(output.directives.pain_scanner.notes).toContain(existingIdea);
    expect(output.directives.market_scanner.notes).toContain(existingIdea);
    expect(output.directives.change_scanner.notes).toContain(existingIdea);
  });

  it('is idempotent: same input + fixed clock produces same profile_hash', async () => {
    const first = await POST(buildRequest());
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as FrameOutput;
    // Reset KV and re-register scenarios before second call
    __resetKVForTest();
    resetOpenAIMock();
    registerSmokeScenarios();
    const second = await POST(buildRequest());
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as FrameOutput;
    expect(firstData.profile.profile_hash).toBe(secondData.profile.profile_hash);
  });
});
