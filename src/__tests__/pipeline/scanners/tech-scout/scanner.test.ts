import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  runTechScout,
  buildFallbackPlan,
} from '../../../../pipeline/scanners/tech-scout/scanner';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
import {
  setHnResponse,
  setArxivResponse,
  setGithubResponse,
  resetScannerMocks,
} from '../../../mocks/scanner-mocks';
import { SAMPLE_ARXIV_XML } from '../../../mocks/arxiv-fixtures';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';

/** Inline minimum valid founder profile for tests. */
function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  const assumed = <T>(value: T) => ({ value, source: 'assumed' as const });
  return {
    skills: stated(['Python', 'ML']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'payments', years: 8 }]),
    insider_knowledge: stated('Fraud analysts use broken tools'),
    anti_targets: stated(['crypto', 'gambling']),
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
    profile_hash: 'test-hash',
  };
}

/** Build a minimum valid tech_scout directive. */
function buildDirective(
  overrides: Partial<ScannerDirectives['tech_scout']> = {},
): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: ['crypto', 'gambling'],
    notes: 'Focus on practical ML tools',
    target_sources: ['hn', 'arxiv', 'github', 'producthunt'],
    timeframe: 'last 6 months',
    ...overrides,
  };
}

/**
 * Build a valid expansion JSON string. Uses a single arxiv_category so
 * the arxiv adapter produces at most 2 queries (1 cat × 2 kws) keeping
 * the 3.1s sleep to at most one per test.
 */
function buildExpansionJson(
  overrides: Partial<{
    expanded_keywords: string[];
    arxiv_categories: string[];
    github_languages: string[];
    domain_tags: string[];
  }> = {},
): string {
  return JSON.stringify({
    expanded_keywords: overrides.expanded_keywords ?? [
      'fraud detection',
      'anomaly detection',
      'risk scoring',
    ],
    arxiv_categories: overrides.arxiv_categories ?? ['cs.LG'],
    github_languages: overrides.github_languages ?? ['python'],
    domain_tags: overrides.domain_tags ?? ['fintech'],
  });
}

/** Build a valid enrichment JSON string for the given signal count. */
function buildEnrichmentJson(count: number): string {
  return JSON.stringify({
    signals: Array.from({ length: count }, (_, i) => ({
      index: i,
      title: `Enriched title ${i}`,
      snippet: `Enriched snippet ${i}`,
      score: { novelty: 7, specificity: 8, recency: 9 },
      category: 'tech_capability',
    })),
  });
}

/** Build a fake HN hit record for test payloads. */
function buildHnHit(
  overrides: Partial<{
    objectID: string;
    title: string;
    url: string | null;
    points: number;
    num_comments: number;
    created_at: string;
  }> = {},
) {
  return {
    objectID: overrides.objectID ?? '100',
    title: overrides.title ?? 'New Python fraud detection tool',
    url: 'url' in overrides ? overrides.url : 'https://example.com/hn-post',
    author: 'alice',
    points: overrides.points ?? 150,
    num_comments: overrides.num_comments ?? 42,
    created_at: overrides.created_at ?? '2026-03-14T12:00:00.000Z',
    created_at_i: 1742558400,
    _tags: ['story'],
  };
}

/** Build a fake GitHub repo record for test payloads. */
function buildGhRepo(
  overrides: Partial<{
    id: number;
    full_name: string;
    html_url: string;
    description: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    name: 'fraud-detect',
    full_name: overrides.full_name ?? 'owner/fraud-detect',
    description: overrides.description ?? 'ML-based fraud detection',
    html_url: overrides.html_url ?? 'https://github.com/owner/fraud-detect',
    stargazers_count: 500,
    forks_count: 40,
    language: 'Python',
    topics: ['machine-learning', 'fraud-detection'],
    pushed_at: '2026-04-01T00:00:00Z',
    created_at: '2024-05-01T00:00:00Z',
    license: { name: 'MIT' },
  };
}

/** Stub every source scenario env var and GITHUB_TOKEN. */
function stubEnvFor3Scanners() {
  vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hn-scanner');
  vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-scanner');
  vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'github-scanner');
  vi.stubEnv('TECH_SCOUT_SCENARIO_REDDIT', 'reddit-scanner');
  vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
}

const FIXED_CLOCK = () => new Date('2026-04-11T12:00:00Z');

/** Shared afterEach teardown: reset all mocks and env stubs. */
function teardown(): void {
  resetOpenAIMock();
  resetScannerMocks();
  vi.unstubAllEnvs();
}

describe('runTechScout — happy path', () => {
  afterEach(teardown);

  it('returns ok status with signals from all 3 sources', async () => {
    setOpenAIResponse('expansion-ok', { content: buildExpansionJson() });
    setOpenAIResponse('enrichment-ok', {
      content: buildEnrichmentJson(25),
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
    setHnResponse('hn-scanner', { hits: [buildHnHit()] });
    setArxivResponse('arxiv-scanner', SAMPLE_ARXIV_XML);
    setGithubResponse('github-scanner', {
      total_count: 1,
      incomplete_results: false,
      items: [buildGhRepo()],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective(),
      buildProfile(),
      'narrative prose',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'expansion-ok', enrichment: 'enrichment-ok' },
      },
    );

    expect(report.status).toBe('ok');
    expect(report.signals.length).toBeGreaterThan(0);
    expect(report.source_reports).toHaveLength(3);
    for (const sr of report.source_reports) {
      expect(['ok', 'ok_empty']).toContain(sr.status);
    }
    expect(report.expansion_plan).not.toBeNull();
    expect(report.cost_usd).toBeGreaterThan(0);
    expect(report.scanner).toBe('tech_scout');
    expect(report.generated_at).toBe('2026-04-11T12:00:00.000Z');
  }, 20_000);
});

describe('runTechScout — GitHub denied (partial failure)', () => {
  afterEach(teardown);

  it('surfaces partial status with github denied error', async () => {
    setOpenAIResponse('expansion-ok', {
      content: buildExpansionJson({ arxiv_categories: [] }),
    });
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(10) });
    setHnResponse('hn-scanner', { hits: [buildHnHit()] });
    setGithubResponse('github-scanner', { __denied: 403 });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective(),
      buildProfile(),
      'narrative prose',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'expansion-ok', enrichment: 'enrichment-ok' },
      },
    );

    expect(report.status).toBe('partial');
    const gh = report.source_reports.find((s) => s.name === 'github');
    expect(gh?.status).toBe('denied');
    expect(gh?.error?.kind).toBe('denied');
    expect(gh?.signals_count).toBe(0);
    const hn = report.source_reports.find((s) => s.name === 'hn_algolia');
    expect(hn?.status).toBe('ok');
    const arx = report.source_reports.find((s) => s.name === 'arxiv');
    expect(['ok', 'ok_empty']).toContain(arx?.status);
    expect(report.signals.length).toBeGreaterThan(0);
  });
});

describe('runTechScout — exclude filter propagation', () => {
  afterEach(teardown);

  it('filters signals whose title contains an excluded term', async () => {
    setOpenAIResponse('expansion-ok', {
      content: buildExpansionJson({ arxiv_categories: [] }),
    });
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(1) });
    setHnResponse('hn-scanner', {
      hits: [
        buildHnHit({ objectID: '1', title: 'New crypto fraud tool' }),
        buildHnHit({
          objectID: '2',
          title: 'Clean ML fraud toolkit',
          url: 'https://example.com/clean',
        }),
      ],
    });
    setGithubResponse('github-scanner', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective({ exclude: ['crypto'] }),
      buildProfile(),
      'narrative prose',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'expansion-ok', enrichment: 'enrichment-ok' },
      },
    );

    for (const sig of report.signals) {
      expect(sig.title.toLowerCase()).not.toContain('crypto');
      expect(sig.snippet.toLowerCase()).not.toContain('crypto');
    }
  });
});

describe('runTechScout — URL dedupe across sources', () => {
  afterEach(teardown);

  it('collapses duplicate URLs from HN and GitHub to one signal', async () => {
    setOpenAIResponse('expansion-ok', {
      content: buildExpansionJson({ arxiv_categories: [] }),
    });
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(1) });
    const sharedUrl = 'https://dup.example';
    setHnResponse('hn-scanner', {
      hits: [
        buildHnHit({
          objectID: '1',
          title: 'Duplicate item',
          url: sharedUrl,
          points: 10,
        }),
      ],
    });
    setGithubResponse('github-scanner', {
      total_count: 1,
      incomplete_results: false,
      items: [
        buildGhRepo({
          id: 1,
          full_name: 'dup/example',
          html_url: sharedUrl,
        }),
      ],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective({ exclude: [] }),
      buildProfile(),
      'narrative prose',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'expansion-ok', enrichment: 'enrichment-ok' },
      },
    );

    const matching = report.signals.filter((s) => s.url === sharedUrl);
    expect(matching).toHaveLength(1);
  });
});

describe('runTechScout — expansion fallback', () => {
  afterEach(teardown);

  it('falls back to directive keywords and logs warning when expansion fails', async () => {
    // Do NOT register expansion-missing — MSW returns the stub '{"ideas":[]}'
    // which fails EXPANSION_RESPONSE_SCHEMA.
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(1) });
    setHnResponse('hn-scanner', { hits: [buildHnHit()] });
    setGithubResponse('github-scanner', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective(),
      buildProfile(),
      'narrative prose',
      {
        clock: FIXED_CLOCK,
        scenarios: {
          expansion: 'expansion-missing',
          enrichment: 'enrichment-ok',
        },
      },
    );

    expect(report.warnings.some((w) => w.startsWith('expansion_fallback:'))).toBe(true);
    expect(report.source_reports.length).toBe(3);
    expect(['ok', 'partial']).toContain(report.status);
  }, 20_000);
});

describe('runTechScout — enrichment failure fallback', () => {
  afterEach(teardown);

  it('returns signals with fallback scores when enrichment fails', async () => {
    setOpenAIResponse('expansion-ok', {
      content: buildExpansionJson({ arxiv_categories: [] }),
    });
    // Do NOT register enrichment-missing.
    setHnResponse('hn-scanner', { hits: [buildHnHit()] });
    setGithubResponse('github-scanner', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective({ exclude: [] }),
      buildProfile(),
      'narrative prose',
      {
        clock: FIXED_CLOCK,
        scenarios: {
          expansion: 'expansion-ok',
          enrichment: 'enrichment-missing',
        },
      },
    );

    expect(report.status).toBe('ok');
    expect(report.signals.length).toBeGreaterThan(0);
    expect(report.warnings.some((w) => w.startsWith('enrichment_failed:'))).toBe(true);
    for (const sig of report.signals) {
      expect(sig.score).toEqual({ novelty: 5, specificity: 5, recency: 5 });
    }
  });
});

describe('runTechScout — injected clock', () => {
  afterEach(teardown);

  it('uses the injected clock for generated_at', async () => {
    setOpenAIResponse('expansion-ok', {
      content: buildExpansionJson({ arxiv_categories: [] }),
    });
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(1) });
    setHnResponse('hn-scanner', { hits: [] });
    setGithubResponse('github-scanner', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const fixedClock = () => new Date('2027-01-15T10:30:00Z');
    const report = await runTechScout(
      buildDirective(),
      buildProfile(),
      'narrative prose',
      {
        clock: fixedClock,
        scenarios: { expansion: 'expansion-ok', enrichment: 'enrichment-ok' },
      },
    );

    expect(report.generated_at).toBe('2027-01-15T10:30:00.000Z');
  });
});

describe('runTechScout — MAX_FINAL_SIGNALS cap', () => {
  afterEach(teardown);

  it('caps final signals at 25 even when raw items exceed that count', async () => {
    setOpenAIResponse('expansion-ok', {
      content: buildExpansionJson({ arxiv_categories: [] }),
    });
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(25) });
    const bigHnHits = Array.from({ length: 30 }, (_, i) =>
      buildHnHit({
        objectID: String(i + 1),
        url: `https://example.com/hn-${i + 1}`,
        title: `HN item ${i + 1}`,
      }),
    );
    setHnResponse('hn-scanner', { hits: bigHnHits });
    setGithubResponse('github-scanner', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective({ exclude: [] }),
      buildProfile(),
      'narrative prose',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'expansion-ok', enrichment: 'enrichment-ok' },
      },
    );

    expect(report.signals.length).toBeLessThanOrEqual(25);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildFallbackPlan — degrades-gracefully behavior
// ────────────────────────────────────────────────────────────────────────────

describe('buildFallbackPlan — 2026-04-24 regression', () => {
  const NOW = new Date('2026-04-24T12:00:00.000Z');

  function directive(
    overrides: Partial<ScannerDirectives['tech_scout']> = {},
  ): ScannerDirectives['tech_scout'] {
    return {
      keywords: ['tabular forecasting', 'churn prediction', 'saas', 'machine learning'],
      exclude: [],
      notes: '',
      target_sources: ['hn', 'arxiv', 'github', 'reddit', 'huggingface'],
      timeframe: 'last 6 months',
      ...overrides,
    };
  }

  it('drops GENERIC_KEYWORDS from the cloned lists and keeps only specific terms', () => {
    const plan = buildFallbackPlan(directive(), NOW);
    // "saas" and "machine learning" are both in GENERIC_KEYWORDS and must go.
    expect(plan.hn_keywords).not.toContain('saas');
    expect(plan.hn_keywords).not.toContain('machine learning');
    expect(plan.hn_keywords).toContain('tabular forecasting');
    expect(plan.hn_keywords).toContain('churn prediction');
  });

  it('clones the specific-only list to every per-source keyword array', () => {
    const plan = buildFallbackPlan(directive(), NOW);
    const expected = ['tabular forecasting', 'churn prediction'];
    expect(plan.hn_keywords).toEqual(expected);
    expect(plan.arxiv_keywords).toEqual(expected);
    expect(plan.github_keywords).toEqual(expected);
    expect(plan.reddit_keywords).toEqual(expected);
    expect(plan.huggingface_keywords).toEqual(expected);
  });

  it('populates domain_tags so HuggingFace fallback has useful keywords', () => {
    const plan = buildFallbackPlan(directive(), NOW);
    expect(plan.domain_tags.length).toBeGreaterThan(0);
    expect(plan.domain_tags).toEqual(plan.huggingface_keywords);
  });

  it('caps the specific list at 5 entries per source', () => {
    const many = directive({
      keywords: [
        'tabular forecasting',
        'churn prediction',
        'entity resolution',
        'agent orchestration',
        'feature store',
        'vector retrieval',
        'streaming anomaly',
        'record linkage',
      ],
    });
    const plan = buildFallbackPlan(many, NOW);
    expect(plan.hn_keywords.length).toBeLessThanOrEqual(5);
  });

  it('falls back to the raw directive keywords when EVERY keyword is generic', () => {
    // Last-resort guard: if we filtered down to zero, the adapters
    // would run with no query at all. Keep the generics rather than
    // ship an empty plan.
    const allGeneric = directive({
      keywords: ['saas', 'machine learning', 'programming', 'software'],
    });
    const plan = buildFallbackPlan(allGeneric, NOW);
    expect(plan.hn_keywords.length).toBeGreaterThan(0);
    expect(plan.hn_keywords).toContain('saas');
  });

  it('leaves github_languages empty so sanitizer picks up naturally', () => {
    // Prior version hard-coded ['python'], biasing the fallback toward
    // python repos. Empty is fine — the HF allowlist-sanitizer keeps
    // things sensible if a later pass fills the field.
    const plan = buildFallbackPlan(directive(), NOW);
    expect(plan.github_languages).toEqual([]);
  });

  it('leaves reddit_subreddits empty so the adapter injects its startup-universal baseline', () => {
    const plan = buildFallbackPlan(directive(), NOW);
    expect(plan.reddit_subreddits).toEqual([]);
  });

  it('sets a 6-month-backward timeframe_iso from `now`', () => {
    const plan = buildFallbackPlan(directive(), NOW);
    const cutoff = new Date(plan.timeframe_iso);
    const diffMs = NOW.getTime() - cutoff.getTime();
    // Roughly 6 months (allow ±5 days of calendar wobble).
    const sixMonthsMs = 6 * 30 * 24 * 3_600_000;
    expect(diffMs).toBeGreaterThan(sixMonthsMs - 5 * 24 * 3_600_000);
    expect(diffMs).toBeLessThan(sixMonthsMs + 5 * 24 * 3_600_000);
  });
});
