import { describe, it, expect } from 'vitest';
import {
  QUESTIONS,
  getQuestionById,
  REQUIRED_QUESTION_IDS,
} from '../../../pipeline/frame/questions';
import { FOUNDER_PROFILE_SCHEMA } from '../../../lib/types/founder-profile';

const META_KEYS = new Set(['additional_context_raw', 'schema_version', 'profile_hash']);
const VALID_PROFILE_FIELDS = new Set(
  Object.keys(FOUNDER_PROFILE_SCHEMA.shape).filter((k) => !META_KEYS.has(k)),
);
const SPECIAL_TARGETS = new Set(['mode', 'existing_idea', 'additional_context']);

describe('QUESTIONS registry', () => {
  it('contains exactly 22 entries', () => {
    expect(QUESTIONS.length).toBe(22);
  });

  it('has exactly 6 required questions: M1, M1b, Q1-Q4', () => {
    expect([...REQUIRED_QUESTION_IDS].sort()).toEqual(
      ['M1', 'M1b', 'Q1', 'Q2', 'Q3', 'Q4'].sort(),
    );
  });

  it('every question has a non-empty hint (length > 10)', () => {
    for (const q of QUESTIONS) {
      expect(q.hint.length, `${q.id} hint too short`).toBeGreaterThan(10);
    }
  });

  it('every select/radio question has options with >= 2 entries and non-empty labels', () => {
    for (const q of QUESTIONS) {
      if (q.inputType === 'select' || q.inputType === 'radio') {
        expect(q.options, `${q.id} missing options`).toBeDefined();
        expect((q.options ?? []).length).toBeGreaterThanOrEqual(2);
        for (const opt of q.options ?? []) {
          expect(opt.label.length, `${q.id} empty label`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every profileField is a valid FounderProfileField or special target', () => {
    for (const q of QUESTIONS) {
      const pf = q.profileField;
      const ok = VALID_PROFILE_FIELDS.has(pf) || SPECIAL_TARGETS.has(pf);
      expect(ok, `${q.id} has invalid profileField: ${pf}`).toBe(true);
    }
  });

  it('getQuestionById returns Q1 skills and undefined for NOPE', () => {
    const q1 = getQuestionById('Q1');
    expect(q1).toBeDefined();
    expect(q1?.profileField).toBe('skills');
    expect(getQuestionById('NOPE')).toBeUndefined();
  });

  it('M1b has a conditional showing it only when M1 is refine or open_direction', () => {
    const m1b = getQuestionById('M1b');
    expect(m1b?.conditional).toBeDefined();
    expect(m1b?.conditional?.showIfFieldId).toBe('M1');
    const eq = m1b?.conditional?.equals;
    const arr = Array.isArray(eq) ? eq : [eq];
    expect(arr).toContain('refine');
    expect(arr).toContain('open_direction');
  });

  it('all question ids are unique', () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Q7's examples contain both 'crypto' and 'gambling'", () => {
    const q7 = getQuestionById('Q7');
    expect(q7?.examples).toBeDefined();
    expect(q7?.examples).toContain('crypto');
    expect(q7?.examples).toContain('gambling');
  });
});
