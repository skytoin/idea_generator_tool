import { describe, it, expect, afterEach } from 'vitest';
import {
  planQueries,
  parseTimeframeToIso,
} from '../../../../pipeline/scanners/tech-scout/query-planner';
import {
  setOpenAIResponse,
  resetOpenAIMock,
} from '../../../mocks/openai-mock';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';

/** Build a minimum valid founder profile for test reuse. */
function buildValidProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['python', 'ml']),
    time_per_week: stated('10'),
    money_available: stated('lt_500'),
    ambition: stated('side_project'),
    domain: stated([{ area: 'fintech', years: 3 }]),
    insider_knowledge: stated('Internal QA process is broken'),
    anti_targets: stated(['crypto']),
    network: stated('A few ex-colleagues'),
    audience: stated('Small Twitter following'),
    proprietary_access: stated('API to internal tool'),
    rare_combinations: stated('Law + ML'),
    recurring_frustration: stated('Slow build times'),
    four_week_mvp: stated('A scheduling tool'),
    previous_attempts: stated('Tried a newsletter'),
    customer_affinity: stated('Developers'),
    time_to_revenue: stated('2_months'),
    customer_type_preference: stated('b2b'),
    trigger: stated('Got laid off'),
    legal_constraints: stated('None'),
    divergence_level: stated('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'abc',
  };
}

/** Build a minimum valid tech_scout directive for test reuse. */
function buildDirective(
  overrides: Partial<ScannerDirectives['tech_scout']> = {},
): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: [],
    notes: 'Fintech focus',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
    ...overrides,
  };
}

/** Build a content string that matches EXPANSION_RESPONSE_SCHEMA. */
function buildExpansionContent(
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

const FIXED_CLOCK = () => new Date('2026-04-11T12:00:00Z');

describe('planQueries — happy path', () => {
  afterEach(() => resetOpenAIMock());

  it('returns a valid ExpandedQueryPlan when LLM succeeds', async () => {
    setOpenAIResponse('tsp-ok', { content: buildExpansionContent() });
    const result = await planQueries(buildDirective(), buildValidProfile(), {
      scenario: 'tsp-ok',
      clock: FIXED_CLOCK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expanded_keywords).toContain('fraud detection');
    expect(result.value.expanded_keywords).toContain('anomaly detection');
    expect(result.value.expanded_keywords).toContain('risk scoring');
    expect(result.value.arxiv_categories).toEqual(['cs.LG']);
    expect(result.value.github_languages).toEqual(['python']);
    expect(result.value.domain_tags).toEqual(['fintech']);
    const iso = new Date(result.value.timeframe_iso);
    expect(Number.isNaN(iso.getTime())).toBe(false);
    expect(iso.getTime()).toBeLessThan(FIXED_CLOCK().getTime());
  });
});

describe('parseTimeframeToIso', () => {
  it('parses "last 6 months" to roughly 6 months before now', () => {
    const now = new Date('2026-04-11T12:00:00Z');
    const iso = parseTimeframeToIso('last 6 months', now);
    const d = new Date(iso);
    // Month diff: 10 (Oct) - 4 (Apr) = -6, normalize via (now.y*12+now.m - d.y*12 - d.m).
    const diff =
      (now.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('parses "last 30 days" to 30 days before now', () => {
    const now = new Date('2026-04-11T12:00:00Z');
    const iso = parseTimeframeToIso('last 30 days', now);
    const d = new Date(iso);
    const diffDays = Math.round((now.getTime() - d.getTime()) / 86_400_000);
    expect(diffDays).toBe(30);
  });

  it('parses "last year" to 1 year before now', () => {
    const now = new Date('2026-04-11T12:00:00Z');
    const iso = parseTimeframeToIso('last year', now);
    const d = new Date(iso);
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(now.getUTCMonth());
    expect(d.getUTCDate()).toBe(now.getUTCDate());
  });

  it('parses "last 2 weeks" to 14 days before now', () => {
    const now = new Date('2026-04-11T12:00:00Z');
    const iso = parseTimeframeToIso('last 2 weeks', now);
    const d = new Date(iso);
    const diffDays = Math.round((now.getTime() - d.getTime()) / 86_400_000);
    expect(diffDays).toBe(14);
  });

  it('parses unknown timeframe "forever" to Unix epoch', () => {
    const iso = parseTimeframeToIso('forever', new Date('2026-04-11T12:00:00Z'));
    expect(iso).toBe(new Date(0).toISOString());
  });
});

describe('planQueries — timeframe integration', () => {
  afterEach(() => resetOpenAIMock());

  it('threads "last 6 months" from directive through to timeframe_iso', async () => {
    setOpenAIResponse('tsp-6m', { content: buildExpansionContent() });
    const result = await planQueries(
      buildDirective({ timeframe: 'last 6 months' }),
      buildValidProfile(),
      { scenario: 'tsp-6m', clock: FIXED_CLOCK },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = new Date(result.value.timeframe_iso);
    const now = FIXED_CLOCK();
    const diff =
      (now.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('uses Unix epoch for unparseable "forever"', async () => {
    setOpenAIResponse('tsp-forever', { content: buildExpansionContent() });
    const result = await planQueries(
      buildDirective({ timeframe: 'forever' }),
      buildValidProfile(),
      { scenario: 'tsp-forever', clock: FIXED_CLOCK },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timeframe_iso).toBe(new Date(0).toISOString());
  });
});

describe('planQueries — LLM failure', () => {
  afterEach(() => resetOpenAIMock());

  it('returns err when LLM response fails to parse against schema', async () => {
    // Do not register the scenario — MSW fallback returns '{"ideas": []}'
    // which does not satisfy EXPANSION_RESPONSE_SCHEMA.
    const result = await planQueries(buildDirective(), buildValidProfile(), {
      scenario: 'tsp-missing',
      clock: FIXED_CLOCK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['llm_failed', 'schema_invalid']).toContain(result.error.kind);
  });
});

describe('planQueries — exclude hygiene', () => {
  afterEach(() => resetOpenAIMock());

  it('filters out expanded_keywords that match directive.exclude', async () => {
    setOpenAIResponse('tsp-excl', {
      content: buildExpansionContent({
        expanded_keywords: ['fraud', 'crypto', 'ML'],
      }),
    });
    const result = await planQueries(
      buildDirective({ exclude: ['crypto'] }),
      buildValidProfile(),
      { scenario: 'tsp-excl', clock: FIXED_CLOCK },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expanded_keywords).not.toContain('crypto');
    expect(result.value.expanded_keywords).toContain('fraud');
    expect(result.value.expanded_keywords).toContain('ML');
  });

  it('filters expanded_keywords case-insensitively against excludes', async () => {
    setOpenAIResponse('tsp-case', {
      content: buildExpansionContent({
        expanded_keywords: ['fraud', 'crypto', 'ML'],
      }),
    });
    const result = await planQueries(
      buildDirective({ exclude: ['Crypto'] }),
      buildValidProfile(),
      { scenario: 'tsp-case', clock: FIXED_CLOCK },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expanded_keywords).not.toContain('crypto');
  });
});
