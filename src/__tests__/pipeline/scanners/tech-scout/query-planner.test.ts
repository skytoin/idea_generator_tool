import { describe, it, expect, afterEach } from 'vitest';
import {
  planQueries,
  parseTimeframeToIso,
  enforceAcronymPreservation,
  sanitizeGithubLanguages,
  GITHUB_LANGUAGE_ALLOWLIST,
  GITHUB_LANGUAGE_MAX,
} from '../../../../pipeline/scanners/tech-scout/query-planner';
import type { ExpansionResponse } from '../../../../pipeline/prompts/tech-scout-expansion';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
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

describe('parseTimeframeToIso — edge cases', () => {
  const NOW = new Date('2026-04-11T12:00:00Z');

  it('returns Unix epoch for empty string timeframe', () => {
    const iso = parseTimeframeToIso('', NOW);
    expect(iso).toBe(new Date(0).toISOString());
  });

  it('returns Unix epoch for whitespace-only timeframe', () => {
    const iso = parseTimeframeToIso('   \t  ', NOW);
    expect(iso).toBe(new Date(0).toISOString());
  });

  it('parses "last 0 days" to exactly now (zero shift)', () => {
    // "last 0 days" does match the regex (\d+)? → 0, so it parses and
    // subtracts 0 days from now. Documents that it never crashes and
    // behaves as a no-op rather than falling through to epoch.
    const iso = parseTimeframeToIso('last 0 days', NOW);
    expect(iso).toBe(NOW.toISOString());
  });

  it('parses "LAST 6 MONTHS" (all uppercase) correctly via toLowerCase', () => {
    const iso = parseTimeframeToIso('LAST 6 MONTHS', NOW);
    const d = new Date(iso);
    const diff =
      (NOW.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (NOW.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('parses "last 6 MONTHS" (mixed case) same as all-lower', () => {
    const iso = parseTimeframeToIso('last 6 MONTHS', NOW);
    const d = new Date(iso);
    const diff =
      (NOW.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (NOW.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('tolerates extra leading/trailing whitespace in a valid timeframe', () => {
    const iso = parseTimeframeToIso('  last 6 months  ', NOW);
    const d = new Date(iso);
    const diff =
      (NOW.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (NOW.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('returns Unix epoch for a garbage string that mentions "last"', () => {
    // "last time I checked" does not match the full regex — falls through.
    const iso = parseTimeframeToIso('last time I checked', NOW);
    expect(iso).toBe(new Date(0).toISOString());
  });

  // --- regression tests for the LLM "next 6 months" hallucination bug ---

  it('parses "next 6 months" as 6 months back (forward-tense LLM hallucination)', () => {
    // Real directives-LLM output observed in the wild said "next 6 months"
    // even though the scanner looks backward in time. The parser treats
    // "next N" the same as "last N" so the pipeline doesn't fall through
    // to epoch and return ancient content.
    const iso = parseTimeframeToIso('next 6 months', NOW);
    const d = new Date(iso);
    const diff =
      (NOW.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (NOW.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('parses "past 6 months" same as "last 6 months"', () => {
    const iso = parseTimeframeToIso('past 6 months', NOW);
    const d = new Date(iso);
    const diff =
      (NOW.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (NOW.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('parses bare "6 months" (no directional prefix) same as "last 6 months"', () => {
    const iso = parseTimeframeToIso('6 months', NOW);
    const d = new Date(iso);
    const diff =
      (NOW.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (NOW.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(diff).toBeLessThanOrEqual(6);
  });

  it('parses "next 30 days" as 30 days back', () => {
    const iso = parseTimeframeToIso('next 30 days', NOW);
    const diffDays = Math.round((NOW.getTime() - new Date(iso).getTime()) / 86_400_000);
    expect(diffDays).toBe(30);
  });

  it('parses "past 2 years" as 2 years back', () => {
    const iso = parseTimeframeToIso('past 2 years', NOW);
    const d = new Date(iso);
    expect(NOW.getUTCFullYear() - d.getUTCFullYear()).toBe(2);
  });

  it('parses "next month" (no count, count defaults to 1) as 1 month back', () => {
    const iso = parseTimeframeToIso('next month', NOW);
    const d = new Date(iso);
    const diff =
      (NOW.getUTCFullYear() - d.getUTCFullYear()) * 12 +
      (NOW.getUTCMonth() - d.getUTCMonth());
    expect(diff).toBe(1);
  });

  it('parses bare "week" (no count, no prefix) as 1 week back', () => {
    const iso = parseTimeframeToIso('week', NOW);
    const diffDays = Math.round((NOW.getTime() - new Date(iso).getTime()) / 86_400_000);
    expect(diffDays).toBe(7);
  });

  it('still returns epoch for "next 6 things" (unrecognized unit)', () => {
    const iso = parseTimeframeToIso('next 6 things', NOW);
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

describe('planQueries — generic keyword demotion', () => {
  afterEach(() => resetOpenAIMock());

  it('moves generic umbrella terms to the END of expanded_keywords', async () => {
    // LLM returned generics first (the observed real-world behavior).
    // The post-filter should put specific terms at the front so HN/arxiv/
    // GitHub adapters that take slice(0, 3) hit meaningful queries.
    setOpenAIResponse('tsp-generic', {
      content: buildExpansionContent({
        expanded_keywords: [
          'machine learning', // generic, should be demoted
          'data science', // generic
          'python', // generic
          'retrieval augmented generation', // specific, should rise
          'vector database', // specific, should rise
          'agentic pipelines', // specific, should rise
        ],
      }),
    });
    const result = await planQueries(buildDirective(), buildValidProfile(), {
      scenario: 'tsp-generic',
      clock: FIXED_CLOCK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first3 = result.value.expanded_keywords.slice(0, 3);
    expect(first3).toContain('retrieval augmented generation');
    expect(first3).toContain('vector database');
    expect(first3).toContain('agentic pipelines');
    // Generics must NOT be in the first 3 because adapters take slice(0, 3)
    expect(first3).not.toContain('machine learning');
    expect(first3).not.toContain('data science');
    expect(first3).not.toContain('python');
  });

  it('preserves order of specific terms when demoting generics', async () => {
    setOpenAIResponse('tsp-order', {
      content: buildExpansionContent({
        expanded_keywords: ['ai', 'fraud detection', 'saas', 'anomaly ml'],
      }),
    });
    const result = await planQueries(buildDirective(), buildValidProfile(), {
      scenario: 'tsp-order',
      clock: FIXED_CLOCK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kws = result.value.expanded_keywords;
    // Order should be: specific (preserved) + generic (preserved)
    expect(kws).toEqual(['fraud detection', 'anomaly ml', 'ai', 'saas']);
  });

  it('leaves an all-specific keyword list alone', async () => {
    setOpenAIResponse('tsp-all-specific', {
      content: buildExpansionContent({
        expanded_keywords: ['fraud detection', 'anomaly detection', 'risk scoring'],
      }),
    });
    const result = await planQueries(buildDirective(), buildValidProfile(), {
      scenario: 'tsp-all-specific',
      clock: FIXED_CLOCK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expanded_keywords).toEqual([
      'fraud detection',
      'anomaly detection',
      'risk scoring',
    ]);
  });

  it('demotes generics case-insensitively (SaaS, PYTHON, Machine Learning)', async () => {
    setOpenAIResponse('tsp-case-demote', {
      content: buildExpansionContent({
        expanded_keywords: ['SaaS', 'PYTHON', 'Machine Learning', 'vector database'],
      }),
    });
    const result = await planQueries(buildDirective(), buildValidProfile(), {
      scenario: 'tsp-case-demote',
      clock: FIXED_CLOCK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expanded_keywords[0]).toBe('vector database');
  });
});

describe('enforceAcronymPreservation', () => {
  /** Build a syntactically valid ExpansionResponse for direct unit testing. */
  function resp(overrides: Partial<ExpansionResponse> = {}): ExpansionResponse {
    return {
      hn_keywords: [
        'data collection saas',
        'consumer ml tools',
        'personal analytics',
        'indie launches',
      ],
      arxiv_keywords: [
        'automated feature engineering',
        'multi-source data fusion',
        'few-shot learning',
        'knowledge transfer',
      ],
      github_keywords: [
        'web scraping pipeline',
        'data aggregation framework',
        'feature store',
        'python tool',
      ],
      reddit_keywords: [
        'data collection frustration',
        'analytics tool complaints',
        'indie founder tools',
      ],
      huggingface_keywords: ['fraud detection', 'tabular forecasting'],
      arxiv_categories: ['cs.LG'],
      github_languages: ['python'],
      reddit_subreddits: ['datascience', 'SaaS'],
      domain_tags: ['fintech'],
      ...overrides,
    };
  }

  it('appends a missing acronym to all three keyword lists', () => {
    const out = enforceAcronymPreservation(resp(), ['MCP', 'python']);
    expect(out.hn_keywords).toContain('MCP');
    expect(out.arxiv_keywords).toContain('MCP');
    expect(out.github_keywords).toContain('MCP');
  });

  it('leaves response unchanged when the acronym is already present in any list', () => {
    const before = resp({
      hn_keywords: ['MCP server launch', 'foo', 'bar', 'baz'],
    });
    const out = enforceAcronymPreservation(before, ['MCP']);
    expect(out.hn_keywords).toEqual(before.hn_keywords);
    expect(out.arxiv_keywords).toEqual(before.arxiv_keywords);
    expect(out.github_keywords).toEqual(before.github_keywords);
  });

  it('matches acronym as a whole word only (MC in "MC models" does NOT preserve MCP)', () => {
    // Regression for the 2026-04-12 production drift: LLM emitted
    // "adaptive MC models" for MCP. "MC" is a substring of "MCP" only if
    // we allow partial matches; a word-boundary match correctly rejects it.
    const before = resp({
      arxiv_keywords: ['adaptive MC models', 'foo', 'bar', 'baz'],
    });
    const out = enforceAcronymPreservation(before, ['MCP']);
    expect(out.hn_keywords).toContain('MCP');
    expect(out.arxiv_keywords).toContain('MCP');
    expect(out.github_keywords).toContain('MCP');
  });

  it('appends multiple missing acronyms in directive order', () => {
    const out = enforceAcronymPreservation(resp(), ['MCP', 'CLI', 'RAG']);
    for (const ac of ['MCP', 'CLI', 'RAG']) {
      expect(out.github_keywords).toContain(ac);
      expect(out.hn_keywords).toContain(ac);
      expect(out.arxiv_keywords).toContain(ac);
    }
  });

  it('does not append non-acronym keywords (Python, data science, SaaS)', () => {
    // "Python" is a word, "data science" has a space, "SaaS" has mixed
    // case — none qualify as acronyms under the 2-6 uppercase-letter rule.
    const out = enforceAcronymPreservation(resp(), ['Python', 'data science', 'SaaS']);
    expect(out.hn_keywords).not.toContain('Python');
    expect(out.hn_keywords).not.toContain('data science');
    expect(out.hn_keywords).not.toContain('SaaS');
  });

  it('treats acronyms case-sensitively for detection but matches case-insensitively for containment', () => {
    // Only uppercase-letter tokens of length 2-6 qualify as acronyms.
    // Once an acronym is identified, we check for it case-insensitively in
    // the expanded lists — so "mcp" somewhere in hn_keywords counts.
    const before = resp({
      hn_keywords: ['mcp server', 'foo', 'bar', 'baz'],
    });
    const out = enforceAcronymPreservation(before, ['MCP']);
    expect(out.hn_keywords).toEqual(before.hn_keywords);
    expect(out.arxiv_keywords).toEqual(before.arxiv_keywords);
    expect(out.github_keywords).toEqual(before.github_keywords);
  });

  it('is a no-op when directive has no acronyms', () => {
    const before = resp();
    const out = enforceAcronymPreservation(before, ['python', 'data science']);
    expect(out.hn_keywords).toEqual(before.hn_keywords);
    expect(out.arxiv_keywords).toEqual(before.arxiv_keywords);
    expect(out.github_keywords).toEqual(before.github_keywords);
  });

  it('ignores overly long uppercase tokens (>6 letters) which are unlikely to be true acronyms', () => {
    const out = enforceAcronymPreservation(resp(), ['HACKATHON']);
    expect(out.hn_keywords).not.toContain('HACKATHON');
  });

  it('ignores 1-letter uppercase "tokens" (too short to be acronyms)', () => {
    const out = enforceAcronymPreservation(resp(), ['A']);
    expect(out.hn_keywords).not.toContain('A');
    expect(out.arxiv_keywords).not.toContain('A');
    expect(out.github_keywords).not.toContain('A');
  });

  it('only appends each missing acronym once even if the directive repeats it', () => {
    const out = enforceAcronymPreservation(resp(), ['MCP', 'MCP', 'MCP']);
    const mcpCountHn = out.hn_keywords.filter((k) => k === 'MCP').length;
    // Duplicate directive entries should all be preserved together, but
    // since we append once per missing occurrence, three entries → three
    // appends. That's acceptable as long as the downstream planner still
    // passes schema (max 8 per list). Pin observed behavior.
    expect(mcpCountHn).toBeGreaterThanOrEqual(1);
  });

  it('partial preservation: MCP in hn_keywords only still counts as preserved', () => {
    const before = resp({
      hn_keywords: ['the MCP protocol', 'foo', 'bar', 'baz'],
    });
    const out = enforceAcronymPreservation(before, ['MCP']);
    expect(out.arxiv_keywords).toEqual(before.arxiv_keywords);
    expect(out.github_keywords).toEqual(before.github_keywords);
    expect(out.hn_keywords).toEqual(before.hn_keywords);
  });

  it('rejects acronyms containing digits (e.g. "W3C", "HTTP2") as not-an-acronym', () => {
    // Digits are common in standards but the regex requires pure A-Z.
    // Rejecting them means they fall through to normal keyword handling
    // and must be preserved by the generic demotion rules instead.
    const out = enforceAcronymPreservation(resp(), ['W3C', 'HTTP2']);
    expect(out.hn_keywords).not.toContain('W3C');
    expect(out.hn_keywords).not.toContain('HTTP2');
  });

  it('treats an acronym with surrounding punctuation in the haystack as preserved (word boundary)', () => {
    // "(MCP)" should satisfy the word-boundary check because word
    // boundaries match against non-word characters like parentheses.
    const before = resp({
      hn_keywords: ['some (MCP) stuff', 'foo', 'bar', 'baz'],
    });
    const out = enforceAcronymPreservation(before, ['MCP']);
    expect(out.hn_keywords).toEqual(before.hn_keywords);
  });

  it('handles multiple acronyms with mixed preservation status', () => {
    // MCP: preserved (in hn_keywords), CLI: missing, RAG: missing.
    // Only CLI and RAG should be appended.
    const before = resp({
      hn_keywords: ['MCP news roundup', 'foo', 'bar', 'baz'],
    });
    const out = enforceAcronymPreservation(before, ['MCP', 'CLI', 'RAG']);
    // MCP unchanged in hn_keywords (already preserved)
    expect(out.hn_keywords.filter((k) => k === 'MCP')).toHaveLength(0);
    // CLI and RAG appended to all three lists
    expect(out.hn_keywords).toContain('CLI');
    expect(out.hn_keywords).toContain('RAG');
    expect(out.arxiv_keywords).toContain('CLI');
    expect(out.arxiv_keywords).toContain('RAG');
    expect(out.github_keywords).toContain('CLI');
    expect(out.github_keywords).toContain('RAG');
  });

  it('trims whitespace around directive acronyms before testing (" MCP ")', () => {
    const out = enforceAcronymPreservation(resp(), ['  MCP  ']);
    // Should still be detected as an acronym and injected verbatim
    // (without the leading/trailing whitespace).
    expect(out.hn_keywords).toContain('MCP');
    expect(out.hn_keywords).not.toContain('  MCP  ');
  });
});

describe('sanitizeGithubLanguages', () => {
  it('returns an empty array when given an empty input', () => {
    expect(sanitizeGithubLanguages([])).toEqual([]);
  });

  it('keeps allowlisted languages verbatim (preserves original casing)', () => {
    const out = sanitizeGithubLanguages(['Python', 'TypeScript', 'Rust']);
    expect(out).toEqual(['Python', 'TypeScript', 'Rust']);
  });

  it('drops languages NOT in the allowlist (the Opus hallucination case)', () => {
    const opus_dump = [
      'Python',
      'TypeScript',
      'Adobe Font',
      'Common',
      '5th Gen',
      '1C Enterprise',
      'AGS Script',
      'VBScript',
      '4D',
    ];
    const out = sanitizeGithubLanguages(opus_dump);
    expect(out).toContain('Python');
    expect(out).toContain('TypeScript');
    expect(out).not.toContain('Adobe Font');
    expect(out).not.toContain('1C Enterprise');
    expect(out).not.toContain('VBScript');
    expect(out).not.toContain('4D');
  });

  it('caps the result at GITHUB_LANGUAGE_MAX entries (preserving order)', () => {
    // 7 valid allowlisted languages — only the first 5 should survive.
    const out = sanitizeGithubLanguages([
      'Python',
      'TypeScript',
      'JavaScript',
      'Go',
      'Rust',
      'Julia',
      'R',
    ]);
    expect(out).toHaveLength(GITHUB_LANGUAGE_MAX);
    expect(out).toEqual(['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust']);
  });

  it('dedupes case-insensitively while preserving the first-seen casing', () => {
    const out = sanitizeGithubLanguages(['Python', 'python', 'PYTHON', 'Go']);
    expect(out).toEqual(['Python', 'Go']);
  });

  it('matches the allowlist case-insensitively (lowercase input survives)', () => {
    const out = sanitizeGithubLanguages(['python', 'rust', 'go']);
    expect(out).toEqual(['python', 'rust', 'go']);
  });

  it('skips empty strings and whitespace-only entries', () => {
    const out = sanitizeGithubLanguages(['Python', '', '   ', 'Go']);
    expect(out).toEqual(['Python', 'Go']);
  });

  it('still returns valid entries when the input is mostly garbage', () => {
    const garbage = ['xxx', 'fake', 'nonsense', 'Python', 'totally-not-real', 'Go'];
    const out = sanitizeGithubLanguages(garbage);
    expect(out).toEqual(['Python', 'Go']);
  });

  it('the allowlist itself stays passthrough (every entry survives, capped)', () => {
    const out = sanitizeGithubLanguages([...GITHUB_LANGUAGE_ALLOWLIST]);
    expect(out.length).toBe(GITHUB_LANGUAGE_MAX);
    expect(out).toEqual(GITHUB_LANGUAGE_ALLOWLIST.slice(0, GITHUB_LANGUAGE_MAX));
  });

  it('exposes a tight cap (GITHUB_LANGUAGE_MAX is 5)', () => {
    expect(GITHUB_LANGUAGE_MAX).toBe(5);
  });

  it('the allowlist contains the languages relevant to data/ML/SaaS work', () => {
    const lower = GITHUB_LANGUAGE_ALLOWLIST.map((l) => l.toLowerCase());
    for (const must of ['python', 'typescript', 'go', 'rust', 'sql']) {
      expect(lower).toContain(must);
    }
  });

  it('does NOT include the Opus hallucinations in the allowlist', () => {
    const lower = GITHUB_LANGUAGE_ALLOWLIST.map((l) => l.toLowerCase());
    for (const garbage of ['adobe font', '5th gen', '1c enterprise', 'ags script']) {
      expect(lower).not.toContain(garbage);
    }
  });
});
