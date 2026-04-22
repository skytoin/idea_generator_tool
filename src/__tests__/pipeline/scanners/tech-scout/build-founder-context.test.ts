import { describe, it, expect } from 'vitest';
import { buildFounderContext } from '../../../../pipeline/scanners/tech-scout/scanner';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';

/**
 * buildFounderContext must be profile-agnostic. These tests pin that
 * invariant by running the same function across four very different
 * founder shapes — tech, healthcare, legal, retail — and verifying
 * the output format is identical while the content reflects each
 * profile's actual values. There is no hard-coded audience list in
 * the production code, and there shouldn't be any in these tests
 * either beyond the field values pulled from the profile fixtures.
 */

/** Helper: build a FounderProfile with sensible defaults + overrides. */
function buildProfile(overrides: {
  skills?: string[];
  domainArea?: string;
  audience?: string | null;
  customerType?: 'b2b' | 'b2c' | 'both' | 'no_preference';
  antiTargets?: string[];
}): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  const assumed = <T>(value: T) => ({ value, source: 'assumed' as const });
  return {
    skills: stated(overrides.skills ?? ['Python']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: overrides.domainArea ?? 'software', years: 5 }]),
    insider_knowledge: assumed(null),
    anti_targets: stated(overrides.antiTargets ?? []),
    network: assumed(null),
    audience:
      overrides.audience === undefined
        ? assumed(null)
        : stated(overrides.audience),
    proprietary_access: assumed(null),
    rare_combinations: assumed(null),
    recurring_frustration: assumed(null),
    four_week_mvp: assumed(null),
    previous_attempts: assumed(null),
    customer_affinity: assumed(null),
    time_to_revenue: assumed('no_preference'),
    customer_type_preference: stated(overrides.customerType ?? 'no_preference'),
    trigger: assumed(null),
    legal_constraints: assumed(null),
    divergence_level: assumed('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'ctx-test',
  };
}

function buildDirective(
  overrides: Partial<ScannerDirectives['tech_scout']> = {},
): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['kw1', 'kw2'],
    exclude: [],
    notes: 'sample notes',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
    ...overrides,
  };
}

describe('buildFounderContext — core shape', () => {
  it('includes the directive goals and notes', () => {
    const ctx = buildFounderContext(
      buildDirective({ keywords: ['mcp', 'data collection'], notes: 'my notes' }),
      buildProfile({}),
      'prose',
    );
    expect(ctx).toContain('Goals/keywords: mcp, data collection');
    expect(ctx).toContain('Notes: my notes');
  });

  it('renders "(none)" for empty directive notes', () => {
    const ctx = buildFounderContext(
      buildDirective({ notes: '' }),
      buildProfile({}),
      'prose',
    );
    expect(ctx).toContain('Notes: (none)');
  });

  it('clips the narrative to 500 characters', () => {
    const longProse = 'a'.repeat(1200);
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({}),
      longProse,
    );
    const marker = 'Founder summary: ';
    const idx = ctx.indexOf(marker);
    const tail = ctx.slice(idx + marker.length);
    expect(tail.length).toBe(500);
  });
});

describe('buildFounderContext — audience surfacing (profile-agnostic)', () => {
  it('surfaces audience for a TECH founder targeting ordinary consumers', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({
        skills: ['Python', 'ML'],
        domainArea: 'software',
        audience: 'ordinary people',
        customerType: 'b2c',
      }),
      'prose',
    );
    expect(ctx).toContain('Audience: ordinary people');
    expect(ctx).toContain('customer type preference: b2c');
  });

  it('surfaces audience for a HEALTHCARE founder targeting clinic owners', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({
        skills: ['nursing', 'Python'],
        domainArea: 'healthcare',
        audience: 'independent clinic owners',
        customerType: 'b2b',
      }),
      'prose',
    );
    expect(ctx).toContain('Audience: independent clinic owners');
    expect(ctx).toContain('customer type preference: b2b');
  });

  it('surfaces audience for a LEGAL founder targeting solo practitioners', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({
        skills: ['contract law', 'SQL'],
        domainArea: 'legal',
        audience: 'solo practitioners',
        customerType: 'b2b',
      }),
      'prose',
    );
    expect(ctx).toContain('Audience: solo practitioners');
  });

  it('surfaces audience for a RETAIL founder targeting small-shop owners', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({
        skills: ['retail ops'],
        domainArea: 'retail',
        audience: 'small shop owners',
        customerType: 'b2b',
      }),
      'prose',
    );
    expect(ctx).toContain('Audience: small shop owners');
  });

  it('renders "(not specified)" when audience is null', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({ audience: null }),
      'prose',
    );
    expect(ctx).toContain('Audience: (not specified)');
  });
});

describe('buildFounderContext — anti-targets surfacing', () => {
  it('serializes the anti_targets list into a comma-joined line', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({ antiTargets: ['crypto', 'gambling', 'adult content'] }),
      'prose',
    );
    expect(ctx).toContain(
      'Anti-targets (reject matches to relevance=1): crypto, gambling, adult content',
    );
  });

  it('renders "(none)" when anti_targets is an empty array', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({ antiTargets: [] }),
      'prose',
    );
    expect(ctx).toContain('Anti-targets (reject matches to relevance=1): (none)');
  });

  it('works with a single anti-target', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({ antiTargets: ['gambling'] }),
      'prose',
    );
    expect(ctx).toContain(
      'Anti-targets (reject matches to relevance=1): gambling',
    );
  });
});

describe('buildFounderContext — generalization invariants', () => {
  it('produces the same field structure for 4 very different profiles', () => {
    const profiles = [
      buildProfile({
        skills: ['Python'],
        domainArea: 'software',
        audience: 'developers',
      }),
      buildProfile({
        skills: ['nursing'],
        domainArea: 'healthcare',
        audience: 'patients',
      }),
      buildProfile({
        skills: ['contract law'],
        domainArea: 'legal',
        audience: 'solo practitioners',
      }),
      buildProfile({
        skills: ['retail ops'],
        domainArea: 'retail',
        audience: 'small shop owners',
      }),
    ];
    const contexts = profiles.map((p) =>
      buildFounderContext(buildDirective(), p, 'prose'),
    );
    // Every output must carry the same labeled sections regardless of profile.
    for (const c of contexts) {
      expect(c).toContain('Goals/keywords:');
      expect(c).toContain('Notes:');
      expect(c).toContain('Audience:');
      expect(c).toContain('customer type preference:');
      expect(c).toContain('Anti-targets');
      expect(c).toContain('Founder summary:');
    }
  });

  it('does not hardcode any specific audience label', () => {
    const ctx = buildFounderContext(
      buildDirective(),
      buildProfile({ audience: 'K-12 music teachers' }),
      'prose',
    );
    // The only place "K-12 music teachers" should appear is because
    // the profile supplied it; if the helper ever hardcoded a
    // default audience it would leak here.
    expect(ctx).toContain('K-12 music teachers');
    expect(ctx).not.toContain('ordinary people');
    expect(ctx).not.toContain('developers');
  });
});
