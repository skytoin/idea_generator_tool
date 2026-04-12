import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceStatusBadge } from '../../../components/debug/source-status-badge';

describe('SourceStatusBadge', () => {
  it('renders ok with green class and "ok" label', () => {
    render(<SourceStatusBadge status="ok" />);
    const el = screen.getByText('ok');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-green-200');
  });

  it('renders ok_empty with yellow class and "empty" label', () => {
    render(<SourceStatusBadge status="ok_empty" />);
    const el = screen.getByText('empty');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-yellow-200');
  });

  it('renders timeout with orange class and "timeout" label', () => {
    render(<SourceStatusBadge status="timeout" />);
    const el = screen.getByText('timeout');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-orange-200');
  });

  it('renders denied with red class and "denied" label', () => {
    render(<SourceStatusBadge status="denied" />);
    const el = screen.getByText('denied');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-red-200');
  });

  it('renders failed with red class and "failed" label', () => {
    render(<SourceStatusBadge status="failed" />);
    const el = screen.getByText('failed');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-red-300');
  });

  it('applies the title prop to the rendered element when provided', () => {
    render(<SourceStatusBadge status="ok" title="hn_algolia succeeded" />);
    const el = screen.getByText('ok');
    expect(el.getAttribute('title')).toBe('hn_algolia succeeded');
  });
});
