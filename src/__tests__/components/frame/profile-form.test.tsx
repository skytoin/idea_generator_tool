import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProfileForm } from '../../../components/frame/profile-form';
import * as clientState from '../../../lib/frame/client-state';

describe('ProfileForm', () => {
  beforeEach(() => {
    // Ensure each test starts with empty localStorage
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('renders ModeSelector at top', () => {
    render(<ProfileForm />);
    expect(screen.getByText(/Do you have a specific idea/i)).toBeInTheDocument();
  });

  it('renders the 4 required question labels by default', () => {
    render(<ProfileForm />);
    // Q1 skills
    expect(
      screen.getByText(/What can you build, make, or do yourself/i),
    ).toBeInTheDocument();
    // Q2 time_per_week
    expect(
      screen.getByText(/How many hours per week/i),
    ).toBeInTheDocument();
    // Q3 money_available
    expect(
      screen.getByText(/How much money can you spend/i),
    ).toBeInTheDocument();
    // Q4 ambition
    expect(
      screen.getByText(/What role will this project play/i),
    ).toBeInTheDocument();
  });

  it('renders the 3 recommended question labels by default', () => {
    render(<ProfileForm />);
    const section = screen.getByTestId('recommended-section');
    // Q5 domain
    expect(
      within(section).getByText(/What industries, fields, or areas/i),
    ).toBeInTheDocument();
    // Q6 insider_knowledge
    expect(
      within(section).getByText(/something you've seen broken/i),
    ).toBeInTheDocument();
    // Q7 anti_targets
    expect(
      within(section).getByText(/refuse to work on/i),
    ).toBeInTheDocument();
  });

  it('does NOT render optional question labels in the optional section by default', () => {
    render(<ProfileForm />);
    const section = screen.getByTestId('optional-section');
    // Q18 trigger (optional) should not appear in the section container
    expect(
      within(section).queryByText(/Why are you doing this now/i),
    ).not.toBeInTheDocument();
  });

  it('clicking "Show more" reveals optional questions inside the optional section', () => {
    render(<ProfileForm />);
    fireEvent.click(screen.getByRole('button', { name: /show more/i }));
    const section = screen.getByTestId('optional-section');
    expect(
      within(section).getByText(/Why are you doing this now/i),
    ).toBeInTheDocument();
  });

  it('renders AdditionalContext at the bottom', () => {
    render(<ProfileForm />);
    expect(
      screen.getByText(/Anything else I should know about you\?/i),
    ).toBeInTheDocument();
  });

  it('submit button is disabled initially', () => {
    render(<ProfileForm />);
    const button = screen.getByRole('button', { name: /^submit$/i });
    expect(button).toBeDisabled();
  });

  it('loads draft from localStorage on mount', () => {
    localStorage.setItem(
      'frame:draft',
      JSON.stringify({
        version: 1,
        saved_at: '2026-04-08T00:00:00.000Z',
        input: {
          mode: 'explore',
          skills: ['Rust'],
          time_per_week: '10',
          money_available: 'lt_500',
          ambition: 'side_project',
        },
      }),
    );
    render(<ProfileForm />);
    // After load, the skills tag should be visible
    expect(screen.getByText('Rust')).toBeInTheDocument();
  });

  it('typing in a field calls saveDraft', async () => {
    const spy = vi.spyOn(clientState, 'saveDraft');
    render(<ProfileForm />);
    fireEvent.click(screen.getByRole('radio', { name: /help me find ideas/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it('clicking help opens the chat drawer', () => {
    render(<ProfileForm />);
    const helpButtons = screen.getAllByRole('button', { name: /💬 Help/i });
    fireEvent.click(helpButtons[0]!);
    // The drawer heading is the question label; hide by role "dialog"
    expect(screen.getByRole('dialog', { name: /field help/i })).toBeInTheDocument();
  });

  it('submits and shows success message when all required filled and fetch resolves', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        mode: 'explore',
        existing_idea: null,
        profile: { profile_hash: 'abcdef1234567890' },
        narrative: { prose: 'p', word_count: 1, generated_at: '2026-04-08T00:00:00.000Z' },
        directives: {},
        debug: { trace: [], cost_usd: 0, generated_at: '2026-04-08T00:00:00.000Z' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    render(<ProfileForm />);
    // Explore mode
    fireEvent.click(screen.getByRole('radio', { name: /help me find ideas/i }));
    // Q1 skills
    const skillInput = screen.getByPlaceholderText(/add tag/i);
    fireEvent.change(skillInput, { target: { value: 'React' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });
    // Q2 time
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: '10' } });
    // Q3 money
    fireEvent.change(screen.getAllByRole('combobox')[1]!, { target: { value: 'lt_500' } });
    // Q4 ambition
    fireEvent.click(
      screen.getByRole('radio', { name: /A side project/i }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^submit$/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/profile_hash/i)).toBeInTheDocument(),
    );
  });

  it('shows error message when submit fetch fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'llm_failed' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    render(<ProfileForm />);
    // Fill required
    fireEvent.click(screen.getByRole('radio', { name: /help me find ideas/i }));
    const skillInput = screen.getByPlaceholderText(/add tag/i);
    fireEvent.change(skillInput, { target: { value: 'React' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: '10' } });
    fireEvent.change(screen.getAllByRole('combobox')[1]!, { target: { value: 'lt_500' } });
    fireEvent.click(
      screen.getByRole('radio', { name: /A side project/i }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^submit$/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    );
  });
});
