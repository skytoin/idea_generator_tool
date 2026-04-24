import { describe, it, expect, afterEach, vi } from 'vitest';
import { runTechScout } from '../../../../pipeline/scanners/tech-scout/scanner';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
import {
  setHnResponse,
  setArxivResponse,
  setGithubResponse,
  resetScannerMocks,
} from '../../../mocks/scanner-mocks';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';

/**
 * Scanner-level integration tests for the skill_remix and
 * adjacent_worlds feature flags. Verifies the scanner calls the
 * corresponding LLM modules in parallel, threads their output into
 * the expansion planner, and degrades gracefully when they fail.
 */

function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  const assumed = <T>(value: T) => ({ value, source: 'assumed' as const });
  return {
    skills: stated(['Python', 'nursing']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'healthcare', years: 10 }]),
    insider_knowledge: stated('clinical documentation workflow'),
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
    profile_hash: 'v2-features',
  };
}

function buildDirective(
  overrides: Partial<ScannerDirectives['tech_scout']> = {},
): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['MCP', 'clinical documentation'],
    exclude: [],
    notes: 'v2 features integration',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
    ...overrides,
  };
}

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
      'clinical workflow saas',
      'mcp tooling',
      'indie healthtech',
      'analytics dash',
    ],
    arxiv_keywords: overrides.arxiv_keywords ?? [
      'clinical nlp',
      'documentation automation',
      'transfer learning ehr',
      'few-shot notes',
    ],
    github_keywords: overrides.github_keywords ?? [
      'clinical parser',
      'mcp server',
      'ehr pipeline',
      'python nlp kit',
    ],
    reddit_keywords: overrides.reddit_keywords ?? [
      'clinical workflow pain',
      'ehr frustration',
      'nurse charting',
    ],
    huggingface_keywords: [],
    arxiv_categories: ['cs.CL'],
    github_languages: ['python'],
    reddit_subreddits: overrides.reddit_subreddits ?? ['nursing', 'healthIT'],
    domain_tags: ['healthcare'],
  });
}

function buildEnrichmentJson(count: number): string {
  return JSON.stringify({
    signals: Array.from({ length: count }, (_, i) => ({
      index: i,
      title: `Enriched ${i}`,
      snippet: 's',
      score: { novelty: 7, specificity: 7, recency: 8, relevance: 8 },
      category: 'tech_capability',
    })),
  });
}

function buildRemixJson(count = 3): string {
  return JSON.stringify({
    hunts: Array.from({ length: count }, (_, i) => ({
      skill_source: 'nursing',
      problem: `concrete clinical problem ${i}`,
      example_search_phrases: [`clinical phrase ${i}`],
    })),
  });
}

function buildWorldsJson(count = 2): string {
  return JSON.stringify({
    worlds: Array.from({ length: count }, (_, i) => ({
      source_domain: 'nursing',
      adjacent_domain: `world${i}`,
      shared_traits: ['safety-critical checklists'],
      example_search_phrases: [`phrase${i}`],
    })),
  });
}

function buildHit(objectID: string, created_at: string) {
  return {
    objectID,
    title: `hit ${objectID}`,
    url: `https://example.com/${objectID}`,
    author: 'a',
    points: 100,
    num_comments: 5,
    created_at,
    created_at_i: Math.floor(new Date(created_at).getTime() / 1000),
    _tags: ['story'],
  };
}

function stubEnv(): void {
  vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'v2f-hn');
  vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'v2f-arxiv');
  vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'v2f-github');
  vi.stubEnv('GITHUB_TOKEN', 'ghp_v2f');
}

const CLOCK = () => new Date('2026-04-12T12:00:00Z');

function teardown(): void {
  resetOpenAIMock();
  resetScannerMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
}

/** Register the minimum mock bodies the scanner needs to run. */
function registerHappyPathMocks(): void {
  setOpenAIResponse('v2f-expansion', { content: buildExpansionJson() });
  setOpenAIResponse('v2f-enrich', { content: buildEnrichmentJson(1) });
  setHnResponse('v2f-hn', {
    hits: [buildHit('fresh', '2026-03-01T00:00:00.000Z')],
  });
  setArxivResponse('v2f-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
  setGithubResponse('v2f-github', {
    total_count: 0,
    incomplete_results: false,
    items: [],
  });
  stubEnv();
}

describe('runTechScout — features.skill_remix flag', () => {
  afterEach(teardown);

  it('attaches no fallback warning on skill_remix happy path', async () => {
    registerHappyPathMocks();
    setOpenAIResponse('v2f-remix', { content: buildRemixJson(3) });

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'v2f-expansion',
        enrichment: 'v2f-enrich',
        skill_remix: 'v2f-remix',
      },
      features: { skill_remix: true },
    });

    expect(report.warnings.some((w) => w.startsWith('skill_remix_fallback:'))).toBe(
      false,
    );
    expect(report.status).toBe('ok');
  }, 60_000);

  it('records a skill_remix_fallback warning when the LLM response is invalid', async () => {
    registerHappyPathMocks();
    // No v2f-remix-missing registered → schema_invalid fallback.

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'v2f-expansion',
        enrichment: 'v2f-enrich',
        skill_remix: 'v2f-remix-missing',
      },
      features: { skill_remix: true },
    });

    expect(report.warnings.some((w) => w.startsWith('skill_remix_fallback:'))).toBe(true);
    // Scanner still produced signals even though skill_remix failed.
    expect(report.signals.length).toBeGreaterThan(0);
  }, 60_000);

  it('does not call skill_remix when the flag is off (no warning regardless)', async () => {
    registerHappyPathMocks();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'v2f-expansion',
        enrichment: 'v2f-enrich',
      },
    });

    expect(report.warnings.some((w) => w.startsWith('skill_remix_fallback:'))).toBe(
      false,
    );
  }, 60_000);
});

describe('runTechScout — features.adjacent_worlds flag', () => {
  afterEach(teardown);

  it('attaches no fallback warning on adjacent_worlds happy path', async () => {
    registerHappyPathMocks();
    setOpenAIResponse('v2f-adj', { content: buildWorldsJson(2) });

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'v2f-expansion',
        enrichment: 'v2f-enrich',
        adjacent_worlds: 'v2f-adj',
      },
      features: { adjacent_worlds: true },
    });

    expect(report.warnings.some((w) => w.startsWith('adjacent_worlds_fallback:'))).toBe(
      false,
    );
    expect(report.status).toBe('ok');
  }, 60_000);

  it('records an adjacent_worlds_fallback warning when the LLM fails', async () => {
    registerHappyPathMocks();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'v2f-expansion',
        enrichment: 'v2f-enrich',
        adjacent_worlds: 'v2f-adj-missing',
      },
      features: { adjacent_worlds: true },
    });

    expect(report.warnings.some((w) => w.startsWith('adjacent_worlds_fallback:'))).toBe(
      true,
    );
    expect(report.signals.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('runTechScout — both v2 flags together', () => {
  afterEach(teardown);

  it('runs skill_remix AND adjacent_worlds in parallel when both flags are on', async () => {
    registerHappyPathMocks();
    setOpenAIResponse('v2f-remix', { content: buildRemixJson(3) });
    setOpenAIResponse('v2f-adj', { content: buildWorldsJson(2) });

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'v2f-expansion',
        enrichment: 'v2f-enrich',
        skill_remix: 'v2f-remix',
        adjacent_worlds: 'v2f-adj',
      },
      features: { skill_remix: true, adjacent_worlds: true },
    });

    // Both stages must succeed (no fallback warnings) and the run is ok.
    expect(report.warnings.some((w) => w.startsWith('skill_remix_fallback:'))).toBe(
      false,
    );
    expect(report.warnings.some((w) => w.startsWith('adjacent_worlds_fallback:'))).toBe(
      false,
    );
    expect(report.status).toBe('ok');
  }, 60_000);

  it('degrades gracefully when ONE flag fails: records that fallback, keeps the other', async () => {
    registerHappyPathMocks();
    setOpenAIResponse('v2f-remix', { content: buildRemixJson(3) });
    // adjacent_worlds intentionally missing.

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'v2f-expansion',
        enrichment: 'v2f-enrich',
        skill_remix: 'v2f-remix',
        adjacent_worlds: 'v2f-adj-missing',
      },
      features: { skill_remix: true, adjacent_worlds: true },
    });

    expect(report.warnings.some((w) => w.startsWith('skill_remix_fallback:'))).toBe(
      false,
    );
    expect(report.warnings.some((w) => w.startsWith('adjacent_worlds_fallback:'))).toBe(
      true,
    );
  }, 60_000);
});

describe('runTechScout — all three v2 flags at once', () => {
  afterEach(teardown);

  it('runs skill_remix + adjacent_worlds + two_pass in one request and produces two_pass_meta', async () => {
    setOpenAIResponse('v2f-expansion', { content: buildExpansionJson() });
    setOpenAIResponse('v2f-enrich', { content: buildEnrichmentJson(1) });
    setOpenAIResponse('v2f-remix', { content: buildRemixJson(3) });
    setOpenAIResponse('v2f-adj', { content: buildWorldsJson(2) });
    setOpenAIResponse('v2f-refine', {
      content: buildExpansionJson({
        hn_keywords: ['refined a', 'refined b', 'refined c', 'refined d'],
      }),
    });
    setHnResponse('v2f-hn', {
      hits: [buildHit('a', '2026-03-01T00:00:00.000Z')],
    });
    setArxivResponse('v2f-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('v2f-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnv();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: CLOCK,
      scenarios: {
        expansion: 'v2f-expansion',
        enrichment: 'v2f-enrich',
        skill_remix: 'v2f-remix',
        adjacent_worlds: 'v2f-adj',
        refine: 'v2f-refine',
      },
      features: {
        skill_remix: true,
        adjacent_worlds: true,
        two_pass: true,
      },
    });

    // All three stages succeed → no fallback warnings and two_pass_meta set.
    expect(
      report.warnings.some(
        (w) =>
          w.startsWith('skill_remix_fallback:') ||
          w.startsWith('adjacent_worlds_fallback:') ||
          w.startsWith('two_pass_fallback:'),
      ),
    ).toBe(false);
    expect(report.two_pass_meta).toBeDefined();
    if (!report.two_pass_meta) return;
    expect(report.two_pass_meta.pass2_plan).not.toBeNull();
    expect(report.two_pass_meta.pass2_skipped_reason).toBeNull();
  }, 120_000);
});
