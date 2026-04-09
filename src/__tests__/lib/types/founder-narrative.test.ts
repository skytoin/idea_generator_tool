import { describe, it, expect } from 'vitest';
import { FOUNDER_NARRATIVE_SCHEMA } from '../../../lib/types/founder-narrative';

const valid = {
  prose: 'A'.repeat(60),
  word_count: 12,
  generated_at: '2026-04-08T12:00:00.000Z',
};

describe('FOUNDER_NARRATIVE_SCHEMA', () => {
  it('accepts a valid narrative', () => {
    expect(FOUNDER_NARRATIVE_SCHEMA.safeParse(valid).success).toBe(true);
  });

  it('rejects prose shorter than 50 chars', () => {
    expect(FOUNDER_NARRATIVE_SCHEMA.safeParse({ ...valid, prose: 'short' }).success).toBe(false);
  });

  it('rejects prose longer than 2000 chars', () => {
    expect(
      FOUNDER_NARRATIVE_SCHEMA.safeParse({ ...valid, prose: 'a'.repeat(2001) }).success,
    ).toBe(false);
  });

  it('rejects negative word_count', () => {
    expect(FOUNDER_NARRATIVE_SCHEMA.safeParse({ ...valid, word_count: -1 }).success).toBe(false);
  });

  it('rejects non-ISO generated_at', () => {
    expect(
      FOUNDER_NARRATIVE_SCHEMA.safeParse({ ...valid, generated_at: 'not-a-date' }).success,
    ).toBe(false);
  });
});
