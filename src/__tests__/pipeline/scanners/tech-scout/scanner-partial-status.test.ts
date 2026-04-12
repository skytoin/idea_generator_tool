import { describe, it, expect, afterEach, vi } from 'vitest';
import { runTechScout } from '../../../../pipeline/scanners/tech-scout/scanner';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
import {
  setHnResponse,
  setGithubResponse,
  resetScannerMocks,
} from '../../../mocks/scanner-mocks';
import {
  hnAlgoliaAdapter,
  arxivAdapter,
  githubAdapter,
} from '../../../../pipeline/scanners/tech-scout/adapters';
import { TimeoutError } from '../../../../lib/utils/with-timeout';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';

/** Inline minimum valid founder profile for these tests. */
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

/** Build a minimum valid tech_scout directive for these tests. */
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
 * Build a valid expansion JSON string. Defaults produce an arxiv_categories
 * list with one category; overrides can clear it to force arxiv into an
 * empty-planQueries path.
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

/** Stub all three source scenario env vars and GITHUB_TOKEN. */
function stubEnvFor3Scanners(): void {
  vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hn-scanner');
  vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-scanner');
  vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'github-scanner');
  vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
}

const FIXED_CLOCK = () => new Date('2026-04-11T12:00:00Z');

/** Shared afterEach teardown: reset all mocks and env stubs. */
function teardown(): void {
  resetOpenAIMock();
  resetScannerMocks();
  vi.unstubAllEnvs();
}

describe('runTechScout — all ok_empty', () => {
  afterEach(teardown);

  it('returns report.status === "ok" when every source returns zero signals', async () => {
    setOpenAIResponse('expansion-ok', {
      content: buildExpansionJson({ arxiv_categories: [] }),
    });
    // Enrichment will still be called with 0 inputs → register a valid
    // empty-signals response so the enricher succeeds.
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(0) });
    // All 3 adapters return explicitly empty bodies (not errors).
    setHnResponse('hn-scanner', { hits: [] });
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
        scenarios: { expansion: 'expansion-ok', enrichment: 'enrichment-ok' },
      },
    );

    // Every source succeeded, just with zero signals → aggregate is 'ok'.
    expect(report.status).toBe('ok');
    expect(report.signals).toEqual([]);
    expect(report.total_raw_items).toBe(0);
    for (const sr of report.source_reports) {
      expect(['ok', 'ok_empty']).toContain(sr.status);
    }
  });
});

describe('runTechScout — all timeouts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    teardown();
  });

  it('returns report.status === "failed" when every adapter throws a timeout', async () => {
    setOpenAIResponse('expansion-ok', { content: buildExpansionJson() });
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(0) });
    stubEnvFor3Scanners();

    // Force each adapter's fetch() to throw TimeoutError synchronously
    // so the orchestrator's classifyError maps every source to 'timeout'.
    const timeoutError = new TimeoutError(60_000);
    vi.spyOn(hnAlgoliaAdapter, 'fetch').mockRejectedValue(timeoutError);
    vi.spyOn(arxivAdapter, 'fetch').mockRejectedValue(timeoutError);
    vi.spyOn(githubAdapter, 'fetch').mockRejectedValue(timeoutError);

    const report = await runTechScout(
      buildDirective(),
      buildProfile(),
      'narrative prose',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'expansion-ok', enrichment: 'enrichment-ok' },
      },
    );

    expect(report.status).toBe('failed');
    expect(report.source_reports).toHaveLength(3);
    for (const sr of report.source_reports) {
      expect(sr.status).toBe('timeout');
      expect(sr.error?.kind).toBe('timeout');
      expect(sr.signals_count).toBe(0);
    }
    expect(report.signals).toEqual([]);
  });
});

describe('runTechScout — mixed ok_empty plus denied', () => {
  afterEach(teardown);

  it('returns report.status === "partial" when some sources are ok_empty and one is denied', async () => {
    setOpenAIResponse('expansion-ok', {
      content: buildExpansionJson({ arxiv_categories: [] }),
    });
    setOpenAIResponse('enrichment-ok', { content: buildEnrichmentJson(0) });
    // HN ok_empty, arxiv ok_empty (no categories planned), github denied.
    setHnResponse('hn-scanner', { hits: [] });
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

    // One denied + two ok_empty is NOT all-ok and NOT all-failed → partial.
    expect(report.status).toBe('partial');
    const gh = report.source_reports.find((s) => s.name === 'github');
    expect(gh?.status).toBe('denied');
    const hn = report.source_reports.find((s) => s.name === 'hn_algolia');
    expect(hn?.status).toBe('ok_empty');
    const arx = report.source_reports.find((s) => s.name === 'arxiv');
    expect(arx?.status).toBe('ok_empty');
  });
});
