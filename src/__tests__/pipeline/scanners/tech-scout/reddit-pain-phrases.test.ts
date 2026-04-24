import { describe, it, expect } from 'vitest';
import {
  REDDIT_PAIN_PHRASES,
  REDDIT_PAIN_PHRASE_VARIANTS,
  selectPainPhrases,
  expandPainPhrase,
} from '../../../../pipeline/scanners/tech-scout/reddit-pain-phrases';

describe('REDDIT_PAIN_PHRASES constant', () => {
  it('exposes exactly 8 phrases', () => {
    // Lock in the documented pool size. If this grows to 9+ or shrinks,
    // revisit the adapter's PAIN_QUERY_COUNT budget too.
    expect(REDDIT_PAIN_PHRASES).toHaveLength(8);
  });

  it('every phrase is a non-empty trimmed string', () => {
    for (const p of REDDIT_PAIN_PHRASES) {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
      expect(p.trim()).toBe(p);
    }
  });

  it('contains no duplicates (case-insensitive)', () => {
    const lower = REDDIT_PAIN_PHRASES.map((p) => p.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('every phrase is multi-word so Reddit treats it as a phrase query', () => {
    // Single-word phrases would become unsuffixed token queries which
    // defeat the "I would pay" exact-phrase signal. Enforce multi-word
    // per phrase so the pool always carries phrase-search semantics.
    for (const p of REDDIT_PAIN_PHRASES) {
      expect(p.split(/\s+/).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('contains no quote characters that would break URL quoting', () => {
    // The adapter wraps each phrase in outer double quotes before
    // sending to Reddit. If the phrase itself contained a `"`, the
    // outer quoting would produce a malformed query.
    for (const p of REDDIT_PAIN_PHRASES) {
      expect(p).not.toContain('"');
      expect(p).not.toContain("'");
    }
  });
});

describe('selectPainPhrases — clamping', () => {
  it('returns an empty array when count is 0', () => {
    expect(selectPainPhrases(0)).toEqual([]);
  });

  it('returns an empty array when count is negative', () => {
    expect(selectPainPhrases(-1)).toEqual([]);
    expect(selectPainPhrases(-100)).toEqual([]);
  });

  it('caps the result at REDDIT_PAIN_PHRASES.length when count is larger', () => {
    const out = selectPainPhrases(999);
    expect(out).toHaveLength(REDDIT_PAIN_PHRASES.length);
  });

  it('returns exactly `count` items for any 0 < count <= pool size', () => {
    for (let n = 1; n <= REDDIT_PAIN_PHRASES.length; n++) {
      expect(selectPainPhrases(n)).toHaveLength(n);
    }
  });
});

describe('selectPainPhrases — unseeded deterministic prefix', () => {
  it('returns the first `count` phrases verbatim when no seed is supplied', () => {
    expect(selectPainPhrases(3)).toEqual(REDDIT_PAIN_PHRASES.slice(0, 3));
  });

  it('is called again and returns identical output (deterministic)', () => {
    const a = selectPainPhrases(4);
    const b = selectPainPhrases(4);
    expect(a).toEqual(b);
  });

  it('treats an empty-string seed as "no seed" (same prefix behavior)', () => {
    expect(selectPainPhrases(3, '')).toEqual(selectPainPhrases(3));
  });

  it('returns a fresh array — mutating it does not change the constant', () => {
    const out = selectPainPhrases(REDDIT_PAIN_PHRASES.length);
    out[0] = 'MUTATED';
    expect(REDDIT_PAIN_PHRASES[0]).not.toBe('MUTATED');
  });
});

describe('selectPainPhrases — seeded rotation', () => {
  it('produces identical output for the same seed (fully deterministic)', () => {
    expect(selectPainPhrases(3, 'profile-hash-abc')).toEqual(
      selectPainPhrases(3, 'profile-hash-abc'),
    );
  });

  it('produces a subset of REDDIT_PAIN_PHRASES for any seed', () => {
    const pool = new Set(REDDIT_PAIN_PHRASES);
    for (const seed of ['a', 'abc', 'profile-123', 'different-seed']) {
      for (const phrase of selectPainPhrases(3, seed)) {
        expect(pool.has(phrase)).toBe(true);
      }
    }
  });

  it('returns `count` unique phrases (no dupes inside one rotation)', () => {
    // 8 phrase pool, 8 count: every rotation must emit every phrase once.
    for (const seed of ['a', 'b', 'c', 'd', 'profile-hash-xyz']) {
      const out = selectPainPhrases(REDDIT_PAIN_PHRASES.length, seed);
      expect(new Set(out).size).toBe(out.length);
    }
  });

  it('produces different starting phrase for at least one seed pair', () => {
    // Weak uniqueness check: at least one of these seed pairs should
    // yield a different rotation start. If this ever breaks we likely
    // broke the hash — NOT an invariance guarantee, but a sanity net.
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const firsts = new Set(seeds.map((s) => selectPainPhrases(1, s)[0]));
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('handles seeds with unicode and special characters without crashing', () => {
    const out = selectPainPhrases(3, 'プロフィール 👋 !@#$%^&*()');
    expect(out).toHaveLength(3);
    for (const p of out) expect(REDDIT_PAIN_PHRASES).toContain(p);
  });

  it('rotates without skipping — count=1 picks one phrase at the rotation offset', () => {
    // For any seed, count=1 must return exactly one phrase from the pool.
    for (const seed of ['seed-1', 'seed-2', 'seed-3']) {
      const out = selectPainPhrases(1, seed);
      expect(out).toHaveLength(1);
      expect(REDDIT_PAIN_PHRASES).toContain(out[0]!);
    }
  });

  it('count=pool size with any seed returns a permutation of the full pool', () => {
    for (const seed of ['x', 'y', 'z', 'seed-123']) {
      const out = selectPainPhrases(REDDIT_PAIN_PHRASES.length, seed);
      expect([...out].sort()).toEqual([...REDDIT_PAIN_PHRASES].sort());
    }
  });
});

describe('REDDIT_PAIN_PHRASE_VARIANTS', () => {
  it('has an entry for every base pain phrase', () => {
    for (const base of REDDIT_PAIN_PHRASES) {
      expect(REDDIT_PAIN_PHRASE_VARIANTS[base]).toBeDefined();
    }
  });

  it('every variant list includes the base phrase itself as first entry', () => {
    for (const base of REDDIT_PAIN_PHRASES) {
      const variants = REDDIT_PAIN_PHRASE_VARIANTS[base]!;
      expect(variants[0]).toBe(base);
    }
  });

  it('no variant list exceeds 4 phrases (URL length safety)', () => {
    for (const base of REDDIT_PAIN_PHRASES) {
      expect(REDDIT_PAIN_PHRASE_VARIANTS[base]!.length).toBeLessThanOrEqual(4);
    }
  });

  it('no variant contains a quote character (would break URL quoting)', () => {
    for (const base of REDDIT_PAIN_PHRASES) {
      for (const v of REDDIT_PAIN_PHRASE_VARIANTS[base]!) {
        expect(v).not.toContain('"');
      }
    }
  });

  it('every variant is non-empty and multi-word (phrase semantics preserved)', () => {
    for (const base of REDDIT_PAIN_PHRASES) {
      for (const v of REDDIT_PAIN_PHRASE_VARIANTS[base]!) {
        expect(v.length).toBeGreaterThan(0);
        expect(v.split(/\s+/).length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('expandPainPhrase', () => {
  it('returns the registered variants for a known base phrase', () => {
    const out = expandPainPhrase('I would pay');
    expect(out).toContain('I would pay');
    expect(out).toContain('would pay for');
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it('returns [base] as a single-element list for an unregistered phrase', () => {
    const out = expandPainPhrase('unregistered custom phrase');
    expect(out).toEqual(['unregistered custom phrase']);
  });

  it('returns a non-empty array for every base in REDDIT_PAIN_PHRASES', () => {
    for (const base of REDDIT_PAIN_PHRASES) {
      expect(expandPainPhrase(base).length).toBeGreaterThan(0);
    }
  });

  it('is deterministic — same input yields the same output array each call', () => {
    expect(expandPainPhrase('wish there was')).toEqual(expandPainPhrase('wish there was'));
  });
});
