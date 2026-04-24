import { describe, it, expect, afterEach } from 'vitest';
import { refinePlan } from '../../../../pipeline/scanners/tech-scout/refine-planner';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';
import type { FirstPassSummary } from '../../../../lib/types/two-pass-state';

function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['python']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'fintech', years: 5 }]),
    insider_knowledge: stated('x'),
    anti_targets: stated([]),
    network: stated(null),
    audience: stated(null),
    proprietary_access: stated(null),
    rare_combinations: stated(null),
    recurring_frustration: stated(null),
    four_week_mvp: stated(null),
    previous_attempts: stated(null),
    customer_affinity: stated(null),
    time_to_revenue: stated('no_preference'),
    customer_type_preference: stated('no_preference'),
    trigger: stated(null),
    legal_constraints: stated(null),
    divergence_level: stated('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'refine-test',
  };
}

function buildDirective(
  overrides: Partial<ScannerDirectives['tech_scout']> = {},
): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['MCP', 'fraud'],
    exclude: [],
    notes: '',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
    ...overrides,
  };
}

function buildSummary(overrides: Partial<FirstPassSummary> = {}): FirstPassSummary {
  return {
    queries_run: [],
    dense_directions: [],
    sparse_directions: ['hn: sparse gap'],
    empty_queries: [],
    top_signal_summary: [],
    exhausted_terms: [],
    ...overrides,
  };
}

/** Build a valid ExpandedQueryPlan-shaped JSON response string. */
function buildRefineJson(
  overrides: Partial<{
    hn_keywords: string[];
    arxiv_keywords: string[];
    github_keywords: string[];
    reddit_keywords: string[];
    arxiv_categories: string[];
    github_languages: string[];
    reddit_subreddits: string[];
    domain_tags: string[];
  }> = {},
): string {
  return JSON.stringify({
    hn_keywords: overrides.hn_keywords ?? [
      'refined sparse angle 1',
      'refined sparse angle 2',
      'consumer indie launch',
      'product hunt weekly',
    ],
    arxiv_keywords: overrides.arxiv_keywords ?? [
      'automated data fusion',
      'self-supervised retrieval',
      'domain adaptation survey',
      'few-shot eval',
    ],
    github_keywords: overrides.github_keywords ?? [
      'python mcp server',
      'data scraping kit',
      'feature store py',
      'workflow tool',
    ],
    reddit_keywords: overrides.reddit_keywords ?? [
      'data collection frustration',
      'analytics tool alternatives',
      'indie founder complaints',
    ],
    huggingface_keywords: [],
    arxiv_categories: overrides.arxiv_categories ?? ['cs.LG'],
    github_languages: overrides.github_languages ?? ['python'],
    reddit_subreddits: overrides.reddit_subreddits ?? ['datascience', 'SaaS'],
    domain_tags: overrides.domain_tags ?? ['fintech'],
  });
}

const FIXED_CLOCK = () => new Date('2026-04-12T12:00:00Z');

describe('refinePlan — happy path', () => {
  afterEach(() => resetOpenAIMock());

  it('returns ok with a refined plan when the LLM response is valid', async () => {
    setOpenAIResponse('refine-ok', { content: buildRefineJson() });
    const result = await refinePlan({
      directive: buildDirective(),
      profile: buildProfile(),
      summary: buildSummary(),
      options: { scenario: 'refine-ok', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hn_keywords.length).toBeGreaterThanOrEqual(4);
    expect(result.value.timeframe_iso).toBeTruthy();
  });

  it('preserves directive acronyms (MCP) via the shared enforcer', async () => {
    setOpenAIResponse('refine-no-mcp', {
      content: buildRefineJson({
        hn_keywords: ['refined a', 'refined b', 'refined c', 'refined d'],
        arxiv_keywords: ['refined e', 'refined f', 'refined g', 'refined h'],
        github_keywords: ['refined i', 'refined j', 'refined k', 'refined l'],
      }),
    });
    const result = await refinePlan({
      directive: buildDirective({ keywords: ['MCP'] }),
      profile: buildProfile(),
      summary: buildSummary(),
      options: { scenario: 'refine-no-mcp', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hn_keywords).toContain('MCP');
    expect(result.value.arxiv_keywords).toContain('MCP');
    expect(result.value.github_keywords).toContain('MCP');
  });
});

describe('refinePlan — exhausted terms guard', () => {
  afterEach(() => resetOpenAIMock());

  it('returns err reused_exhausted when the response reuses an exhausted label', async () => {
    setOpenAIResponse('refine-reuse', {
      content: buildRefineJson({
        hn_keywords: [
          'saturated topic', // reuses exhausted term
          'b',
          'c',
          'd',
        ],
      }),
    });
    const result = await refinePlan({
      directive: buildDirective(),
      profile: buildProfile(),
      summary: buildSummary({
        exhausted_terms: ['hn: saturated topic'],
      }),
      options: { scenario: 'refine-reuse', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('reused_exhausted');
  });

  it('accepts the plan when exhausted terms are absent from the response', async () => {
    setOpenAIResponse('refine-clean', { content: buildRefineJson() });
    const result = await refinePlan({
      directive: buildDirective(),
      profile: buildProfile(),
      summary: buildSummary({
        exhausted_terms: ['hn: completely different topic'],
      }),
      options: { scenario: 'refine-clean', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(true);
  });
});

describe('refinePlan — failure', () => {
  afterEach(() => resetOpenAIMock());

  it('returns err when the LLM response fails schema validation', async () => {
    const result = await refinePlan({
      directive: buildDirective(),
      profile: buildProfile(),
      summary: buildSummary(),
      options: { scenario: 'refine-missing', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['llm_failed', 'schema_invalid']).toContain(result.error.kind);
  });
});

describe('refinePlan — edge cases', () => {
  afterEach(() => resetOpenAIMock());

  it('handles a directive with no acronyms (enforcer is a no-op)', async () => {
    setOpenAIResponse('refine-no-acr', { content: buildRefineJson() });
    const result = await refinePlan({
      directive: buildDirective({ keywords: ['fraud detection', 'data work'] }),
      profile: buildProfile(),
      summary: buildSummary(),
      options: { scenario: 'refine-no-acr', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a summary with empty exhausted_terms (nothing to ban)', async () => {
    setOpenAIResponse('refine-no-banned', { content: buildRefineJson() });
    const result = await refinePlan({
      directive: buildDirective(),
      profile: buildProfile(),
      summary: buildSummary({ exhausted_terms: [] }),
      options: { scenario: 'refine-no-banned', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(true);
  });

  it('strips the "hn:" source prefix from exhausted_terms before matching', async () => {
    // exhausted_terms come prefixed with source labels like "hn: saturated".
    // The guard must compare the CORE keyword, not the whole label.
    setOpenAIResponse('refine-stripped', {
      content: buildRefineJson({
        hn_keywords: [
          'saturated topic', // matches 'hn: saturated topic' after prefix strip
          'b',
          'c',
          'd',
        ],
      }),
    });
    const result = await refinePlan({
      directive: buildDirective(),
      profile: buildProfile(),
      summary: buildSummary({ exhausted_terms: ['hn: saturated topic'] }),
      options: { scenario: 'refine-stripped', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('reused_exhausted');
  });

  it('produces a timeframe_iso matching the directive timeframe', async () => {
    setOpenAIResponse('refine-tf', { content: buildRefineJson() });
    const result = await refinePlan({
      directive: buildDirective({ timeframe: 'last 3 months' }),
      profile: buildProfile(),
      summary: buildSummary(),
      options: { scenario: 'refine-tf', clock: FIXED_CLOCK },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cutoff = new Date(result.value.timeframe_iso);
    const now = FIXED_CLOCK();
    const diffMonths =
      (now.getUTCFullYear() - cutoff.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - cutoff.getUTCMonth());
    expect(diffMonths).toBeGreaterThanOrEqual(2);
    expect(diffMonths).toBeLessThanOrEqual(3);
  });

  it('allows the refine response to include substrings of exhausted terms without triggering reuse', async () => {
    // "saturated topic" is exhausted, but "saturated" alone is NOT an
    // exhausted TERM. If the response uses "saturated markets" — a
    // different phrase — word-boundary matching should NOT flag it.
    setOpenAIResponse('refine-substring', {
      content: buildRefineJson({
        hn_keywords: [
          'saturated markets', // contains "saturated" but not the full phrase
          'b',
          'c',
          'd',
        ],
      }),
    });
    const result = await refinePlan({
      directive: buildDirective(),
      profile: buildProfile(),
      summary: buildSummary({ exhausted_terms: ['hn: saturated topic'] }),
      options: { scenario: 'refine-substring', clock: FIXED_CLOCK },
    });
    // "saturated topic" is the exhausted phrase; "saturated markets"
    // shares only one word. The whole-phrase regex matches on
    // "saturated topic" as a word sequence, which is absent here.
    expect(result.ok).toBe(true);
  });
});
