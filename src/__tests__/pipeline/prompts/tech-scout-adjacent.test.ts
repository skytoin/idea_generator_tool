import { describe, it, expect } from 'vitest';
import {
  ADJACENT_WORLDS_RESPONSE_SCHEMA,
  buildAdjacentWorldsSystemPrompt,
  buildAdjacentWorldsUserPrompt,
} from '../../../pipeline/prompts/tech-scout-adjacent';
import type { FounderProfile } from '../../../lib/types/founder-profile';

function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['python', 'nursing']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'healthcare', years: 10 }]),
    insider_knowledge: stated('clinical workflow'),
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
    profile_hash: 'adj-test',
  };
}

describe('ADJACENT_WORLDS_RESPONSE_SCHEMA', () => {
  it('parses a valid response with 2 worlds', () => {
    const parsed = ADJACENT_WORLDS_RESPONSE_SCHEMA.parse({
      worlds: [
        {
          source_domain: 'nursing',
          adjacent_domain: 'aviation',
          shared_traits: ['safety-critical checklists'],
          example_search_phrases: ['aviation checklist digitization'],
        },
        {
          source_domain: 'nursing',
          adjacent_domain: 'hospitality',
          shared_traits: ['shift handoffs'],
          example_search_phrases: ['hotel shift handover app'],
        },
      ],
    });
    expect(parsed.worlds).toHaveLength(2);
  });

  it('rejects a response with fewer than 2 worlds', () => {
    expect(() => ADJACENT_WORLDS_RESPONSE_SCHEMA.parse({ worlds: [] })).toThrow();
  });

  it('rejects a response missing the worlds wrapper', () => {
    expect(() => ADJACENT_WORLDS_RESPONSE_SCHEMA.parse({})).toThrow();
  });
});

describe('buildAdjacentWorldsSystemPrompt', () => {
  it('explicitly requires the structural-trait guard', () => {
    const p = buildAdjacentWorldsSystemPrompt();
    expect(p).toContain('shared_traits');
    expect(p.toLowerCase()).toContain('structural');
  });

  it('includes both good and bad examples so the LLM can calibrate', () => {
    const p = buildAdjacentWorldsSystemPrompt();
    expect(p.toLowerCase()).toContain('good');
    expect(p.toLowerCase()).toContain('bad');
  });

  it('embeds a scenario marker when provided', () => {
    expect(buildAdjacentWorldsSystemPrompt('adj-alice')).toContain(
      '[[SCENARIO:adj-alice]]',
    );
  });

  it('omits the scenario marker when none is provided', () => {
    expect(buildAdjacentWorldsSystemPrompt()).not.toContain('[[SCENARIO:');
  });
});

describe('buildAdjacentWorldsUserPrompt', () => {
  it('serializes skills, domain, and insider knowledge into the prompt', () => {
    const u = buildAdjacentWorldsUserPrompt(buildProfile());
    expect(u).toContain('python');
    expect(u).toContain('healthcare');
    expect(u).toContain('clinical workflow');
  });

  it('reminds the LLM to drop worlds without concrete shared_traits', () => {
    const u = buildAdjacentWorldsUserPrompt(buildProfile());
    expect(u.toLowerCase()).toContain('shared_traits');
  });
});
