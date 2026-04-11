import { describe, it, expect } from 'vitest';
import {
  dedupeSignals,
  filterExcluded,
  sortByScore,
  keepTop,
} from '../../../../pipeline/scanners/tech-scout/post-process';
import type { Signal } from '../../../../lib/types/signal';

/** Build a minimum valid signal for test reuse. */
function buildSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    source: 'hn',
    title: 'Test signal',
    snippet: 'Test snippet',
    url: 'https://example.com/1',
    date: '2026-03-01T00:00:00Z',
    score: { novelty: 5, specificity: 5, recency: 5 },
    category: 'tech_capability',
    raw: { id: 1 },
    ...overrides,
  };
}

describe('dedupeSignals', () => {
  it('keeps the higher-scoring signal when URLs match', () => {
    const low = buildSignal({
      url: 'https://dup.com/x',
      score: { novelty: 3, specificity: 3, recency: 3 },
      raw: { which: 'low' },
    });
    const high = buildSignal({
      url: 'https://dup.com/x',
      score: { novelty: 9, specificity: 9, recency: 9 },
      raw: { which: 'high' },
    });
    const result = dedupeSignals([low, high]);
    expect(result).toHaveLength(1);
    expect(result[0]!.score.novelty).toBe(9);
  });

  it("preserves the winner's raw field", () => {
    const low = buildSignal({
      url: 'https://dup.com/y',
      score: { novelty: 3, specificity: 3, recency: 3 },
      raw: { which: 'low' },
    });
    const high = buildSignal({
      url: 'https://dup.com/y',
      score: { novelty: 9, specificity: 9, recency: 9 },
      raw: { which: 'high' },
    });
    const result = dedupeSignals([low, high]);
    expect(result[0]!.raw).toEqual({ which: 'high' });
  });

  it('returns all signals when URLs are distinct', () => {
    const a = buildSignal({ url: 'https://a.com' });
    const b = buildSignal({ url: 'https://b.com' });
    const c = buildSignal({ url: 'https://c.com' });
    expect(dedupeSignals([a, b, c])).toHaveLength(3);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupeSignals([])).toEqual([]);
  });
});

describe('filterExcluded', () => {
  it('drops signals whose title contains an excluded term (case insensitive)', () => {
    const kept = buildSignal({
      title: 'Fraud ML tooling',
      url: 'https://a.com',
    });
    const dropped = buildSignal({
      title: 'Crypto token ring',
      url: 'https://b.com',
    });
    const result = filterExcluded([kept, dropped], ['crypto']);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Fraud ML tooling');
  });

  it('drops signals whose snippet contains an excluded term', () => {
    const kept = buildSignal({
      title: 'A',
      snippet: 'Risk scoring for fintech',
      url: 'https://a.com',
    });
    const dropped = buildSignal({
      title: 'B',
      snippet: 'Adult content recommendation engine',
      url: 'https://b.com',
    });
    const result = filterExcluded([kept, dropped], ['adult content']);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('A');
  });

  it('returns input unchanged when exclude list is empty', () => {
    const a = buildSignal({ url: 'https://a.com' });
    const b = buildSignal({ url: 'https://b.com' });
    const result = filterExcluded([a, b], []);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(filterExcluded([], ['crypto'])).toEqual([]);
  });
});

describe('sortByScore', () => {
  it('sorts descending by composite novelty+specificity+recency', () => {
    const low = buildSignal({
      url: 'https://low.com',
      score: { novelty: 1, specificity: 1, recency: 1 },
    });
    const mid = buildSignal({
      url: 'https://mid.com',
      score: { novelty: 5, specificity: 5, recency: 5 },
    });
    const high = buildSignal({
      url: 'https://high.com',
      score: { novelty: 10, specificity: 10, recency: 10 },
    });
    const result = sortByScore([mid, low, high]);
    expect(result[0]!.url).toBe('https://high.com');
    expect(result[1]!.url).toBe('https://mid.com');
    expect(result[2]!.url).toBe('https://low.com');
  });

  it('returns empty array for empty input', () => {
    expect(sortByScore([])).toEqual([]);
  });
});

describe('keepTop', () => {
  it('caps the result at n signals after sorting', () => {
    const signals = Array.from({ length: 10 }, (_, i) =>
      buildSignal({
        url: `https://example.com/${i}`,
        score: { novelty: i + 1, specificity: 5, recency: 5 },
      }),
    );
    const result = keepTop(signals, 3);
    expect(result).toHaveLength(3);
    // Should be the 3 highest-scoring signals (novelty 10, 9, 8):
    expect(result[0]!.score.novelty).toBe(10);
    expect(result[1]!.score.novelty).toBe(9);
    expect(result[2]!.score.novelty).toBe(8);
  });

  it('returns an empty array when n is 0', () => {
    const signals = [buildSignal()];
    expect(keepTop(signals, 0)).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(keepTop([], 5)).toEqual([]);
  });
});
