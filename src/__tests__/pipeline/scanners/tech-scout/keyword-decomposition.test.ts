import { describe, it, expect } from 'vitest';
import {
  SEARCH_STOPWORDS,
  DEFAULT_MAX_CONTENT_TOKENS,
  decomposeKeywordToTokens,
  decomposeKeywordToString,
} from '../../../../pipeline/scanners/tech-scout/keyword-decomposition';

/**
 * Profile-agnostic decomposition tests. The rule must produce the
 * same 2-content-token shape for any founder's keywords — tech,
 * healthcare, legal, retail, education — because it reads only the
 * keyword string and nothing about profile, domain, or audience.
 */

describe('SEARCH_STOPWORDS', () => {
  it('contains common English function words', () => {
    for (const w of ['a', 'the', 'for', 'with', 'of', 'in', 'to', 'and']) {
      expect(SEARCH_STOPWORDS.has(w)).toBe(true);
    }
  });

  it('deliberately stays small to avoid eating real content', () => {
    expect(SEARCH_STOPWORDS.size).toBeLessThan(40);
  });
});

describe('decomposeKeywordToTokens — defaults', () => {
  it('DEFAULT_MAX_CONTENT_TOKENS is 2', () => {
    expect(DEFAULT_MAX_CONTENT_TOKENS).toBe(2);
  });

  it('passes a 1-token keyword through unchanged', () => {
    expect(decomposeKeywordToTokens('MCP')).toEqual(['MCP']);
  });

  it('passes a 2-token keyword through unchanged', () => {
    expect(decomposeKeywordToTokens('fraud detection')).toEqual([
      'fraud',
      'detection',
    ]);
  });

  it('truncates a 4-token tech keyword to the first 2 content tokens', () => {
    expect(decomposeKeywordToTokens('MCP consumer insights platform')).toEqual([
      'MCP',
      'consumer',
    ]);
  });

  it('strips stopwords before picking the first 2 content tokens', () => {
    expect(decomposeKeywordToTokens('data aggregation for small businesses')).toEqual([
      'data',
      'aggregation',
    ]);
  });

  it('preserves casing for acronyms', () => {
    expect(decomposeKeywordToTokens('RAG pipeline tooling')).toEqual([
      'RAG',
      'pipeline',
    ]);
  });

  it('returns an empty array for a keyword that is entirely stopwords', () => {
    expect(decomposeKeywordToTokens('for the and')).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(decomposeKeywordToTokens('')).toEqual([]);
  });

  it('collapses and trims whitespace', () => {
    expect(decomposeKeywordToTokens('   data   science   ')).toEqual([
      'data',
      'science',
    ]);
  });

  it('treats a hyphenated compound as a single token', () => {
    expect(decomposeKeywordToTokens('AI-driven SaaS for marketing')).toEqual([
      'AI-driven',
      'SaaS',
    ]);
  });
});

describe('decomposeKeywordToTokens — profile-agnostic shapes', () => {
  it('works for a TECH founder (MCP, consumer, SaaS)', () => {
    expect(decomposeKeywordToTokens('MCP consumer insights platform')).toEqual([
      'MCP',
      'consumer',
    ]);
  });

  it('works for a HEALTHCARE founder (clinical, workflow)', () => {
    expect(
      decomposeKeywordToTokens('clinical documentation workflow automation'),
    ).toEqual(['clinical', 'documentation']);
  });

  it('works for a LEGAL founder (contract, review)', () => {
    expect(decomposeKeywordToTokens('contract review ai assistant')).toEqual([
      'contract',
      'review',
    ]);
  });

  it('works for a RETAIL founder (inventory, small shops)', () => {
    expect(
      decomposeKeywordToTokens('inventory management for small retail shops'),
    ).toEqual(['inventory', 'management']);
  });

  it('works for an EDUCATION founder (lesson planning)', () => {
    expect(decomposeKeywordToTokens('lesson planning tools for parents')).toEqual([
      'lesson',
      'planning',
    ]);
  });
});

describe('decomposeKeywordToTokens — maxTokens override', () => {
  it('respects maxTokens=1 (take just the top token)', () => {
    expect(decomposeKeywordToTokens('MCP consumer insights platform', 1)).toEqual([
      'MCP',
    ]);
  });

  it('respects maxTokens=3', () => {
    expect(decomposeKeywordToTokens('MCP consumer insights platform', 3)).toEqual([
      'MCP',
      'consumer',
      'insights',
    ]);
  });

  it('returns all tokens when maxTokens is very large', () => {
    expect(decomposeKeywordToTokens('a b c', 100)).toEqual(['b', 'c']);
    // 'a' is a stopword and is stripped before slicing.
  });
});

describe('decomposeKeywordToString', () => {
  it('joins the decomposed tokens with a single space', () => {
    expect(decomposeKeywordToString('MCP consumer insights platform')).toBe(
      'MCP consumer',
    );
  });

  it('returns an empty string for a keyword that is entirely stopwords', () => {
    expect(decomposeKeywordToString('for the and')).toBe('');
  });

  it('returns an empty string for an empty input', () => {
    expect(decomposeKeywordToString('')).toBe('');
  });

  it('respects a custom maxTokens for the join form', () => {
    expect(decomposeKeywordToString('MCP consumer insights platform', 3)).toBe(
      'MCP consumer insights',
    );
  });
});
