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

describe('dedupeSignals — adversarial inputs', () => {
  it('collapses 5 signals with identical URL to exactly 1 (highest-scoring)', () => {
    const sharedUrl = 'https://dup.example/x';
    const signals = [
      buildSignal({
        url: sharedUrl,
        score: { novelty: 1, specificity: 1, recency: 1 },
        raw: { which: 'a' },
      }),
      buildSignal({
        url: sharedUrl,
        score: { novelty: 4, specificity: 4, recency: 4 },
        raw: { which: 'b' },
      }),
      buildSignal({
        url: sharedUrl,
        score: { novelty: 10, specificity: 10, recency: 10 },
        raw: { which: 'winner' },
      }),
      buildSignal({
        url: sharedUrl,
        score: { novelty: 3, specificity: 3, recency: 3 },
        raw: { which: 'd' },
      }),
      buildSignal({
        url: sharedUrl,
        score: { novelty: 7, specificity: 7, recency: 7 },
        raw: { which: 'e' },
      }),
    ];
    const result = dedupeSignals(signals);
    expect(result).toHaveLength(1);
    expect(result[0]!.raw).toEqual({ which: 'winner' });
  });
});

describe('filterExcluded — adversarial inputs', () => {
  it('matches an excluded term in mixed-case input', () => {
    const kept = buildSignal({ title: 'Plain ML', url: 'https://a.com' });
    const mixed = buildSignal({ title: 'Crypto rocket', url: 'https://b.com' });
    const upper = buildSignal({ title: 'CRYPTO moonshot', url: 'https://c.com' });
    const wacky = buildSignal({ title: 'CrYpToPunks', url: 'https://d.com' });
    const result = filterExcluded([kept, mixed, upper, wacky], ['crypto']);
    expect(result.map((s) => s.title)).toEqual(['Plain ML']);
  });

  it('matches an excluded term written in uppercase', () => {
    const kept = buildSignal({ title: 'Plain ML', url: 'https://a.com' });
    const dropped = buildSignal({ title: 'crypto token', url: 'https://b.com' });
    // Exclude written in uppercase — must still strip lowercase input.
    const result = filterExcluded([kept, dropped], ['CRYPTO']);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Plain ML');
  });

  it('does not crash on zero-length signals array with empty exclude list', () => {
    expect(filterExcluded([], [])).toEqual([]);
  });

  it('returns input reference unchanged on empty exclude list', () => {
    const signals = [buildSignal()];
    // Current fast-path behavior returns the same reference.
    expect(filterExcluded(signals, [])).toBe(signals);
  });
});

describe('keepTop — adversarial inputs', () => {
  it('returns all signals when n exceeds input length', () => {
    const signals = [
      buildSignal({ url: 'https://a.com' }),
      buildSignal({ url: 'https://b.com' }),
      buildSignal({ url: 'https://c.com' }),
    ];
    const result = keepTop(signals, 100);
    expect(result).toHaveLength(3);
  });

  it('returns empty when n is 0 even with many signals', () => {
    const signals = Array.from({ length: 5 }, (_, i) =>
      buildSignal({ url: `https://x.com/${i}` }),
    );
    expect(keepTop(signals, 0)).toEqual([]);
  });
});

describe('sortByScore — stability', () => {
  it('preserves input order for signals with identical composite scores', () => {
    // All signals share the same composite score (15). A stable sort
    // must return them in their original input order.
    const a = buildSignal({
      url: 'https://a.com',
      title: 'A',
      score: { novelty: 5, specificity: 5, recency: 5 },
    });
    const b = buildSignal({
      url: 'https://b.com',
      title: 'B',
      score: { novelty: 5, specificity: 5, recency: 5 },
    });
    const c = buildSignal({
      url: 'https://c.com',
      title: 'C',
      score: { novelty: 5, specificity: 5, recency: 5 },
    });
    const d = buildSignal({
      url: 'https://d.com',
      title: 'D',
      score: { novelty: 5, specificity: 5, recency: 5 },
    });
    const result = sortByScore([a, b, c, d]);
    expect(result.map((s) => s.title)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('places higher-scoring signals first but keeps ties stable', () => {
    const tieA = buildSignal({
      url: 'https://tieA.com',
      title: 'tieA',
      score: { novelty: 5, specificity: 5, recency: 5 },
    });
    const tieB = buildSignal({
      url: 'https://tieB.com',
      title: 'tieB',
      score: { novelty: 5, specificity: 5, recency: 5 },
    });
    const high = buildSignal({
      url: 'https://high.com',
      title: 'high',
      score: { novelty: 10, specificity: 10, recency: 10 },
    });
    const result = sortByScore([tieA, high, tieB]);
    expect(result.map((s) => s.title)).toEqual(['high', 'tieA', 'tieB']);
  });
});
