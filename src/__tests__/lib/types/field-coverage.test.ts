import { describe, it, expect } from 'vitest';
import { FIELD_COVERAGE, CONSUMERS } from '../../../lib/types/field-coverage';
import { FOUNDER_PROFILE_SCHEMA } from '../../../lib/types/founder-profile';

const META_KEYS = new Set(['additional_context_raw', 'schema_version', 'profile_hash']);

describe('FIELD_COVERAGE', () => {
  it('covers every FounderProfile field (except meta fields) with at least one consumer', () => {
    const schemaKeys = Object.keys(FOUNDER_PROFILE_SCHEMA.shape).filter(
      (k) => !META_KEYS.has(k),
    );
    for (const key of schemaKeys) {
      const entry = (FIELD_COVERAGE as Record<string, { consumers: string[] } | undefined>)[key];
      expect(entry, `missing coverage entry for ${key}`).toBeDefined();
      expect(entry?.consumers.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('has no stale entries — every coverage key is an actual schema field', () => {
    const schemaKeys = new Set(Object.keys(FOUNDER_PROFILE_SCHEMA.shape));
    for (const key of Object.keys(FIELD_COVERAGE)) {
      expect(schemaKeys.has(key), `stale coverage entry: ${key}`).toBe(true);
    }
  });

  it('every entry has at least one consumer', () => {
    for (const [key, entry] of Object.entries(FIELD_COVERAGE)) {
      expect(entry.consumers.length, `${key} has zero consumers`).toBeGreaterThan(0);
    }
  });

  it('every consumer value is in CONSUMERS', () => {
    const allowed = new Set<string>(CONSUMERS);
    for (const [key, entry] of Object.entries(FIELD_COVERAGE)) {
      for (const c of entry.consumers) {
        expect(allowed.has(c), `${key} has invalid consumer ${c}`).toBe(true);
      }
    }
  });

  it('narrative is in every entry', () => {
    for (const [key, entry] of Object.entries(FIELD_COVERAGE)) {
      expect(entry.consumers.includes('narrative'), `${key} missing narrative`).toBe(true);
    }
  });

  it('required_in_prompt fields are exactly the expected 7', () => {
    const required = Object.entries(FIELD_COVERAGE)
      .filter(([, e]) => e.required_in_prompt)
      .map(([k]) => k);
    expect(required.sort()).toEqual(
      [
        'skills',
        'time_per_week',
        'money_available',
        'ambition',
        'domain',
        'insider_knowledge',
        'anti_targets',
      ].sort(),
    );
  });
});
