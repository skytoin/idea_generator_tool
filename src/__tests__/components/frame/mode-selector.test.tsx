import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModeSelector } from '../../../components/frame/mode-selector';

describe('ModeSelector', () => {
  it('renders three radio options', () => {
    render(
      <ModeSelector
        mode={null}
        existingIdea=""
        onModeChange={vi.fn()}
        onExistingIdeaChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /help me find ideas/i })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /I have an idea.*refine/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /rough direction/i }),
    ).toBeInTheDocument();
  });

  it("selecting 'explore' fires onModeChange and does not reveal existing_idea", () => {
    const onModeChange = vi.fn();
    render(
      <ModeSelector
        mode={null}
        existingIdea=""
        onModeChange={onModeChange}
        onExistingIdeaChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /help me find ideas/i }));
    expect(onModeChange).toHaveBeenCalledWith('explore');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it("selecting 'refine' fires onModeChange and reveals existing_idea textarea", () => {
    const onModeChange = vi.fn();
    const { rerender } = render(
      <ModeSelector
        mode={null}
        existingIdea=""
        onModeChange={onModeChange}
        onExistingIdeaChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /refine/i }));
    expect(onModeChange).toHaveBeenCalledWith('refine');
    rerender(
      <ModeSelector
        mode="refine"
        existingIdea=""
        onModeChange={onModeChange}
        onExistingIdeaChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it("selecting 'open_direction' reveals existing_idea textarea", () => {
    render(
      <ModeSelector
        mode="open_direction"
        existingIdea=""
        onModeChange={vi.fn()}
        onExistingIdeaChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('typing in existing_idea fires onExistingIdeaChange', () => {
    const onExistingIdeaChange = vi.fn();
    render(
      <ModeSelector
        mode="refine"
        existingIdea=""
        onModeChange={vi.fn()}
        onExistingIdeaChange={onExistingIdeaChange}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my idea' } });
    expect(onExistingIdeaChange).toHaveBeenCalledWith('my idea');
  });

  it('shows warning when refine selected and existingIdea is empty', () => {
    render(
      <ModeSelector
        mode="refine"
        existingIdea=""
        onModeChange={vi.fn()}
        onExistingIdeaChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Please describe your idea/i)).toBeInTheDocument();
  });

  it('hides warning when refine selected and existingIdea is non-empty', () => {
    render(
      <ModeSelector
        mode="refine"
        existingIdea="I have a rough plan"
        onModeChange={vi.fn()}
        onExistingIdeaChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Please describe your idea/i)).not.toBeInTheDocument();
  });
});
