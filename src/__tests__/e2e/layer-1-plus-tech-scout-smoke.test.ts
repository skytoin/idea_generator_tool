import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST, __resetKVForTest } from '../../app/api/frame/extract/route';
import { setOpenAIResponse, resetOpenAIMock } from '../mocks/openai-mock';
import {
  setHnResponse,
  setArxivResponse,
  setGithubResponse,
  resetScannerMocks,
} from '../mocks/scanner-mocks';
import { SAMPLE_ARXIV_XML } from '../mocks/arxiv-fixtures';
import {
  FRAME_OUTPUT_SCHEMA,
  type FrameOutput,
} from '../../lib/types/frame-output';
import { SCANNER_REPORT_SCHEMA } from '../../lib/types/scanner-report';
import carolRaw from '../pipeline/frame/fixtures/carol-full.json';

const carol = carolRaw as Record<string, unknown>;

/**
 * All Layer 1 LLM-extractable fields null. Carol already provides every
 * field through the form, so extraction should produce no overrides.
 */
const EXTRACT_CONTENT = JSON.stringify({
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

/** Narrative prose referencing carol's existing_idea for refine-mode anchor. */
const NARRATIVE_CONTENT =
  "Carol is a senior payments engineer with deep fraud detection " +
  "experience, working on a SOC-2 audit prep tool for solo founders. " +
  "She has 20 hours a week to commit and wants to replace her income " +
  "within 12 months. " +
  (carol.existing_idea as string);

/**
 * Valid ScannerDirectives JSON covering all 4 scanners. Layer 1 calls
 * this via the directives prompt; the tech_scout slice drives the
 * Layer 2 scanner.
 */
const DIRECTIVES_CONTENT = JSON.stringify({
  tech_scout: {
    keywords: ['fraud detection', 'compliance automation'],
    exclude: ['crypto', 'gambling'],
    notes: 'Focus on SOC-2 tooling',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
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
});

/**
 * Layer 2 expansion response. Uses a single arxiv category so the
 * adapter's 3.1s sleep is only triggered once across (1 cat × 2 kws = 2
 * queries), keeping the E2E run under the test timeout.
 */
const EXPANSION_CONTENT = JSON.stringify({
  expanded_keywords: ['fraud detection', 'anomaly detection', 'risk scoring'],
  arxiv_categories: ['cs.LG'],
  github_languages: ['python'],
  domain_tags: ['fintech'],
});

/** Layer 2 enrichment response — cleaned signal for index 0. */
const ENRICHMENT_CONTENT = JSON.stringify({
  signals: [
    {
      index: 0,
      title: 'Cleaned signal title',
      snippet: 'Cleaned signal snippet with real details.',
      score: { novelty: 8, specificity: 7, recency: 9 },
      category: 'tech_capability',
    },
  ],
});

/** Mock HN Algolia response registered under the hn-smoke scenario. */
const HN_RESPONSE = {
  hits: [
    {
      objectID: '1',
      title: 'Show HN: Fraud detection ML library',
      url: 'https://example.com/fraud-ml',
      author: 'alice',
      points: 150,
      num_comments: 30,
      created_at: '2026-03-15T00:00:00.000Z',
      created_at_i: 1742000000,
      _tags: ['story'],
    },
  ],
  nbHits: 1,
  page: 0,
  nbPages: 1,
  hitsPerPage: 20,
  query: '',
  params: '',
};

/** Mock GitHub Search response registered under the github-smoke scenario. */
const GITHUB_RESPONSE = {
  total_count: 1,
  incomplete_results: false,
  items: [
    {
      id: 1,
      name: 'fraud-detection',
      full_name: 'acme/fraud-detection',
      description: 'ML-based fraud detection',
      html_url: 'https://github.com/acme/fraud-detection',
      stargazers_count: 543,
      forks_count: 67,
      language: 'Python',
      topics: ['machine-learning', 'fraud-detection'],
      pushed_at: '2026-04-01T00:00:00.000Z',
      created_at: '2025-01-01T00:00:00.000Z',
      license: { name: 'MIT License' },
    },
  ],
};

/**
 * Register every mock response (LLM + HTTP) needed for a full Layer 1
 * + Tech Scout run. Call in beforeEach so each test starts with a
 * clean slate.
 */
function registerSmokeScenarios(): void {
  setOpenAIResponse('extract-smoke', { content: EXTRACT_CONTENT });
  setOpenAIResponse('narrative-smoke', { content: NARRATIVE_CONTENT });
  setOpenAIResponse('directives-smoke', { content: DIRECTIVES_CONTENT });
  setOpenAIResponse('expansion-smoke', { content: EXPANSION_CONTENT });
  setOpenAIResponse('enrichment-smoke', {
    content: ENRICHMENT_CONTENT,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    } as unknown as {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    },
  });
  setHnResponse('hn-smoke', HN_RESPONSE);
  setArxivResponse('arxiv-smoke', SAMPLE_ARXIV_XML);
  setGithubResponse('github-smoke', GITHUB_RESPONSE);
}

/** Build the POST Request with both Layer 1 and Layer 2 routing headers. */
function buildRequest(): Request {
  return new Request('http://test/api/frame/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-run-tech-scout': '1',
      'x-test-scenarios': JSON.stringify({
        extract: 'extract-smoke',
        narrative: 'narrative-smoke',
        directives: 'directives-smoke',
      }),
      'x-test-scanner-scenarios': JSON.stringify({
        expansion: 'expansion-smoke',
        enrichment: 'enrichment-smoke',
      }),
    },
    body: JSON.stringify(carol),
  });
}

describe('Layer 1 + Tech Scout end-to-end smoke test', () => {
  beforeEach(() => {
    resetOpenAIMock();
    resetScannerMocks();
    __resetKVForTest();
    vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hn-smoke');
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-smoke');
    vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'github-smoke');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
    registerSmokeScenarios();
  });

  afterEach(() => {
    resetOpenAIMock();
    resetScannerMocks();
    vi.unstubAllEnvs();
    __resetKVForTest();
  });

  it(
    'produces a valid FrameOutput with scanners.tech_scout set to ok',
    async () => {
      const res = await POST(buildRequest());
      expect(res.status).toBe(200);
      const raw = await res.json();
      const parsed = FRAME_OUTPUT_SCHEMA.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const output: FrameOutput = parsed.data;
      expect(output.scanners).toBeDefined();
      expect(output.scanners?.tech_scout).toBeDefined();
      const report = output.scanners?.tech_scout;
      expect(report?.status).toBe('ok');
      // Schema-level validation with the canonical scanner report shape
      const reportParse = SCANNER_REPORT_SCHEMA.safeParse(report);
      expect(reportParse.success).toBe(true);
    },
    30_000,
  );

  it(
    'returns source_reports with at least 2 of 3 sources ok',
    async () => {
      const res = await POST(buildRequest());
      expect(res.status).toBe(200);
      const output = (await res.json()) as FrameOutput;
      const report = output.scanners?.tech_scout;
      expect(report).toBeDefined();
      expect(report?.source_reports).toBeDefined();
      // All 3 adapters must appear
      const names = report?.source_reports.map((s) => s.name) ?? [];
      expect(names).toContain('hn_algolia');
      expect(names).toContain('arxiv');
      expect(names).toContain('github');
      // Every source is either ok or ok_empty (never failed/denied)
      for (const sr of report?.source_reports ?? []) {
        expect(['ok', 'ok_empty']).toContain(sr.status);
      }
      // At least 2 of 3 should return real data given our mocks
      const okCount =
        report?.source_reports.filter((s) => s.status === 'ok').length ?? 0;
      expect(okCount).toBeGreaterThanOrEqual(2);
    },
    30_000,
  );

  it(
    'has a non-empty expansion_plan with >= 3 expanded_keywords',
    async () => {
      const res = await POST(buildRequest());
      expect(res.status).toBe(200);
      const output = (await res.json()) as FrameOutput;
      const plan = output.scanners?.tech_scout?.expansion_plan;
      expect(plan).not.toBeNull();
      expect(plan).toBeDefined();
      const keywords = (plan as Record<string, unknown>).expanded_keywords;
      expect(Array.isArray(keywords)).toBe(true);
      expect((keywords as string[]).length).toBeGreaterThanOrEqual(3);
    },
    30_000,
  );

  it(
    'excludes anti-target terms (crypto, gambling) from final signals',
    async () => {
      const res = await POST(buildRequest());
      expect(res.status).toBe(200);
      const output = (await res.json()) as FrameOutput;
      const report = output.scanners?.tech_scout;
      expect(report).toBeDefined();
      for (const sig of report?.signals ?? []) {
        expect(sig.title.toLowerCase()).not.toContain('crypto');
        expect(sig.title.toLowerCase()).not.toContain('gambling');
        expect(sig.snippet.toLowerCase()).not.toContain('crypto');
        expect(sig.snippet.toLowerCase()).not.toContain('gambling');
      }
    },
    30_000,
  );

  it(
    'propagates anti-targets from Layer 1 into Tech Scout directive.exclude',
    async () => {
      const res = await POST(buildRequest());
      expect(res.status).toBe(200);
      const output = (await res.json()) as FrameOutput;
      // Layer 1 directive.exclude must contain every anti-target Carol
      // stated on the form. This proves the Layer 1 → Layer 2 plumbing.
      const antiTargets = output.profile.anti_targets.value;
      expect(antiTargets.length).toBeGreaterThan(0);
      for (const a of antiTargets) {
        expect(output.directives.tech_scout.exclude).toContain(a);
      }
      // The scanner produced source_reports — this confirms it actually ran.
      const report = output.scanners?.tech_scout;
      expect(report?.source_reports.length).toBe(3);
    },
    30_000,
  );

  it(
    'records debug.generated_at and finishes in a reasonable time',
    async () => {
      const start = Date.now();
      const res = await POST(buildRequest());
      const elapsed = Date.now() - start;
      expect(res.status).toBe(200);
      const output = (await res.json()) as FrameOutput;
      expect(output.debug.generated_at).toBeDefined();
      expect(typeof output.debug.generated_at).toBe('string');
      // With mocked LLMs and mocked HTTP, the whole pipeline should
      // finish well under 15s even with arxiv's 3.1s inter-query sleep.
      expect(elapsed).toBeLessThan(15_000);
    },
    30_000,
  );

  it(
    'is idempotent under the same input and fixed clock',
    async () => {
      const first = await POST(buildRequest());
      expect(first.status).toBe(200);
      const firstData = (await first.json()) as FrameOutput;
      // Reset transient state and re-register scenarios. KV is also
      // reset so the second call is a fresh run, not a cache hit.
      resetOpenAIMock();
      resetScannerMocks();
      __resetKVForTest();
      registerSmokeScenarios();
      const second = await POST(buildRequest());
      expect(second.status).toBe(200);
      const secondData = (await second.json()) as FrameOutput;
      // profile_hash is derived from canonical JSON input — it must
      // match across runs even though elapsed_ms and cost will differ.
      expect(firstData.profile.profile_hash).toBe(
        secondData.profile.profile_hash,
      );
    },
    40_000,
  );
});
