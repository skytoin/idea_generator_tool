import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileProgress } from '../../../components/frame/profile-progress';
import type { FrameInput } from '../../../lib/types/frame-input';

describe('ProfileProgress', () => {
  it('empty input shows 0 of 5 required and no ready badge', () => {
    render(<ProfileProgress input={{}} />);
    expect(screen.getByText(/0 of 5 required filled/i)).toBeInTheDocument();
    expect(screen.queryByText(/Pipeline ready/i)).not.toBeInTheDocument();
  });

  it('all 5 required filled in explore mode shows 5 of 5 and ready badge', () => {
    const input: Partial<FrameInput> = {
      mode: 'explore',
      skills: ['React'],
      time_per_week: '10',
      money_available: 'lt_500',
      ambition: 'side_project',
    };
    render(<ProfileProgress input={input} />);
    expect(screen.getByText(/5 of 5 required filled/i)).toBeInTheDocument();
    expect(screen.getByText(/Pipeline ready/i)).toBeInTheDocument();
  });

  it('refine mode without existing_idea is only 4 of 5', () => {
    const input: Partial<FrameInput> = {
      mode: 'refine',
      skills: ['React'],
      time_per_week: '10',
      money_available: 'lt_500',
      ambition: 'side_project',
    };
    render(<ProfileProgress input={input} />);
    expect(screen.getByText(/4 of 5 required filled/i)).toBeInTheDocument();
    expect(screen.queryByText(/Pipeline ready/i)).not.toBeInTheDocument();
  });

  it('refine mode with existing_idea shows 5 of 5', () => {
    const input: Partial<FrameInput> = {
      mode: 'refine',
      existing_idea: 'My startup idea',
      skills: ['React'],
      time_per_week: '10',
      money_available: 'lt_500',
      ambition: 'side_project',
    };
    render(<ProfileProgress input={input} />);
    expect(screen.getByText(/5 of 5 required filled/i)).toBeInTheDocument();
    expect(screen.getByText(/Pipeline ready/i)).toBeInTheDocument();
  });

  it('recommended counter reflects domain/insider/anti_targets filled', () => {
    const input: Partial<FrameInput> = {
      domain: [{ area: 'fintech', years: 3 }],
      insider_knowledge: 'knows A lot',
    };
    render(<ProfileProgress input={input} />);
    expect(screen.getByText(/2 of 3 recommended filled/i)).toBeInTheDocument();
  });

  it('optional counter reflects how many optional fields are filled', () => {
    const input: Partial<FrameInput> = {
      network: 'many contacts',
      trigger: 'got laid off',
    };
    render(<ProfileProgress input={input} />);
    expect(screen.getByText(/Optional: 2 of 12 filled/i)).toBeInTheDocument();
  });
});
