import { describe, it, expect } from 'vitest';
import {
  PROBLEM_HUNT_SCHEMA,
  PROBLEM_HUNTS_SCHEMA,
} from '../../../lib/types/problem-hunt';

describe('PROBLEM_HUNT_SCHEMA', () => {
  it('parses a valid hunt with skill_source, problem, example_search_phrases', () => {
    const parsed = PROBLEM_HUNT_SCHEMA.parse({
      skill_source: 'Python',
      problem: 'manual spreadsheet reconciliation in small accounting firms',
      example_search_phrases: ['spreadsheet reconciliation bugs', 'accountant automation'],
    });
    expect(parsed.problem).toContain('reconciliation');
    expect(parsed.example_search_phrases).toHaveLength(2);
  });

  it('rejects a hunt missing example_search_phrases', () => {
    expect(() =>
      PROBLEM_HUNT_SCHEMA.parse({ skill_source: 'Python', problem: 'something real' }),
    ).toThrow();
  });

  it('rejects an empty example_search_phrases array', () => {
    expect(() =>
      PROBLEM_HUNT_SCHEMA.parse({
        skill_source: 'Python',
        problem: 'something real',
        example_search_phrases: [],
      }),
    ).toThrow();
  });

  it('rejects a hunt with a too-short problem (<5 chars)', () => {
    expect(() =>
      PROBLEM_HUNT_SCHEMA.parse({
        skill_source: 'Python',
        problem: 'x',
        example_search_phrases: ['a'],
      }),
    ).toThrow();
  });

  it('rejects more than 6 example_search_phrases', () => {
    expect(() =>
      PROBLEM_HUNT_SCHEMA.parse({
        skill_source: 'Python',
        problem: 'manual charting',
        example_search_phrases: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      }),
    ).toThrow();
  });
});

describe('PROBLEM_HUNTS_SCHEMA (list)', () => {
  it('requires at least 3 hunts', () => {
    const two = Array.from({ length: 2 }, (_, i) => ({
      skill_source: 'Python',
      problem: `problem ${i} reality`,
      example_search_phrases: ['a'],
    }));
    expect(() => PROBLEM_HUNTS_SCHEMA.parse(two)).toThrow();
  });

  it('accepts exactly 3 hunts', () => {
    const three = Array.from({ length: 3 }, (_, i) => ({
      skill_source: 'Python',
      problem: `problem ${i} reality`,
      example_search_phrases: ['a'],
    }));
    expect(() => PROBLEM_HUNTS_SCHEMA.parse(three)).not.toThrow();
  });

  it('accepts exactly 10 hunts', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      skill_source: 'Python',
      problem: `problem ${i} reality`,
      example_search_phrases: ['a'],
    }));
    expect(() => PROBLEM_HUNTS_SCHEMA.parse(ten)).not.toThrow();
  });

  it('rejects more than 10 hunts', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      skill_source: 'Python',
      problem: `problem ${i} reality`,
      example_search_phrases: ['a'],
    }));
    expect(() => PROBLEM_HUNTS_SCHEMA.parse(eleven)).toThrow();
  });
});
