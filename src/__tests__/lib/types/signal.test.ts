import { describe, it, expect } from 'vitest';
import { SIGNAL_SCHEMA, SIGNAL_CATEGORY } from '../../../lib/types/signal';

function buildValidSignal() {
  return {
    source: 'hn_algolia',
    title: 'X',
    url: 'https://example.com',
    date: '2026-04-01T00:00:00.000Z',
    snippet: '...',
    score: { novelty: 5, specificity: 5, recency: 5 },
    category: 'tech_capability' as const,
    raw: {},
  };
}

describe('SIGNAL_SCHEMA', () => {
  it('parses a valid signal', () => {
    const result = SIGNAL_SCHEMA.safeParse(buildValidSignal());
    expect(result.success).toBe(true);
  });

  it('rejects score with novelty: 0 (below min)', () => {
    const s = buildValidSignal();
    s.score.novelty = 0;
    expect(SIGNAL_SCHEMA.safeParse(s).success).toBe(false);
  });

  it('rejects score with novelty: 11 (above max)', () => {
    const s = buildValidSignal();
    s.score.novelty = 11;
    expect(SIGNAL_SCHEMA.safeParse(s).success).toBe(false);
  });

  it('accepts date: null', () => {
    const s = { ...buildValidSignal(), date: null };
    expect(SIGNAL_SCHEMA.safeParse(s).success).toBe(true);
  });

  it('rejects invalid URL', () => {
    const s = { ...buildValidSignal(), url: 'not-a-url' };
    expect(SIGNAL_SCHEMA.safeParse(s).success).toBe(false);
  });

  it('rejects unknown category', () => {
    const s = { ...buildValidSignal(), category: 'wtf' };
    expect(SIGNAL_SCHEMA.safeParse(s).success).toBe(false);
  });

  it('accepts empty snippet', () => {
    const s = { ...buildValidSignal(), snippet: '' };
    expect(SIGNAL_SCHEMA.safeParse(s).success).toBe(true);
  });

  it('raw accepts {}, [], string, number, null (all unknown)', () => {
    for (const raw of [{}, [], 'string', 42, null]) {
      const s = { ...buildValidSignal(), raw };
      expect(SIGNAL_SCHEMA.safeParse(s).success).toBe(true);
    }
  });

  it('SIGNAL_CATEGORY.options equals the expected list in order', () => {
    expect(SIGNAL_CATEGORY.options).toEqual([
      'tech_capability',
      'product_launch',
      'research',
      'adoption',
      'standards',
      'infrastructure',
    ]);
  });
});
