import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST, __resetKVForTest } from '../../app/api/frame/extract/route';
import { setOpenAIResponse, resetOpenAIMock } from '../mocks/openai-mock';
import {
  setHnResponse,
  setGithubResponse,
  resetScannerMocks,
} from '../mocks/scanner-mocks';
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

/** Build a minimal expansion JSON body for the scanner expansion call. */
function buildExpansionJson(): string {
  return JSON.stringify({
    expanded_keywords: ['react'],
    arxiv_categories: [],
    github_languages: ['typescript'],
    domain_tags: [],
  });
}

/** Build a minimal enrichment JSON body for N signals. */
function buildEnrichmentJson(count: number): string {
  return JSON.stringify({
    signals: Array.from({ length: count }, (_, i) => ({
      index: i,
      title: `Enriched ${i}`,
      snippet: `Enriched snippet ${i}`,
      score: { novelty: 7, specificity: 8, recency: 9 },
      category: 'tech_capability',
    })),
  });
}

/** Minimal HN hit payload for test MSW registration. */
function buildHnHit() {
  return {
    objectID: '100',
    title: 'ML fraud tool',
    url: 'https://example.com/hn-post',
    author: 'alice',
    points: 150,
    num_comments: 42,
    created_at: '2026-03-14T12:00:00.000Z',
    created_at_i: 1742558400,
    _tags: ['story'],
  };
}

/** Register every LLM + source scenario the tech_scout path needs. */
function registerAllTechScoutScenarios(prefix: string): void {
  registerAll(prefix);
  setOpenAIResponse(`${prefix}-expansion`, { content: buildExpansionJson() });
  setOpenAIResponse(`${prefix}-enrichment`, { content: buildEnrichmentJson(1) });
  setHnResponse(`${prefix}-hn`, { hits: [buildHnHit()] });
  setGithubResponse(`${prefix}-github`, {
    total_count: 0,
    incomplete_results: false,
    items: [],
  });
}

describe('POST /api/frame/extract — Tech Scout passthrough', () => {
  beforeEach(() => {
    __resetKVForTest();
  });
  afterEach(() => {
    resetOpenAIMock();
    resetScannerMocks();
    vi.unstubAllEnvs();
    __resetKVForTest();
  });

  it('returns scanners field when x-run-tech-scout=1', async () => {
    registerAllTechScoutScenarios('hdr1');
    vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hdr1-hn');
    vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'hdr1-github');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-scenarios': JSON.stringify({
          extract: 'hdr1-extract',
          narrative: 'hdr1-narrative',
          directives: 'hdr1-directives',
        }),
        'x-run-tech-scout': '1',
        'x-test-scanner-scenarios': JSON.stringify({
          expansion: 'hdr1-expansion',
          enrichment: 'hdr1-enrichment',
        }),
      },
      body: JSON.stringify(alice),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      scanners?: { tech_scout?: { scanner?: string } };
    };
    expect(data.scanners).toBeDefined();
    expect(data.scanners?.tech_scout).toBeDefined();
    expect(data.scanners?.tech_scout?.scanner).toBe('tech_scout');
  }, 20_000);

  it('also accepts "true" as a truthy x-run-tech-scout value', async () => {
    registerAllTechScoutScenarios('hdr2');
    vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hdr2-hn');
    vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'hdr2-github');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-scenarios': JSON.stringify({
          extract: 'hdr2-extract',
          narrative: 'hdr2-narrative',
          directives: 'hdr2-directives',
        }),
        'x-run-tech-scout': 'true',
        'x-test-scanner-scenarios': JSON.stringify({
          expansion: 'hdr2-expansion',
          enrichment: 'hdr2-enrichment',
        }),
      },
      body: JSON.stringify(alice),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { scanners?: unknown };
    expect(data.scanners).toBeDefined();
  }, 20_000);

  it('omits scanners field when x-run-tech-scout header is absent', async () => {
    registerAll('hdr3');
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: buildScenarioHeader('hdr3'),
      body: JSON.stringify(alice),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { scanners?: unknown };
    expect(data.scanners).toBeUndefined();
  });

  it('still runs tech_scout when x-test-scanner-scenarios is invalid JSON', async () => {
    registerAllTechScoutScenarios('hdr4');
    vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hdr4-hn');
    vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'hdr4-github');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
    const req = new Request('http://test/api/frame/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-scenarios': JSON.stringify({
          extract: 'hdr4-extract',
          narrative: 'hdr4-narrative',
          directives: 'hdr4-directives',
        }),
        'x-run-tech-scout': '1',
        'x-test-scanner-scenarios': '{not-json',
      },
      body: JSON.stringify(alice),
    });
    const res = await POST(req);
    // With no scanner scenarios the LLM calls route to the default stub
    // ('{"ideas":[]}') which fails expansion/enrichment schemas — the
    // scanner still runs, just falls back to defaults and surfaces
    // warnings. The response status is still 200 with a scanners field.
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      scanners?: { tech_scout?: unknown };
    };
    expect(data.scanners).toBeDefined();
    expect(data.scanners?.tech_scout).toBeDefined();
  }, 20_000);
});
