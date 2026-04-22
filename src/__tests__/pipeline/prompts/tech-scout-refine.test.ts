import { describe, it, expect } from 'vitest';
import {
  buildRefineSystemPrompt,
  buildRefineUserPrompt,
} from '../../../pipeline/prompts/tech-scout-refine';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import type { FirstPassSummary } from '../../../lib/types/two-pass-state';

function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['python']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'fintech', years: 5 }]),
    insider_knowledge: stated('x'),
    anti_targets: stated([]),
    network: stated(null),
    audience: stated(null),
    proprietary_access: stated(null),
    rare_combinations: stated(null),
    recurring_frustration: stated(null),
    four_week_mvp: stated(null),
    previous_attempts: stated(null),
    customer_affinity: stated(null),
    time_to_revenue: stated('no_preference'),
    customer_type_preference: stated('no_preference'),
    trigger: stated(null),
    legal_constraints: stated(null),
    divergence_level: stated('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'refine-test',
  };
}

function buildDirective(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud'],
    exclude: ['crypto'],
    notes: 'n',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
  };
}

function buildSummary(overrides: Partial<FirstPassSummary> = {}): FirstPassSummary {
  return {
    queries_run: [],
    dense_directions: [],
    sparse_directions: [],
    empty_queries: [],
    top_signal_summary: [],
    exhausted_terms: [],
    ...overrides,
  };
}

describe('buildRefineSystemPrompt', () => {
  it('encodes the DO-NOT-REUSE rule for exhausted terms', () => {
    const p = buildRefineSystemPrompt();
    expect(p.toLowerCase()).toContain('exhausted');
    expect(p.toLowerCase()).toContain('do not reuse');
  });

  it('encodes the double-down rule for sparse directions', () => {
    expect(buildRefineSystemPrompt().toLowerCase()).toContain('sparse');
  });

  it('encodes the rephrase-once rule for empty queries', () => {
    expect(buildRefineSystemPrompt().toLowerCase()).toContain('empty');
  });

  it('includes the acronym preservation reminder', () => {
    expect(buildRefineSystemPrompt()).toContain('MCP');
  });

  it('embeds a scenario marker when provided', () => {
    expect(buildRefineSystemPrompt('refine-1')).toContain('[[SCENARIO:refine-1]]');
  });

  it('warns against embedding arxiv field prefixes inside arxiv_keywords', () => {
    // Regression guard: on 2026-04-15, Sonnet produced arxiv_keywords
    // like `cat:cs.LG tabular` which corrupted the arxiv URL builder.
    // The prompt must explicitly instruct the LLM to keep keywords
    // plain and let the adapter pair categories separately.
    const p = buildRefineSystemPrompt();
    expect(p).toContain('arxiv_keywords');
    expect(p).toMatch(/cat:|category code|field prefix/i);
    // Anti-example should appear so the model sees the wrong form.
    expect(p.toLowerCase()).toContain('do not');
  });
});

describe('buildRefineUserPrompt', () => {
  it('renders all 5 summary sections even when empty (shows "(none)")', () => {
    const u = buildRefineUserPrompt(buildDirective(), buildProfile(), buildSummary());
    expect(u).toContain('Dense directions');
    expect(u).toContain('Sparse directions');
    expect(u).toContain('Empty queries');
    expect(u).toContain('Exhausted terms');
    expect(u).toContain('Top signals');
    expect(u).toContain('(none)');
  });

  it('serializes sparse directions into the sparse block', () => {
    const u = buildRefineUserPrompt(
      buildDirective(),
      buildProfile(),
      buildSummary({ sparse_directions: ['hn: gap1', 'hn: gap2'] }),
    );
    expect(u).toContain('hn: gap1');
    expect(u).toContain('hn: gap2');
  });

  it('serializes empty queries into the empty block', () => {
    const u = buildRefineUserPrompt(
      buildDirective(),
      buildProfile(),
      buildSummary({ empty_queries: ['github: python MCP'] }),
    );
    expect(u).toContain('github: python MCP');
  });

  it('serializes exhausted terms with a hard-ban label', () => {
    const u = buildRefineUserPrompt(
      buildDirective(),
      buildProfile(),
      buildSummary({ exhausted_terms: ['hn: saturated'] }),
    );
    expect(u).toContain('hn: saturated');
    expect(u.toLowerCase()).toContain('hard ban');
  });

  it('serializes top signals with relevance and recency scores', () => {
    const u = buildRefineUserPrompt(
      buildDirective(),
      buildProfile(),
      buildSummary({
        top_signal_summary: [
          {
            source: 'hn_algolia',
            title: 'Big Launch',
            relevance: 9,
            recency: 8,
          },
        ],
      }),
    );
    expect(u).toContain('Big Launch');
    expect(u).toContain('relevance=9');
    expect(u).toContain('recency=8');
  });

  it('includes the directive.exclude list so the refine LLM respects it', () => {
    const u = buildRefineUserPrompt(buildDirective(), buildProfile(), buildSummary());
    expect(u).toContain('crypto');
  });
});
