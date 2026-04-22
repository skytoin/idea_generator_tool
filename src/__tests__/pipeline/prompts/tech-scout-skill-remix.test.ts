import { describe, it, expect } from 'vitest';
import {
  SKILL_REMIX_RESPONSE_SCHEMA,
  buildSkillRemixSystemPrompt,
  buildSkillRemixUserPrompt,
} from '../../../pipeline/prompts/tech-scout-skill-remix';
import type { FounderProfile } from '../../../lib/types/founder-profile';

/** Build a minimum valid founder profile for prompt tests. */
function minProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['python', 'nursing']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'healthcare', years: 10 }]),
    insider_knowledge: stated('clinical documentation workflow'),
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
    additional_context_raw: 'I want to build MCP tools',
    schema_version: 1,
    profile_hash: 'abc',
  };
}

describe('SKILL_REMIX_RESPONSE_SCHEMA', () => {
  it('parses a valid response with 3 hunts', () => {
    const parsed = SKILL_REMIX_RESPONSE_SCHEMA.parse({
      hunts: [
        {
          skill_source: 'Python',
          problem: 'manual charting in nursing homes',
          example_search_phrases: ['automated clinical note'],
        },
        {
          skill_source: 'Python',
          problem: 'scheduling bugs in small clinics',
          example_search_phrases: ['shift scheduling optimization'],
        },
        {
          skill_source: 'nursing',
          problem: 'handoff errors at shift change',
          example_search_phrases: ['clinical handoff safety'],
        },
      ],
    });
    expect(parsed.hunts).toHaveLength(3);
  });

  it('rejects a response with fewer than 3 hunts', () => {
    expect(() => SKILL_REMIX_RESPONSE_SCHEMA.parse({ hunts: [] })).toThrow();
  });

  it('rejects a response missing the hunts wrapper', () => {
    expect(() => SKILL_REMIX_RESPONSE_SCHEMA.parse({})).toThrow();
  });
});

describe('buildSkillRemixSystemPrompt', () => {
  it('instructs the LLM to translate skills into problems via functional decomposition', () => {
    const p = buildSkillRemixSystemPrompt().toLowerCase();
    expect(p).toContain('problem');
    expect(p).toContain('capability');
    expect(p).toContain('functional decomposition');
  });

  it('includes the acronym-preservation rule', () => {
    const p = buildSkillRemixSystemPrompt();
    expect(p).toContain('ACRONYM');
    expect(p).toContain('MCP');
  });

  it('embeds a scenario marker when one is provided (for MSW routing)', () => {
    expect(buildSkillRemixSystemPrompt('remix-alice')).toContain(
      '[[SCENARIO:remix-alice]]',
    );
  });

  it('omits the scenario marker when none is provided', () => {
    expect(buildSkillRemixSystemPrompt()).not.toContain('[[SCENARIO:');
  });
});

describe('buildSkillRemixUserPrompt', () => {
  it('serializes the founder skills and domain into the prompt', () => {
    const u = buildSkillRemixUserPrompt(minProfile());
    expect(u).toContain('python');
    expect(u).toContain('nursing');
    expect(u).toContain('healthcare');
  });

  it('includes insider knowledge and additional_context_raw', () => {
    const u = buildSkillRemixUserPrompt(minProfile());
    expect(u).toContain('clinical documentation workflow');
    expect(u).toContain('MCP tools');
  });

  it('shows "(none)" when insider_knowledge is null', () => {
    const profile = minProfile();
    profile.insider_knowledge = { value: null, source: 'assumed' };
    const u = buildSkillRemixUserPrompt(profile);
    expect(u).toContain('Insider knowledge: (none)');
  });
});
