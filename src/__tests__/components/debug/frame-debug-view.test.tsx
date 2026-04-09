import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FrameDebugView } from '../../../components/debug/frame-debug-view';
import type { FrameOutput } from '../../../lib/types/frame-output';

/** Build a valid FrameOutput with one stated field and one assumed field. */
function buildOutput(): FrameOutput {
  return {
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
    expect(screen.getByText('skills')).toBeInTheDocument();
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
    expect(screen.getByText(/tech_scout/)).toBeInTheDocument();
    expect(screen.getByText(/pain_scanner/)).toBeInTheDocument();
    expect(screen.getByText(/market_scanner/)).toBeInTheDocument();
    expect(screen.getByText(/change_scanner/)).toBeInTheDocument();
  });

  it('renders the cost as USD', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.getByText(/\$0\.0123/)).toBeInTheDocument();
  });

  it('renders the trace entry count', () => {
    render(<FrameDebugView output={buildOutput()} error={null} />);
    expect(screen.getByText(/3 field->consumer pairs/)).toBeInTheDocument();
  });
});
