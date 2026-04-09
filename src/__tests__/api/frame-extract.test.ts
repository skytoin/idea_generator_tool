import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST, __resetKVForTest } from '../../app/api/frame/extract/route';
import { setOpenAIResponse, resetOpenAIMock } from '../mocks/openai-mock';
import { FRAME_OUTPUT_SCHEMA } from '../../lib/types/frame-output';
import type { ScannerDirectives } from '../../lib/types/scanner-directives';
import aliceRaw from '../pipeline/frame/fixtures/alice-minimum.json';

const alice = aliceRaw as Record<string, unknown>;

const NARRATIVE_PROSE = 'A'.repeat(60);

/** Build a default extraction payload with every LLM-derived field null. */
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

/** Build a complete default ScannerDirectives payload. */
function defaultDirectives(): ScannerDirectives {
  return {
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
  };
}

/** Register mock responses for every LLM call in the pipeline. */
function registerAll(prefix: string): void {
  setOpenAIResponse(`${prefix}-extract`, { content: extractionNullJson() });
  setOpenAIResponse(`${prefix}-narrative`, { content: NARRATIVE_PROSE });
  setOpenAIResponse(`${prefix}-directives`, { content: JSON.stringify(defaultDirectives()) });
}

function buildScenarioHeader(prefix: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-test-scenarios': JSON.stringify({
      extract: `${prefix}-extract`,
      narrative: `${prefix}-narrative`,
      directives: `${prefix}-directives`,
    }),
  };
}

describe('POST /api/frame/extract', () => {
  beforeEach(() => {
    __resetKVForTest();
  });
  afterEach(() => {
    resetOpenAIMock();
    __resetKVForTest();
  });

  it('returns 200 with a valid FrameOutput on happy path', async () => {
    registerAll('alice');
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: buildScenarioHeader('alice'),
      body: JSON.stringify(alice),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const parsed = FRAME_OUTPUT_SCHEMA.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it('returns 400 invalid_json for non-JSON body', async () => {
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_json');
  });

  it('returns 400 invalid_input when required fields are missing', async () => {
    const bad = { ...alice };
    delete (bad as Record<string, unknown>).skills;
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bad),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_input');
    expect(data.issues).toBeDefined();
  });

  it('returns 400 invalid_input when additional_context exceeds 5000 chars', async () => {
    const overlong = { ...alice, additional_context: 'x'.repeat(5001) };
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overlong),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_input');
  });

  it('returns 500 when the internal frame pipeline fails', async () => {
    // No scenarios registered, but the bob fixture has non-empty context
    // so extraction will be attempted; the default {"ideas":[]} reply
    // fails extraction schema -> extract_failed -> 500.
    const bob = {
      mode: 'explore',
      skills: ['TypeScript'],
      time_per_week: '10',
      money_available: 'lt_5k',
      ambition: 'supplemental',
      additional_context: 'I run a Shopify theme shop.',
    };
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bob),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('extract_failed');
    // Make sure no internal stack is leaked
    expect(data.stack).toBeUndefined();
  });

  it('__resetKVForTest clears module singleton between tests', async () => {
    registerAll('reset-1');
    const first = await POST(
      new Request('http://test/api/frame/extract', {
        method: 'POST',
        headers: buildScenarioHeader('reset-1'),
        body: JSON.stringify(alice),
      }),
    );
    expect(first.status).toBe(200);
    __resetKVForTest();
    // After reset, running the same request again still succeeds and
    // writes fresh state. We verify the reset itself doesn't throw and
    // the next request still returns a successful FrameOutput.
    registerAll('reset-2');
    const second = await POST(
      new Request('http://test/api/frame/extract', {
        method: 'POST',
        headers: buildScenarioHeader('reset-2'),
        body: JSON.stringify(alice),
      }),
    );
    expect(second.status).toBe(200);
  });
});
