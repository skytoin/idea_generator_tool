import { describe, it, expect } from 'vitest';
import {
  ENRICHMENT_RESPONSE_SCHEMA,
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
  type EnrichmentInput,
} from '../../../pipeline/prompts/tech-scout-enrichment';

describe('ENRICHMENT_RESPONSE_SCHEMA', () => {
  it('parses a valid response with one signal', () => {
    const valid = {
      signals: [
        {
          index: 0,
          title: 'X',
          snippet: 'Y',
          score: { novelty: 5, specificity: 5, recency: 5 },
          category: 'research',
        },
      ],
    };
    const result = ENRICHMENT_RESPONSE_SCHEMA.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects a signal with index: -1', () => {
    const invalid = {
      signals: [
        {
          index: -1,
          title: 'X',
          snippet: 'Y',
          score: { novelty: 5, specificity: 5, recency: 5 },
          category: 'research',
        },
      ],
    };
    const result = ENRICHMENT_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects a signal with index: 1.5 (non-integer)', () => {
    const invalid = {
      signals: [
        {
          index: 1.5,
          title: 'X',
          snippet: 'Y',
          score: { novelty: 5, specificity: 5, recency: 5 },
          category: 'research',
        },
      ],
    };
    const result = ENRICHMENT_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects a signal with score.novelty: 0 (out of range)', () => {
    const invalid = {
      signals: [
        {
          index: 0,
          title: 'X',
          snippet: 'Y',
          score: { novelty: 0, specificity: 5, recency: 5 },
          category: 'research',
        },
      ],
    };
    const result = ENRICHMENT_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects a signal with unknown category', () => {
    const invalid = {
      signals: [
        {
          index: 0,
          title: 'X',
          snippet: 'Y',
          score: { novelty: 5, specificity: 5, recency: 5 },
          category: 'mystery',
        },
      ],
    };
    const result = ENRICHMENT_RESPONSE_SCHEMA.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts signals: [] (no enrichments)', () => {
    const valid = { signals: [] };
    const result = ENRICHMENT_RESPONSE_SCHEMA.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe('buildEnrichmentSystemPrompt', () => {
  it('contains required security keywords', () => {
    const system = buildEnrichmentSystemPrompt();
    expect(system).toContain('UNTRUSTED');
    expect(system).toContain('<raw_item>');
    expect(system).toContain('never invent');
  });

  it('prepends scenario marker when provided', () => {
    const system = buildEnrichmentSystemPrompt('my-scenario');
    expect(system.startsWith('[[SCENARIO:my-scenario]]')).toBe(true);
  });

  it('omits scenario marker when not provided', () => {
    const system = buildEnrichmentSystemPrompt();
    expect(system.startsWith('[[SCENARIO:')).toBe(false);
  });
});

describe('buildEnrichmentUserPrompt', () => {
  it('wraps every raw item in a <raw_item index="n"> delimiter', () => {
    const items: EnrichmentInput[] = [
      {
        title: 'A',
        snippet: 'a',
        source: 'hn',
        date: null,
        url: 'https://a.com',
      },
      {
        title: 'B',
        snippet: 'b',
        source: 'arxiv',
        date: '2026-01-01T00:00:00Z',
        url: 'https://b.com',
      },
    ];
    const user = buildEnrichmentUserPrompt(items);
    expect(user).toContain('<raw_item index="0">');
    expect(user).toContain('<raw_item index="1">');
  });

  it('renders "unknown" when date is null', () => {
    const items: EnrichmentInput[] = [
      {
        title: 'A',
        snippet: 'a',
        source: 'hn',
        date: null,
        url: 'https://a.com',
      },
    ];
    const user = buildEnrichmentUserPrompt(items);
    expect(user).toContain('date: unknown');
  });

  it('renders the actual date when present', () => {
    const items: EnrichmentInput[] = [
      {
        title: 'A',
        snippet: 'a',
        source: 'arxiv',
        date: '2026-01-01T00:00:00Z',
        url: 'https://a.com',
      },
    ];
    const user = buildEnrichmentUserPrompt(items);
    expect(user).toContain('date: 2026-01-01T00:00:00Z');
  });
});
