import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScannerReportView } from '../../../components/debug/scanner-report-view';
import {
  SCANNER_REPORT_SCHEMA,
  type ScannerReport,
} from '../../../lib/types/scanner-report';
import type { Signal } from '../../../lib/types/signal';
import type { SourceReport } from '../../../lib/types/source-report';

/** Build a valid Signal fixture with the given overrides. */
function buildSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    source: 'hn_algolia',
    title: 'Sample Signal Title',
    url: 'https://example.com/sample',
    date: '2026-03-14T12:00:00.000Z',
    snippet: 'A short snippet of signal content for rendering tests.',
    score: { novelty: 7, specificity: 8, recency: 9 },
    category: 'tech_capability',
    raw: { foo: 'bar' },
    ...overrides,
  };
}

/** Build a valid SourceReport fixture with the given overrides. */
function buildSourceReport(
  overrides: Partial<SourceReport> = {},
): SourceReport {
  return {
    name: 'hn_algolia',
    status: 'ok',
    signals_count: 1,
    queries_ran: ['hn: fraud ml'],
    queries_with_zero_results: [],
    error: null,
    elapsed_ms: 120,
    cost_usd: 0,
    ...overrides,
  };
}

/** Build a valid ScannerReport fixture with the given overrides. */
function buildReport(overrides: Partial<ScannerReport> = {}): ScannerReport {
  const base: ScannerReport = {
    scanner: 'tech_scout',
    status: 'ok',
    signals: [buildSignal()],
    source_reports: [
      buildSourceReport({ name: 'hn_algolia' }),
      buildSourceReport({
        name: 'arxiv',
        status: 'ok_empty',
        signals_count: 0,
      }),
      buildSourceReport({
        name: 'github',
        status: 'denied',
        signals_count: 0,
        error: { kind: 'denied', message: 'forbidden' },
      }),
    ],
    expansion_plan: {
      expanded_keywords: ['fraud ml'],
      arxiv_categories: ['cs.LG'],
      github_languages: ['python'],
      domain_tags: [],
      timeframe_iso: '2025-10-01T00:00:00Z',
    },
    total_raw_items: 4,
    signals_after_dedupe: 3,
    signals_after_exclude: 2,
    cost_usd: 0.0123,
    elapsed_ms: 4500,
    generated_at: '2026-04-09T12:00:00.000Z',
    errors: [],
    warnings: [],
    ...overrides,
  };
  // Validate the fixture matches the canonical schema so drift fails fast.
  return SCANNER_REPORT_SCHEMA.parse(base);
}

describe('ScannerReportView', () => {
  it('returns null when report is undefined', () => {
    const { container } = render(<ScannerReportView report={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the scanner name in a heading', () => {
    render(<ScannerReportView report={buildReport()} />);
    expect(screen.getByText(/Scanner: tech_scout/i)).toBeInTheDocument();
  });

  it('renders the overall status pill (e.g. ok or partial)', () => {
    render(<ScannerReportView report={buildReport({ status: 'partial' })} />);
    expect(screen.getByTestId('scanner-status-pill')).toHaveTextContent(
      /partial/i,
    );
  });

  it('renders generated_at, elapsed_ms, and cost_usd values', () => {
    render(<ScannerReportView report={buildReport()} />);
    expect(screen.getByText(/2026-04-09T12:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/4500/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0123/)).toBeInTheDocument();
  });

  it('renders one row per source_report', () => {
    render(<ScannerReportView report={buildReport()} />);
    expect(screen.getAllByTestId(/^source-row-/)).toHaveLength(3);
    expect(screen.getByTestId('source-row-hn_algolia')).toBeInTheDocument();
    expect(screen.getByTestId('source-row-arxiv')).toBeInTheDocument();
    expect(screen.getByTestId('source-row-github')).toBeInTheDocument();
  });

  it('renders a SourceStatusBadge per source row', () => {
    render(<ScannerReportView report={buildReport()} />);
    const hn = screen.getByTestId('source-row-hn_algolia');
    expect(hn.textContent).toContain('ok');
    const arxiv = screen.getByTestId('source-row-arxiv');
    expect(arxiv.textContent).toContain('empty');
    const gh = screen.getByTestId('source-row-github');
    expect(gh.textContent).toContain('denied');
  });

  it('renders the expansion_plan as JSON inside a <pre> in <details>', () => {
    render(<ScannerReportView report={buildReport()} />);
    const details = screen.getByTestId('expansion-plan-details');
    expect(details.tagName.toLowerCase()).toBe('details');
    const pre = details.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('expanded_keywords');
    expect(pre?.textContent).toContain('fraud ml');
  });

  it('renders each signal title', () => {
    render(<ScannerReportView report={buildReport()} />);
    expect(screen.getByText('Sample Signal Title')).toBeInTheDocument();
  });

  it('renders each signal title as a link to its URL', () => {
    render(<ScannerReportView report={buildReport()} />);
    const link = screen.getByRole('link', { name: /Sample Signal Title/i });
    expect(link.getAttribute('href')).toBe('https://example.com/sample');
  });

  it('renders the warnings callout when warnings is non-empty', () => {
    const r = buildReport({ warnings: ['expansion_fallback: invalid_json'] });
    render(<ScannerReportView report={r} />);
    expect(screen.getByTestId('scanner-warnings')).toBeInTheDocument();
    expect(screen.getByText(/expansion_fallback/)).toBeInTheDocument();
  });

  it('does not render the warnings callout when warnings is empty', () => {
    render(<ScannerReportView report={buildReport()} />);
    expect(screen.queryByTestId('scanner-warnings')).toBeNull();
  });

  it('renders the errors callout when errors is non-empty', () => {
    const r = buildReport({
      status: 'failed',
      errors: [{ kind: 'scanner_crashed', message: 'boom' }],
    });
    render(<ScannerReportView report={r} />);
    expect(screen.getByTestId('scanner-errors')).toBeInTheDocument();
    expect(screen.getByText(/scanner_crashed/)).toBeInTheDocument();
  });
});
