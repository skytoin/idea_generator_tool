import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FrameDebugView } from '../../../components/debug/frame-debug-view';
import type { FrameOutput } from '../../../lib/types/frame-output';
import type { ScannerReport } from '../../../lib/types/scanner-report';

/** Build a valid ScannerReport fixture for tests that exercise scanner output. */
function buildScannerReport(): ScannerReport {
  return {
    scanner: 'tech_scout',
    status: 'ok',
    signals: [
      {
        source: 'hn_algolia',
        title: 'Test scanner signal title',
        url: 'https://example.com/signal',
        date: '2026-03-14T12:00:00.000Z',
        snippet: 'Test snippet',
        score: { novelty: 7, specificity: 8, recency: 9 },
        category: 'tech_capability',
        raw: {},
      },
    ],
    source_reports: [
      {
        name: 'hn_algolia',
        status: 'ok',
        signals_count: 1,
        queries_ran: ['hn: fraud ml'],
        queries_with_zero_results: [],
        error: null,
        elapsed_ms: 120,
        cost_usd: 0,
      },
    ],
    expansion_plan: {
      expanded_keywords: ['react'],
      arxiv_categories: [],
      github_languages: [],
      domain_tags: [],
      timeframe_iso: '2025-10-01T00:00:00.000Z',
    },
    total_raw_items: 1,
    signals_after_dedupe: 1,
    signals_after_exclude: 1,
    cost_usd: 0.0001,
    elapsed_ms: 500,
    generated_at: '2026-04-09T12:00:00.000Z',
    errors: [],
    warnings: [],
  };
}

/**
 * Build a valid FrameOutput with one stated field and one assumed field.
 * Pass `{ withScanners: true }` to attach a ScannerReport under
 * output.scanners.tech_scout.
 */
function buildOutput(opts: { withScanners?: boolean } = {}): FrameOutput {
  const base: FrameOutput = {
    mode: 'explore',
    existing_idea: null,
    profile: {
      skills: { value: ['React', 'TypeScript'], source: 'stated' },
      time_per_week: { value: '10', source: 'stated' },
      money_available: { value: 'lt_500', source: 'stated' },
      ambition: { value: 'side_project', source: 'stated' },
      domain: { value: [], source: 'assumed' },
      insider_knowledge: { value: null, source: 'assumed' },
      anti_targets: { value: [], source: 'assumed' },
      network: { value: null, source: 'assumed' },
      audience: { value: null, source: 'assumed' },
      proprietary_access: { value: null, source: 'assumed' },
      rare_combinations: { value: null, source: 'assumed' },
      recurring_frustration: { value: null, source: 'assumed' },
      four_week_mvp: { value: null, source: 'assumed' },
      previous_attempts: { value: null, source: 'assumed' },
      customer_affinity: { value: null, source: 'assumed' },
      time_to_revenue: { value: 'no_preference', source: 'assumed' },
      customer_type_preference: { value: 'no_preference', source: 'assumed' },
      trigger: { value: null, source: 'assumed' },
      legal_constraints: { value: null, source: 'assumed' },
      divergence_level: { value: 'balanced', source: 'assumed' },
      additional_context_raw: '',
      schema_version: 1,
      profile_hash: 'abcdef0123456789',
    },
    narrative: {
      prose: 'A short prose description of the founder'.padEnd(60, '.'),
      word_count: 12,
      generated_at: '2026-04-09T12:00:00.000Z',
    },
    directives: {
      tech_scout: {
        keywords: ['react'],
        exclude: ['crypto'],
        notes: 'tech notes',
        target_sources: ['hn'],
        timeframe: 'last 12 months',
      },
      pain_scanner: {
        keywords: ['pain'],
        exclude: [],
        notes: 'pain notes',
        target_subreddits: ['r/webdev'],
        personas: ['solo founder'],
      },
      market_scanner: {
        keywords: ['saas'],
        exclude: [],
        notes: 'market notes',
        competitor_domains: ['acme.com'],
        yc_batches_to_scan: ['S23'],
      },
      change_scanner: {
        keywords: ['regs'],
        exclude: [],
        notes: 'change notes',
        regulatory_areas: ['GDPR'],
        geographic: ['US'],
      },
    },
    debug: {
      trace: [
        { field: 'skills', consumer: 'narrative' },
        { field: 'ambition', consumer: 'narrative' },
        { field: 'skills', consumer: 'tech_scout' },
      ],
      cost_usd: 0.0123,
      generated_at: '2026-04-09T12:00:00.000Z',
    },
  };
  if (opts.withScanners) {
    base.scanners = { tech_scout: buildScannerReport() };
  }
  return base;
}

describe('FrameDebugView', () => {
  it('shows a placeholder when output and error are both null', () => {
    render(<FrameDebugView output={null} error={null} />);
    expect(screen.getByText(/no output yet/i)).toBeInTheDocument();
  });

  it('renders the error message when error is set', () => {
    render(<FrameDebugView output={null} error="something exploded" />);
    expect(screen.getByText(/something exploded/)).toBeInTheDocument();
  });

  it('renders the mode in the output header', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.getByText(/mode/i)).toBeInTheDocument();
    expect(screen.getByText(/explore/)).toBeInTheDocument();
  });

  it('renders the profile table with stated fields', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    // 'skills' now appears in both the profile row and the trace details
    // table, so assert at least one match rather than exactly one.
    expect(screen.getAllByText('skills').length).toBeGreaterThan(0);
    expect(screen.getByText(/React/)).toBeInTheDocument();
    expect(screen.getByText(/TypeScript/)).toBeInTheDocument();
  });

  it('renders assumed badges for assumed fields', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    const assumedBadges = screen.getAllByText(/assumed/);
    expect(assumedBadges.length).toBeGreaterThan(0);
  });

  it('renders the narrative prose and word count', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.getByText(/A short prose description of the founder/)).toBeInTheDocument();
    expect(screen.getByText(/12 words/)).toBeInTheDocument();
  });

  it('renders all four scanner directive sections', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    // Scanner names also appear in the trace details table, so use
    // getAllByText and assert each has at least one match.
    expect(screen.getAllByText(/tech_scout/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/pain_scanner/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/market_scanner/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/change_scanner/).length).toBeGreaterThan(0);
  });

  it('renders scanner-specific fields inside each scanner section', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    // tech_scout target_sources + timeframe
    expect(screen.getByText(/target_sources/)).toBeInTheDocument();
    expect(screen.getByText(/timeframe/)).toBeInTheDocument();
    expect(screen.getByText(/last 12 months/)).toBeInTheDocument();
    // pain_scanner target_subreddits + personas
    expect(screen.getByText(/target_subreddits/)).toBeInTheDocument();
    expect(screen.getByText(/personas/)).toBeInTheDocument();
    // market_scanner competitor_domains + yc_batches_to_scan
    expect(screen.getByText(/competitor_domains/)).toBeInTheDocument();
    expect(screen.getByText(/yc_batches_to_scan/)).toBeInTheDocument();
    // change_scanner regulatory_areas + geographic
    expect(screen.getByText(/regulatory_areas/)).toBeInTheDocument();
    expect(screen.getByText(/geographic/)).toBeInTheDocument();
  });

  it('renders the verbatim additional_context_raw block when non-empty', () => {
    const output = buildOutput();
    output.profile.additional_context_raw =
      'I run a Shopify theme shop with 400 customers.';
    render(<FrameDebugView output={output} error={null} />);
    expect(screen.getByTestId('additional-context-raw')).toHaveTextContent(
      /Shopify theme shop/,
    );
  });

  it('shows an empty placeholder when additional_context_raw is empty', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.queryByTestId('additional-context-raw')).toBeNull();
    expect(screen.getByText(/no free-text note submitted/i)).toBeInTheDocument();
  });

  it('renders the trace details table grouping consumers by field', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.getByTestId('trace-details-table')).toBeInTheDocument();
  });

  it('renders the cost as USD', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.getByText(/\$0\.0123/)).toBeInTheDocument();
  });

  it('renders the trace entry count in the summary', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.getByText(/3 field->consumer pairs/)).toBeInTheDocument();
  });

  it('renders the ScannerReportView when scanners.tech_scout is defined', () => {
    render(
      <FrameDebugView
        output={buildOutput({ withScanners: true })}
        error={null}
      />,
    );
    expect(screen.getByText(/Scanner: tech_scout/i)).toBeInTheDocument();
    expect(screen.getByText(/Test scanner signal title/)).toBeInTheDocument();
  });

  it('does not render the scanner section when scanners is undefined', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.queryByText(/Scanner: tech_scout/i)).toBeNull();
  });
});
