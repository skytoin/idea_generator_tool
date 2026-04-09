import { describe, it, expect } from 'vitest';
import {
  applyAssumptions,
  ASSUMED_DEFAULTS,
  type ProfileBuilder,
} from '../../../pipeline/frame/apply-assumptions';
import { FOUNDER_PROFILE_SCHEMA } from '../../../lib/types/founder-profile';

function minimumBuilder(): ProfileBuilder {
  return {
    skills: { value: ['React apps'], source: 'stated' },
    time_per_week: { value: '10', source: 'stated' },
    money_available: { value: 'lt_500', source: 'stated' },
    ambition: { value: 'side_project', source: 'stated' },
  };
}

describe('applyAssumptions', () => {
  it('fills all optional fields with documented defaults when only required fields present', () => {
    const result = applyAssumptions(minimumBuilder(), 'raw ctx', 'hash-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const profile = result.value;

    // Required still stated
    expect(profile.skills.source).toBe('stated');
    expect(profile.time_per_week.source).toBe('stated');
    expect(profile.money_available.source).toBe('stated');
    expect(profile.ambition.source).toBe('stated');

    // All recommended + optional are assumed
    expect(profile.domain).toEqual({ value: [], source: 'assumed' });
    expect(profile.insider_knowledge).toEqual({ value: null, source: 'assumed' });
    expect(profile.anti_targets).toEqual({ value: [], source: 'assumed' });
    expect(profile.network).toEqual({ value: null, source: 'assumed' });
    expect(profile.audience).toEqual({ value: null, source: 'assumed' });
    expect(profile.proprietary_access).toEqual({ value: null, source: 'assumed' });
    expect(profile.rare_combinations).toEqual({ value: null, source: 'assumed' });
    expect(profile.recurring_frustration).toEqual({ value: null, source: 'assumed' });
    expect(profile.four_week_mvp).toEqual({ value: null, source: 'assumed' });
    expect(profile.previous_attempts).toEqual({ value: null, source: 'assumed' });
    expect(profile.customer_affinity).toEqual({ value: null, source: 'assumed' });
    expect(profile.time_to_revenue).toEqual({ value: 'no_preference', source: 'assumed' });
    expect(profile.customer_type_preference).toEqual({
      value: 'no_preference',
      source: 'assumed',
    });
    expect(profile.trigger).toEqual({ value: null, source: 'assumed' });
    expect(profile.legal_constraints).toEqual({ value: null, source: 'assumed' });

    // Metadata
    expect(profile.schema_version).toBe(1);
    expect(profile.profile_hash).toBe('hash-1');
    expect(profile.additional_context_raw).toBe('raw ctx');
  });

  it('preserves stated optional values untouched', () => {
    const builder = minimumBuilder();
    builder.anti_targets = { value: ['crypto'], source: 'stated' };
    const result = applyAssumptions(builder, '', 'h');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.anti_targets).toEqual({ value: ['crypto'], source: 'stated' });
  });

  it('preserves inferred values untouched', () => {
    const builder = minimumBuilder();
    builder.audience = { value: '2k newsletter', source: 'inferred' };
    const result = applyAssumptions(builder, '', 'h');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.audience).toEqual({ value: '2k newsletter', source: 'inferred' });
  });

  it('returns err when a required field is missing', () => {
    const builder = minimumBuilder();
    delete builder.skills;
    const result = applyAssumptions(builder, '', 'h');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('missing_required');
    expect(result.error.missingFields).toEqual(['skills']);
  });

  it('lists every missing required field in the error', () => {
    const builder: ProfileBuilder = {
      time_per_week: { value: '10', source: 'stated' },
      money_available: { value: 'lt_500', source: 'stated' },
    };
    const result = applyAssumptions(builder, '', 'h');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('missing_required');
    expect(result.error.missingFields.sort()).toEqual(['ambition', 'skills'].sort());
  });

  it('is deterministic for identical inputs', () => {
    const a = applyAssumptions(minimumBuilder(), 'ctx', 'h');
    const b = applyAssumptions(minimumBuilder(), 'ctx', 'h');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).toEqual(b.value);
  });

  it('documented defaults match ASSUMED_DEFAULTS map', () => {
    expect(ASSUMED_DEFAULTS.time_to_revenue.value).toBe('no_preference');
    expect(ASSUMED_DEFAULTS.customer_type_preference.value).toBe('no_preference');
    expect(ASSUMED_DEFAULTS.domain.value).toEqual([]);
    expect(ASSUMED_DEFAULTS.anti_targets.value).toEqual([]);
    expect(ASSUMED_DEFAULTS.insider_knowledge.value).toBeNull();
    expect(ASSUMED_DEFAULTS.network.value).toBeNull();
    expect(ASSUMED_DEFAULTS.audience.value).toBeNull();
    expect(ASSUMED_DEFAULTS.proprietary_access.value).toBeNull();
    expect(ASSUMED_DEFAULTS.rare_combinations.value).toBeNull();
    expect(ASSUMED_DEFAULTS.recurring_frustration.value).toBeNull();
    expect(ASSUMED_DEFAULTS.four_week_mvp.value).toBeNull();
    expect(ASSUMED_DEFAULTS.previous_attempts.value).toBeNull();
    expect(ASSUMED_DEFAULTS.customer_affinity.value).toBeNull();
    expect(ASSUMED_DEFAULTS.trigger.value).toBeNull();
    expect(ASSUMED_DEFAULTS.legal_constraints.value).toBeNull();
    // All sources are 'assumed'
    for (const entry of Object.values(ASSUMED_DEFAULTS)) {
      expect(entry.source).toBe('assumed');
    }
  });

  it('persists rawContext as additional_context_raw', () => {
    const result = applyAssumptions(minimumBuilder(), 'hello world', 'h');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.additional_context_raw).toBe('hello world');
  });

  it('copies profile_hash through to the result', () => {
    const result = applyAssumptions(minimumBuilder(), '', 'my-hash-xyz');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.profile_hash).toBe('my-hash-xyz');
  });

  it('returned profile round-trips through FOUNDER_PROFILE_SCHEMA.parse()', () => {
    const result = applyAssumptions(minimumBuilder(), 'ctx', 'h');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => FOUNDER_PROFILE_SCHEMA.parse(result.value)).not.toThrow();
    const parsed = FOUNDER_PROFILE_SCHEMA.parse(result.value);
    expect(parsed).toEqual(result.value);
  });

  it('preserves inferred domain with entries', () => {
    const builder = minimumBuilder();
    builder.domain = {
      value: [{ area: 'fintech', years: 5 }],
      source: 'inferred',
    };
    const result = applyAssumptions(builder, '', 'h');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.source).toBe('inferred');
    expect(result.value.domain.value).toEqual([{ area: 'fintech', years: 5 }]);
  });
});
