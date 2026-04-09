import { describe, it, expect } from 'vitest';
import {
  FOUNDER_PROFILE_SCHEMA,
  CONFIDENCE,
  type FounderProfile,
} from '../../../lib/types/founder-profile';

/** Build a minimum valid founder profile for reuse across tests. */
function buildValidProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['React']),
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
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'abc',
  };
}

describe('FOUNDER_PROFILE_SCHEMA', () => {
  it('parses a minimum valid profile with all 19 fields', () => {
    const result = FOUNDER_PROFILE_SCHEMA.safeParse(buildValidProfile());
    expect(result.success).toBe(true);
  });

  it('rejects a profile missing skills', () => {
    const p = buildValidProfile() as Partial<FounderProfile>;
    delete p.skills;
    const result = FOUNDER_PROFILE_SCHEMA.safeParse(p);
    expect(result.success).toBe(false);
  });

  it("rejects time_per_week: '7' (invalid enum value)", () => {
    const p = buildValidProfile();
    const bad = { ...p, time_per_week: { value: '7', source: 'stated' as const } };
    const result = FOUNDER_PROFILE_SCHEMA.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts every optional field with { value: null, source: assumed }', () => {
    const p = buildValidProfile();
    const assumed = { value: null, source: 'assumed' as const };
    const withNulls = {
      ...p,
      insider_knowledge: assumed,
      network: assumed,
      audience: assumed,
      proprietary_access: assumed,
      rare_combinations: assumed,
      recurring_frustration: assumed,
      four_week_mvp: assumed,
      previous_attempts: assumed,
      customer_affinity: assumed,
      trigger: assumed,
      legal_constraints: assumed,
    };
    const result = FOUNDER_PROFILE_SCHEMA.safeParse(withNulls);
    expect(result.success).toBe(true);
  });

  it('rejects schema_version: 2', () => {
    const p = { ...buildValidProfile(), schema_version: 2 };
    const result = FOUNDER_PROFILE_SCHEMA.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects additional_context_raw longer than 5000 chars', () => {
    const p = { ...buildValidProfile(), additional_context_raw: 'a'.repeat(5001) };
    const result = FOUNDER_PROFILE_SCHEMA.safeParse(p);
    expect(result.success).toBe(false);
  });

  it('rejects skills.value as an empty array', () => {
    const p = buildValidProfile();
    const bad = { ...p, skills: { value: [], source: 'stated' as const } };
    const result = FOUNDER_PROFILE_SCHEMA.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('exports CONFIDENCE enum with exactly [stated, inferred, assumed]', () => {
    expect(CONFIDENCE.options).toEqual(['stated', 'inferred', 'assumed']);
  });
});
