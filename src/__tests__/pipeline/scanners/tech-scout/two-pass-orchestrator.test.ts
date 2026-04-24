import { describe, it, expect, afterEach, vi } from 'vitest';
import { runTechScout } from '../../../../pipeline/scanners/tech-scout/scanner';
import { mergeOneSourceReport } from '../../../../pipeline/scanners/tech-scout/two-pass-orchestrator';
import type { SourceReport } from '../../../../lib/types/source-report';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
import {
  setHnResponse,
  setArxivResponse,
  setGithubResponse,
  resetScannerMocks,
} from '../../../mocks/scanner-mocks';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';

/** Minimum valid founder profile for orchestrator tests. */
function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  const assumed = <T>(value: T) => ({ value, source: 'assumed' as const });
  return {
    skills: stated(['Python', 'ML']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'fintech', years: 5 }]),
    insider_knowledge: stated('workflow'),
    anti_targets: stated([]),
    network: assumed(null),
    audience: assumed(null),
    proprietary_access: assumed(null),
    rare_combinations: assumed(null),
    recurring_frustration: assumed(null),
    four_week_mvp: assumed(null),
    previous_attempts: assumed(null),
    customer_affinity: assumed(null),
    time_to_revenue: assumed('no_preference'),
    customer_type_preference: assumed('no_preference'),
    trigger: assumed(null),
    legal_constraints: assumed(null),
    divergence_level: assumed('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'tp-test',
  };
}

function buildDirective(
  overrides: Partial<ScannerDirectives['tech_scout']> = {},
): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['MCP', 'fraud'],
    exclude: [],
    notes: 'two-pass integration test',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
    ...overrides,
  };
}

/** Build a v2 expansion JSON with per-source keyword lists. */
function buildExpansionJson(
  overrides: Partial<{
    hn_keywords: string[];
    arxiv_keywords: string[];
    github_keywords: string[];
    reddit_keywords: string[];
    reddit_subreddits: string[];
  }> = {},
): string {
  return JSON.stringify({
    hn_keywords: overrides.hn_keywords ?? [
      'fraud detection saas',
      'ml anomaly tools',
      'consumer analytics',
      'product hunt launches',
    ],
    arxiv_keywords: overrides.arxiv_keywords ?? [
      'fraud detection benchmark',
      'anomaly transfer',
      'few-shot fraud',
      'financial nlp',
    ],
    github_keywords: overrides.github_keywords ?? [
      'fraud detection kit',
      'anomaly scoring',
      'python ml framework',
      'data pipeline tool',
    ],
    reddit_keywords: overrides.reddit_keywords ?? [
      'fraud complaints',
      'chargeback frustration',
      'anomaly tool alternatives',
    ],
    huggingface_keywords: [],
    arxiv_categories: ['cs.LG'],
    github_languages: ['python'],
    reddit_subreddits: overrides.reddit_subreddits ?? ['datascience', 'SaaS'],
    domain_tags: ['fintech'],
  });
}

/** Build an enrichment JSON with configurable score per signal. */
function buildEnrichmentJson(
  count: number,
  score: { recency?: number; relevance?: number } = {},
): string {
  const recency = score.recency ?? 8;
  const relevance = score.relevance ?? 8;
  return JSON.stringify({
    signals: Array.from({ length: count }, (_, i) => ({
      index: i,
      title: `Enriched ${i}`,
      snippet: `snippet ${i}`,
      score: { novelty: 7, specificity: 7, recency, relevance },
      category: 'tech_capability',
    })),
  });
}

/** Fake HN hit. */
function buildHnHit(overrides: {
  objectID: string;
  title: string;
  url?: string;
  created_at?: string;
}) {
  return {
    objectID: overrides.objectID,
    title: overrides.title,
    url: overrides.url ?? `https://example.com/hn-${overrides.objectID}`,
    author: 'alice',
    points: 100,
    num_comments: 10,
    created_at: overrides.created_at ?? '2026-03-01T00:00:00.000Z',
    created_at_i: 1740787200,
    _tags: ['story'],
  };
}

function stubEnv(): void {
  vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'tp-hn');
  vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'tp-arxiv');
  vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'tp-github');
  vi.stubEnv('GITHUB_TOKEN', 'ghp_tp');
}

const CLOCK = () => new Date('2026-04-12T12:00:00Z');

function teardown(): void {
  resetOpenAIMock();
  resetScannerMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
}

describe('runTechScout — two-pass happy path', () => {
  afterEach(teardown);

  it('runs pass 1 + refine + pass 2 when features.two_pass is on', async () => {
    // Pass-1 expansion
    setOpenAIResponse('tp-expansion-1', { content: buildExpansionJson() });
    // Pass-1 enrichment: 2 signals with good scores
    setOpenAIResponse('tp-enrich-1', { content: buildEnrichmentJson(2) });
    // Refine response (pass-2 plan with different keywords)
    setOpenAIResponse('tp-refine', {
      content: buildExpansionJson({
        hn_keywords: [
          'refined angle 1',
          'refined angle 2',
          'refined angle 3',
          'refined angle 4',
        ],
      }),
    });
    // Pass-2 enrichment: 1 fresh signal
    setOpenAIResponse('tp-enrich-2', { content: buildEnrichmentJson(1) });
    // Source data: HN returns 2 hits on pass 1, 1 hit on pass 2 reuse.
    setHnResponse('tp-hn', {
      hits: [
        buildHnHit({ objectID: 'a', title: 'A' }),
        buildHnHit({ objectID: 'b', title: 'B' }),
      ],
    });
    setArxivResponse('tp-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('tp-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnv();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'tp-expansion-1',
        enrichment: 'tp-enrich-1',
        refine: 'tp-refine',
      },
      features: { two_pass: true },
    });

    expect(report.two_pass_meta).toBeDefined();
    expect(report.two_pass_meta).not.toBeNull();
    if (!report.two_pass_meta) return;
    expect(report.two_pass_meta.pass2_plan).not.toBeNull();
    expect(report.two_pass_meta.pass2_skipped_reason).toBeNull();
    expect(report.signals.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('runTechScout — two-pass degrades gracefully on refine failure', () => {
  afterEach(teardown);

  it('falls back to pass-1 result when refine LLM response is invalid', async () => {
    setOpenAIResponse('tp-expansion-1', { content: buildExpansionJson() });
    setOpenAIResponse('tp-enrich-1', { content: buildEnrichmentJson(2) });
    // No 'tp-refine-missing' registered → MSW fallback returns {"ideas":[]}
    // which fails the refine schema.
    setHnResponse('tp-hn', {
      hits: [
        buildHnHit({ objectID: 'a', title: 'A' }),
        buildHnHit({ objectID: 'b', title: 'B' }),
      ],
    });
    setArxivResponse('tp-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('tp-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnv();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'tp-expansion-1',
        enrichment: 'tp-enrich-1',
        refine: 'tp-refine-missing',
      },
      features: { two_pass: true },
    });

    expect(report.two_pass_meta).toBeDefined();
    if (!report.two_pass_meta) return;
    expect(report.two_pass_meta.pass2_plan).toBeNull();
    expect(report.two_pass_meta.pass2_skipped_reason).toMatch(/refine_failed/);
    expect(report.warnings.some((w) => w.startsWith('two_pass_fallback:'))).toBe(true);
    expect(report.signals.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('runTechScout — v1 single-pass behavior when feature flag is off', () => {
  afterEach(teardown);

  it('does NOT set two_pass_meta when features.two_pass is undefined', async () => {
    setOpenAIResponse('tp-expansion-1', { content: buildExpansionJson() });
    setOpenAIResponse('tp-enrich-1', { content: buildEnrichmentJson(1) });
    setHnResponse('tp-hn', {
      hits: [buildHnHit({ objectID: 'a', title: 'A' })],
    });
    setArxivResponse('tp-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('tp-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnv();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'tp-expansion-1',
        enrichment: 'tp-enrich-1',
      },
    });

    expect(report.two_pass_meta).toBeFalsy();
    expect(report.signals.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('runTechScout — two-pass dedupes signals across passes', () => {
  afterEach(teardown);

  it('collapses duplicate URLs from pass 1 and pass 2 to one signal', async () => {
    setOpenAIResponse('tp-expansion-1', { content: buildExpansionJson() });
    setOpenAIResponse('tp-enrich-1', { content: buildEnrichmentJson(1) });
    setOpenAIResponse('tp-refine', {
      content: buildExpansionJson({
        hn_keywords: ['angle x', 'angle y', 'angle z', 'angle q'],
      }),
    });
    setOpenAIResponse('tp-enrich-2', { content: buildEnrichmentJson(1) });
    // Both pass 1 and pass 2 will fetch HN; the single hit has the same URL.
    // After dedupe we expect exactly one signal in the final output.
    setHnResponse('tp-hn', {
      hits: [
        buildHnHit({
          objectID: 'shared',
          title: 'Shared',
          url: 'https://example.com/shared',
        }),
      ],
    });
    setArxivResponse('tp-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('tp-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnv();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'tp-expansion-1',
        enrichment: 'tp-enrich-1',
        refine: 'tp-refine',
      },
      features: { two_pass: true },
    });

    const matching = report.signals.filter((s) => s.url === 'https://example.com/shared');
    expect(matching).toHaveLength(1);
  }, 120_000);
});

describe('runTechScout — two-pass skips pass 2 when refinement signal is absent', () => {
  afterEach(teardown);

  it('skips pass 2 and records no_refinement_signal when pass 1 produced nothing', async () => {
    setOpenAIResponse('tp-expansion-1', { content: buildExpansionJson() });
    // Enrichment returns an empty array — no signals at all, so
    // summarizeFirstPass finds zero dense/sparse/empty + zero top signals.
    setOpenAIResponse('tp-enrich-1', { content: JSON.stringify({ signals: [] }) });
    setHnResponse('tp-hn', { hits: [] });
    setArxivResponse('tp-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('tp-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnv();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'tp-expansion-1',
        enrichment: 'tp-enrich-1',
        refine: 'tp-refine',
      },
      features: { two_pass: true },
    });

    expect(report.two_pass_meta).toBeDefined();
    if (!report.two_pass_meta) return;
    expect(report.two_pass_meta.pass2_skipped_reason).toBe('no_refinement_signal');
    expect(report.two_pass_meta.pass2_plan).toBeNull();
    expect(report.two_pass_meta.pass2_signal_count).toBe(0);
  }, 120_000);
});

// ────────────────────────────────────────────────────────────────────────────
// mergeOneSourceReport — pure helper, count-aware status merge
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal SourceReport with sensible defaults for merge tests.
 * The merge function only reads name/status/signals_count and the
 * three array fields, so the rest stay at neutral zero values.
 */
function buildSourceReport(
  overrides: Partial<SourceReport> & {
    status: SourceReport['status'];
    signals_count: number;
  },
): SourceReport {
  return {
    name: 'arxiv',
    status: overrides.status,
    signals_count: overrides.signals_count,
    queries_ran: overrides.queries_ran ?? [],
    queries_with_zero_results: overrides.queries_with_zero_results ?? [],
    error: overrides.error ?? null,
    elapsed_ms: overrides.elapsed_ms ?? 0,
    cost_usd: overrides.cost_usd ?? 0,
  };
}

describe('mergeOneSourceReport — count-aware status merge', () => {
  it('preserves ok when both passes succeed (10 + 15 → ok / 25)', () => {
    const a = buildSourceReport({ status: 'ok', signals_count: 10 });
    const b = buildSourceReport({ status: 'ok', signals_count: 15 });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.status).toBe('ok');
    expect(merged.signals_count).toBe(25);
  });

  it('🐛 FIXES the empty-with-signals bug (ok 25 + ok_empty 0 → ok / 25)', () => {
    // The exact 2026-04-22 gpt-5.4 arxiv scenario: pass 1 returned 25
    // signals, pass 2's narrower queries returned nothing. Pre-fix the
    // merge produced "ok_empty / 25" which contradicts the SOURCE_STATUS
    // contract that ok_empty ⟺ signals_count === 0.
    const pass1 = buildSourceReport({ status: 'ok', signals_count: 25 });
    const pass2 = buildSourceReport({ status: 'ok_empty', signals_count: 0 });
    const merged = mergeOneSourceReport(pass1, pass2);
    expect(merged.status).toBe('ok');
    expect(merged.signals_count).toBe(25);
  });

  it('symmetric: ok_empty 0 + ok 25 → ok / 25', () => {
    const a = buildSourceReport({ status: 'ok_empty', signals_count: 0 });
    const b = buildSourceReport({ status: 'ok', signals_count: 25 });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.status).toBe('ok');
    expect(merged.signals_count).toBe(25);
  });

  it('ok_empty + ok_empty → ok_empty / 0 (truly empty, no contradiction)', () => {
    const a = buildSourceReport({ status: 'ok_empty', signals_count: 0 });
    const b = buildSourceReport({ status: 'ok_empty', signals_count: 0 });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.status).toBe('ok_empty');
    expect(merged.signals_count).toBe(0);
  });

  it('rescues a successful pass-1 from a pass-2 timeout (ok 25 + timeout 0 → ok / 25)', () => {
    // The sibling bug: pre-fix, pass 1 success was erased by pass 2 timeout.
    // Post-fix, the source is still ok because it contributed 25 signals.
    const pass1 = buildSourceReport({ status: 'ok', signals_count: 25 });
    const pass2 = buildSourceReport({ status: 'timeout', signals_count: 0 });
    const merged = mergeOneSourceReport(pass1, pass2);
    expect(merged.status).toBe('ok');
    expect(merged.signals_count).toBe(25);
  });

  it('rescues from pass-2 denied (ok 25 + denied 0 → ok / 25)', () => {
    const pass1 = buildSourceReport({ status: 'ok', signals_count: 25 });
    const pass2 = buildSourceReport({ status: 'denied', signals_count: 0 });
    const merged = mergeOneSourceReport(pass1, pass2);
    expect(merged.status).toBe('ok');
    expect(merged.signals_count).toBe(25);
  });

  it('rescues from pass-2 failed (ok 25 + failed 0 → ok / 25)', () => {
    const pass1 = buildSourceReport({ status: 'ok', signals_count: 25 });
    const pass2 = buildSourceReport({ status: 'failed', signals_count: 0 });
    const merged = mergeOneSourceReport(pass1, pass2);
    expect(merged.status).toBe('ok');
    expect(merged.signals_count).toBe(25);
  });

  it('symmetric rescue: timeout 0 + ok 25 → ok / 25', () => {
    const a = buildSourceReport({ status: 'timeout', signals_count: 0 });
    const b = buildSourceReport({ status: 'ok', signals_count: 25 });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.status).toBe('ok');
    expect(merged.signals_count).toBe(25);
  });

  it('surfaces the worst error when NEITHER pass produced signals (ok_empty + timeout → timeout / 0)', () => {
    const a = buildSourceReport({ status: 'ok_empty', signals_count: 0 });
    const b = buildSourceReport({ status: 'timeout', signals_count: 0 });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.status).toBe('timeout');
    expect(merged.signals_count).toBe(0);
  });

  it('surfaces failed when both passes broke (timeout 0 + failed 0 → failed / 0)', () => {
    const a = buildSourceReport({ status: 'timeout', signals_count: 0 });
    const b = buildSourceReport({ status: 'failed', signals_count: 0 });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.status).toBe('failed');
    expect(merged.signals_count).toBe(0);
  });

  it('surfaces denied when both passes hit rate limits (denied 0 + denied 0 → denied / 0)', () => {
    const a = buildSourceReport({ status: 'denied', signals_count: 0 });
    const b = buildSourceReport({ status: 'denied', signals_count: 0 });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.status).toBe('denied');
    expect(merged.signals_count).toBe(0);
  });

  it('preserves invariant: status === ok_empty implies signals_count === 0', () => {
    // Property check — ANY merge whose result is ok_empty MUST have
    // zero signals. This is the SOURCE_STATUS contract.
    const cases: Array<[SourceReport['status'], number, SourceReport['status'], number]> =
      [
        ['ok', 5, 'ok_empty', 0],
        ['ok_empty', 0, 'ok', 5],
        ['ok', 1, 'timeout', 0],
        ['ok_empty', 0, 'ok_empty', 0],
        ['timeout', 0, 'ok_empty', 0],
        ['failed', 0, 'denied', 0],
      ];
    for (const [aStatus, aCount, bStatus, bCount] of cases) {
      const merged = mergeOneSourceReport(
        buildSourceReport({ status: aStatus, signals_count: aCount }),
        buildSourceReport({ status: bStatus, signals_count: bCount }),
      );
      if (merged.status === 'ok_empty') {
        expect(merged.signals_count).toBe(0);
      }
    }
  });

  it('sums elapsed_ms and cost_usd across passes regardless of status', () => {
    const a = buildSourceReport({
      status: 'ok',
      signals_count: 10,
      elapsed_ms: 1000,
      cost_usd: 0.5,
    });
    const b = buildSourceReport({
      status: 'ok_empty',
      signals_count: 0,
      elapsed_ms: 500,
      cost_usd: 0.25,
    });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.elapsed_ms).toBe(1500);
    expect(merged.cost_usd).toBe(0.75);
  });

  it('concatenates queries_ran and queries_with_zero_results across passes', () => {
    const a = buildSourceReport({
      status: 'ok',
      signals_count: 10,
      queries_ran: ['q1', 'q2'],
      queries_with_zero_results: ['q2'],
    });
    const b = buildSourceReport({
      status: 'ok_empty',
      signals_count: 0,
      queries_ran: ['q3', 'q4'],
      queries_with_zero_results: ['q3', 'q4'],
    });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.queries_ran).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(merged.queries_with_zero_results).toEqual(['q2', 'q3', 'q4']);
  });

  it('preserves the first non-null error encountered (a.error wins over b.error)', () => {
    const a = buildSourceReport({
      status: 'ok',
      signals_count: 10,
      error: { kind: 'partial', message: 'pass1 partial' },
    });
    const b = buildSourceReport({
      status: 'failed',
      signals_count: 0,
      error: { kind: 'failed', message: 'pass2 failed' },
    });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.error?.kind).toBe('partial');
    expect(merged.error?.message).toBe('pass1 partial');
  });

  it('uses b.error when a.error is null', () => {
    const a = buildSourceReport({ status: 'ok', signals_count: 10, error: null });
    const b = buildSourceReport({
      status: 'failed',
      signals_count: 0,
      error: { kind: 'failed', message: 'pass2 failed' },
    });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.error?.kind).toBe('failed');
  });

  it('preserves the source name (uses a.name)', () => {
    const a = buildSourceReport({ status: 'ok', signals_count: 10, name: 'arxiv' });
    const b = buildSourceReport({ status: 'ok', signals_count: 5, name: 'arxiv' });
    const merged = mergeOneSourceReport(a, b);
    expect(merged.name).toBe('arxiv');
  });
});
