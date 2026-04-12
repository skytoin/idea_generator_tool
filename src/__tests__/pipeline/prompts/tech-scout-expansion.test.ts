import { describe, it, expect } from 'vitest';
import {
  EXPANSION_RESPONSE_SCHEMA,
  buildExpansionSystemPrompt,
  buildExpansionUserPrompt,
} from '../../../pipeline/prompts/tech-scout-expansion';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';

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

describe('EXPANSION_RESPONSE_SCHEMA', () => {
  it('parses a valid response', () => {
    const valid = {
      expanded_keywords: ['fraud detection', 'anomaly detection', 'risk scoring'],
      arxiv_categories: ['cs.LG'],
      github_languages: ['python'],
      domain_tags: ['fintech'],
    };
    const result = EXPANSION_RESPONSE_SCHEMA.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects expanded_keywords with fewer than 3 items', () => {
    const invalid = {
      expanded_keywords: ['a', 'b'],
      arxiv_categories: [],
      github_languages: [],
      domain_tags: [],
    };
    const result = EXPANSION_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects expanded_keywords with more than 10 items', () => {
    const invalid = {
      expanded_keywords: [
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
        'g',
        'h',
        'i',
        'j',
        'k',
      ],
      arxiv_categories: [],
      github_languages: [],
      domain_tags: [],
    };
    const result = EXPANSION_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects arxiv_categories with more than 5 items', () => {
    const invalid = {
      expanded_keywords: ['a', 'b', 'c'],
      arxiv_categories: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      github_languages: [],
      domain_tags: [],
    };
    const result = EXPANSION_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects github_languages with more than 5 items', () => {
    const invalid = {
      expanded_keywords: ['a', 'b', 'c'],
      arxiv_categories: [],
      github_languages: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
      domain_tags: [],
    };
    const result = EXPANSION_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects domain_tags with more than 10 items', () => {
    const invalid = {
      expanded_keywords: ['a', 'b', 'c'],
      arxiv_categories: [],
      github_languages: [],
      domain_tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
    };
    const result = EXPANSION_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts empty arrays for github_languages, domain_tags, arxiv_categories', () => {
    const valid = {
      expanded_keywords: ['a', 'b', 'c'],
      arxiv_categories: [],
      github_languages: [],
      domain_tags: [],
    };
    const result = EXPANSION_RESPONSE_SCHEMA.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe('buildExpansionSystemPrompt', () => {
  it('returns a string containing required keywords', () => {
    const system = buildExpansionSystemPrompt();
    expect(system).toContain('Tech Scout');
    expect(system).toContain('arxiv');
    expect(system).toContain('GitHub');
    expect(system).toContain('NEVER');
    expect(system).toContain('exclude list');
  });

  it('prepends scenario marker when provided', () => {
    const system = buildExpansionSystemPrompt('xyz-scenario');
    expect(system.startsWith('[[SCENARIO:xyz-scenario]]')).toBe(true);
  });

  it('omits scenario marker when not provided', () => {
    const system = buildExpansionSystemPrompt();
    expect(system.startsWith('[[SCENARIO:')).toBe(false);
  });
});

describe('buildExpansionUserPrompt', () => {
  it('includes directive keywords joined by comma verbatim', () => {
    const directive = buildDirective({
      keywords: ['fraud detection', 'payments risk'],
    });
    const user = buildExpansionUserPrompt(directive, buildValidProfile());
    expect(user).toContain('fraud detection, payments risk');
  });

  it('includes the exclude list verbatim', () => {
    const directive = buildDirective({ exclude: ['crypto', 'gambling'] });
    const user = buildExpansionUserPrompt(directive, buildValidProfile());
    expect(user).toContain('crypto, gambling');
  });

  it('includes directive.notes verbatim', () => {
    const directive = buildDirective({ notes: 'Distinctive marker for test' });
    const user = buildExpansionUserPrompt(directive, buildValidProfile());
    expect(user).toContain('Distinctive marker for test');
  });

  it("includes the founder's skills", () => {
    const profile = buildValidProfile();
    const user = buildExpansionUserPrompt(buildDirective(), profile);
    for (const skill of profile.skills.value) {
      expect(user).toContain(skill);
    }
  });

  it("renders '(none)' when directive.exclude is empty", () => {
    const directive = buildDirective({ exclude: [] });
    const user = buildExpansionUserPrompt(directive, buildValidProfile());
    expect(user).toContain('(none)');
  });
});

describe('buildExpansionSystemPrompt — v1.1 quality rules', () => {
  it('explicitly requires specific-first keyword ordering', () => {
    const system = buildExpansionSystemPrompt();
    expect(system).toMatch(/ordering is critical/i);
    expect(system).toMatch(/most specific.*first/i);
    expect(system).toMatch(/most generic.*last/i);
  });

  it('lists generic umbrella terms to avoid at the front', () => {
    const system = buildExpansionSystemPrompt();
    // The prompt should name-and-shame common generics so the LLM
    // recognizes them as patterns to sink, not surface.
    expect(system).toContain('machine learning');
    expect(system).toContain('data science');
    expect(system).toContain('Python');
    expect(system).toContain('SaaS');
  });

  it('requires at least 2-3 highly specific terms from the founder profile', () => {
    const system = buildExpansionSystemPrompt();
    expect(system).toMatch(/2-3 highly specific terms/i);
  });

  it('includes acronym disambiguation rule with MCP example', () => {
    const system = buildExpansionSystemPrompt();
    expect(system).toMatch(/ACRONYM/i);
    expect(system).toMatch(/preserve the acronym verbatim/i);
    expect(system).toContain('MCP');
    expect(system).toContain('Model Context Protocol');
  });
});
