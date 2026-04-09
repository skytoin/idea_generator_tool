import { describe, it, expect } from 'vitest';
import { FRAME_INPUT_SCHEMA } from '../../../lib/types/frame-input';
import alice from './fixtures/alice-minimum.json';
import bob from './fixtures/bob-medium.json';
import carol from './fixtures/carol-full.json';
import dave from './fixtures/dave-nonenglish.json';
import eve from './fixtures/eve-adversarial.json';

describe('Frame layer fixtures', () => {
  const cases: [string, unknown][] = [
    ['alice-minimum', alice],
    ['bob-medium', bob],
    ['carol-full', carol],
    ['dave-nonenglish', dave],
    ['eve-adversarial', eve],
  ];

  for (const [name, data] of cases) {
    it(`${name} parses cleanly through FRAME_INPUT_SCHEMA`, () => {
      const result = FRAME_INPUT_SCHEMA.safeParse(data);
      if (!result.success) {
        console.error(`${name} parse errors:`, result.error.flatten());
      }
      expect(result.success).toBe(true);
    });
  }
});
