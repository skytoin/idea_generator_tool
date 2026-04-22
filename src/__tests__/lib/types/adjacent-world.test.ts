import { describe, it, expect } from 'vitest';
import {
  ADJACENT_WORLD_SCHEMA,
  ADJACENT_WORLDS_SCHEMA,
} from '../../../lib/types/adjacent-world';

describe('ADJACENT_WORLD_SCHEMA', () => {
  it('parses a valid world with shared_traits and example phrases', () => {
    const parsed = ADJACENT_WORLD_SCHEMA.parse({
      source_domain: 'nursing',
      adjacent_domain: 'aviation',
      shared_traits: ['safety-critical checklists', 'fatigue management'],
      example_search_phrases: ['aviation checklist digitization'],
    });
    expect(parsed.shared_traits).toHaveLength(2);
    expect(parsed.example_search_phrases).toHaveLength(1);
  });

  it('rejects a world with zero shared_traits (the drift guard)', () => {
    expect(() =>
      ADJACENT_WORLD_SCHEMA.parse({
        source_domain: 'nursing',
        adjacent_domain: 'aviation',
        shared_traits: [],
        example_search_phrases: ['x'],
      }),
    ).toThrow();
  });

  it('rejects more than 5 shared_traits', () => {
    expect(() =>
      ADJACENT_WORLD_SCHEMA.parse({
        source_domain: 'a',
        adjacent_domain: 'b',
        shared_traits: ['t1', 't2', 't3', 't4', 't5', 't6'],
        example_search_phrases: ['x'],
      }),
    ).toThrow();
  });

  it('rejects missing example_search_phrases', () => {
    expect(() =>
      ADJACENT_WORLD_SCHEMA.parse({
        source_domain: 'a',
        adjacent_domain: 'b',
        shared_traits: ['shared'],
      }),
    ).toThrow();
  });

  it('rejects an empty source or adjacent domain name', () => {
    expect(() =>
      ADJACENT_WORLD_SCHEMA.parse({
        source_domain: '',
        adjacent_domain: 'aviation',
        shared_traits: ['x'],
        example_search_phrases: ['y'],
      }),
    ).toThrow();
  });
});

describe('ADJACENT_WORLDS_SCHEMA (list)', () => {
  it('requires at least 2 worlds', () => {
    const one = [
      {
        source_domain: 'nursing',
        adjacent_domain: 'aviation',
        shared_traits: ['checklists'],
        example_search_phrases: ['x'],
      },
    ];
    expect(() => ADJACENT_WORLDS_SCHEMA.parse(one)).toThrow();
  });

  it('accepts exactly 2 worlds', () => {
    const two = Array.from({ length: 2 }, (_, i) => ({
      source_domain: 'nursing',
      adjacent_domain: `world${i}`,
      shared_traits: ['trait'],
      example_search_phrases: ['x'],
    }));
    expect(() => ADJACENT_WORLDS_SCHEMA.parse(two)).not.toThrow();
  });

  it('accepts exactly 6 worlds', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      source_domain: 'nursing',
      adjacent_domain: `world${i}`,
      shared_traits: ['trait'],
      example_search_phrases: ['x'],
    }));
    expect(() => ADJACENT_WORLDS_SCHEMA.parse(six)).not.toThrow();
  });

  it('rejects more than 6 worlds', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      source_domain: 'nursing',
      adjacent_domain: `world${i}`,
      shared_traits: ['trait'],
      example_search_phrases: ['x'],
    }));
    expect(() => ADJACENT_WORLDS_SCHEMA.parse(seven)).toThrow();
  });
});
