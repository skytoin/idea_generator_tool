import { describe, it, expect } from 'vitest';
import { SCANNER_DIRECTIVES_SCHEMA } from '../../../lib/types/scanner-directives';

function buildValidDirectives() {
  return {
    tech_scout: {
      keywords: ['react'],
      exclude: ['jquery'],
      notes: 'focus on modern',
      target_sources: ['hn', 'github'] as const,
      timeframe: '2025-2026',
    },
    pain_scanner: {
      keywords: ['bug'],
      exclude: [],
      notes: '',
      target_subreddits: ['webdev'],
      personas: ['indie hacker'],
    },
    market_scanner: {
      keywords: [],
      exclude: [],
      notes: '',
      competitor_domains: ['example.com'],
      yc_batches_to_scan: ['W24'],
    },
    change_scanner: {
      keywords: [],
      exclude: [],
      notes: '',
      regulatory_areas: ['GDPR'],
      geographic: ['EU'],
    },
  };
}

describe('SCANNER_DIRECTIVES_SCHEMA', () => {
  it('accepts a fully populated directives object', () => {
    const result = SCANNER_DIRECTIVES_SCHEMA.safeParse(buildValidDirectives());
    expect(result.success).toBe(true);
  });

  it('rejects if tech_scout is missing', () => {
    const d = buildValidDirectives() as Record<string, unknown>;
    delete d.tech_scout;
    expect(SCANNER_DIRECTIVES_SCHEMA.safeParse(d).success).toBe(false);
  });

  it('rejects invalid target_sources enum values', () => {
    const d = buildValidDirectives();
    const bad = {
      ...d,
      tech_scout: { ...d.tech_scout, target_sources: ['twitter'] },
    };
    expect(SCANNER_DIRECTIVES_SCHEMA.safeParse(bad).success).toBe(false);
  });

  it('accepts empty arrays everywhere', () => {
    const d = {
      tech_scout: {
        keywords: [],
        exclude: [],
        notes: '',
        target_sources: [],
        timeframe: '',
      },
      pain_scanner: {
        keywords: [],
        exclude: [],
        notes: '',
        target_subreddits: [],
        personas: [],
      },
      market_scanner: {
        keywords: [],
        exclude: [],
        notes: '',
        competitor_domains: [],
        yc_batches_to_scan: [],
      },
      change_scanner: {
        keywords: [],
        exclude: [],
        notes: '',
        regulatory_areas: [],
        geographic: [],
      },
    };
    expect(SCANNER_DIRECTIVES_SCHEMA.safeParse(d).success).toBe(true);
  });

  it('rejects if a scanner is missing its specialized fields', () => {
    const d = buildValidDirectives();
    const bad = {
      ...d,
      pain_scanner: {
        keywords: [],
        exclude: [],
        notes: '',
        // missing target_subreddits and personas
      },
    };
    expect(SCANNER_DIRECTIVES_SCHEMA.safeParse(bad).success).toBe(false);
  });
});
