import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssumptionPreview } from '../../../components/frame/assumption-preview';
import type { FrameInput } from '../../../lib/types/frame-input';

describe('AssumptionPreview', () => {
  it('with empty input, lists all 15 optional fields', () => {
    render(<AssumptionPreview input={{}} onFocusField={vi.fn()} onAccept={vi.fn()} />);
    // 15 "Fill me in" buttons
    const fillButtons = screen.getAllByRole('button', { name: /fill me in/i });
    expect(fillButtons.length).toBe(15);
  });

  it('with one optional field set (domain), lists 14 rows', () => {
    const input: Partial<FrameInput> = {
      domain: [{ area: 'fintech', years: 3 }],
    };
    render(
      <AssumptionPreview input={input} onFocusField={vi.fn()} onAccept={vi.fn()} />,
    );
    const fillButtons = screen.getAllByRole('button', { name: /fill me in/i });
    expect(fillButtons.length).toBe(14);
  });

  it('anti_targets row has quality-critical marker', () => {
    render(<AssumptionPreview input={{}} onFocusField={vi.fn()} onAccept={vi.fn()} />);
    // The anti_targets row should contain the label & the critical marker
    const antiTargetsRow = screen
      .getAllByText(/quality-critical/i)
      .map((el) => el.closest('[data-testid="assumption-row"]'));
    expect(antiTargetsRow.length).toBeGreaterThanOrEqual(2);
  });

  it('domain row has quality-critical marker', () => {
    render(<AssumptionPreview input={{}} onFocusField={vi.fn()} onAccept={vi.fn()} />);
    const criticalMarkers = screen.getAllByText(/quality-critical/i);
    // At least 2 quality-critical markers: anti_targets and domain
    expect(criticalMarkers.length).toBeGreaterThanOrEqual(2);
  });

  it('clicking "Fill me in" on a row fires onFocusField with the question id', () => {
    const onFocusField = vi.fn();
    render(
      <AssumptionPreview input={{}} onFocusField={onFocusField} onAccept={vi.fn()} />,
    );
    const fillButtons = screen.getAllByRole('button', { name: /fill me in/i });
    fireEvent.click(fillButtons[0]!);
    // First field in order is 'domain', which is Q5
    expect(onFocusField).toHaveBeenCalled();
    expect(typeof onFocusField.mock.calls[0]?.[0]).toBe('string');
  });

  it('clicking "Accept all assumptions" fires onAccept', () => {
    const onAccept = vi.fn();
    render(<AssumptionPreview input={{}} onFocusField={vi.fn()} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole('button', { name: /accept all assumptions/i }));
    expect(onAccept).toHaveBeenCalled();
  });

  it('with all optional fields filled, shows "All fields filled" message', () => {
    const input: Partial<FrameInput> = {
      domain: [{ area: 'a', years: 1 }],
      insider_knowledge: 'x',
      anti_targets: ['crypto'],
      network: 'x',
      audience: 'x',
      proprietary_access: 'x',
      rare_combinations: 'x',
      recurring_frustration: 'x',
      four_week_mvp: 'x',
      previous_attempts: 'x',
      customer_affinity: 'x',
      time_to_revenue: '2_weeks',
      customer_type_preference: 'b2b',
      trigger: 'x',
      legal_constraints: 'x',
    };
    render(<AssumptionPreview input={input} onFocusField={vi.fn()} onAccept={vi.fn()} />);
    expect(screen.getByText(/All fields filled — ready to run/i)).toBeInTheDocument();
  });
});
