import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdditionalContext } from '../../../components/frame/additional-context';

describe('AdditionalContext', () => {
  it('renders the heading', () => {
    render(<AdditionalContext value="" onChange={vi.fn()} />);
    expect(
      screen.getByText(/Anything else I should know about you\?/i),
    ).toBeInTheDocument();
  });

  it('renders the subheading text', () => {
    render(<AdditionalContext value="" onChange={vi.fn()} />);
    expect(screen.getByText(/heavily weighted/i)).toBeInTheDocument();
  });

  it('renders the PII warning', () => {
    render(<AdditionalContext value="" onChange={vi.fn()} />);
    expect(screen.getByText(/sent to an AI provider/i)).toBeInTheDocument();
  });

  it('typing fires onChange', () => {
    const onChange = vi.fn();
    render(<AdditionalContext value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } });
    expect(onChange).toHaveBeenCalledWith('hi');
  });

  it('char counter shows 10 / 5000 when value has 10 chars', () => {
    render(<AdditionalContext value="0123456789" onChange={vi.fn()} />);
    expect(screen.getByText(/10 \/ 5000/)).toBeInTheDocument();
  });

  it('char counter has warning class when length >= 4500', () => {
    render(<AdditionalContext value={'a'.repeat(4500)} onChange={vi.fn()} />);
    const counter = screen.getByText(/4500 \/ 5000/);
    expect(counter.className).toMatch(/amber|yellow|warn/);
  });

  it('char counter has error class when length >= 5000', () => {
    render(<AdditionalContext value={'a'.repeat(5000)} onChange={vi.fn()} />);
    const counter = screen.getByText(/5000 \/ 5000/);
    expect(counter.className).toMatch(/red|error/);
  });

  it('typing beyond 5000 chars clamps the emitted value to 5000', () => {
    const onChange = vi.fn();
    render(<AdditionalContext value={'a'.repeat(4999)} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'a'.repeat(6000) },
    });
    expect(onChange).toHaveBeenCalled();
    const emitted = onChange.mock.calls[0]?.[0] as string;
    expect(emitted.length).toBe(5000);
  });
});
