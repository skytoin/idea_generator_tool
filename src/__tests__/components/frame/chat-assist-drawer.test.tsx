import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatAssistDrawer } from '../../../components/frame/chat-assist-drawer';
import type { Question } from '../../../pipeline/frame/questions';

/** Build a minimal question suitable for every drawer test. */
function buildQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'Q_DRAWER',
    label: 'Drawer label',
    hint: 'Drawer hint',
    inputType: 'text',
    profileField: 'trigger',
    required: false,
    ...overrides,
  } as Question;
}

describe('ChatAssistDrawer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render when open=false', () => {
    const { container } = render(
      <ChatAssistDrawer
        open={false}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="sess-1"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('does not render when question=null', () => {
    const { container } = render(
      <ChatAssistDrawer
        open={true}
        question={null}
        currentInput={{}}
        sessionId="sess-1"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders question label in heading', () => {
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion({ label: 'What are your skills?' })}
        currentInput={{}}
        sessionId="sess-1"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/What are your skills\?/)).toBeInTheDocument();
  });

  it('renders placeholder when no messages', () => {
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="sess-1"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/No messages yet/i)).toBeInTheDocument();
  });

  it('typing and clicking Send POSTs to /api/frame/field-help with correct body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Try React + Zod', suggested_value: 'React + Zod' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion({ id: 'Q_X' })}
        currentInput={{ skills: ['Rust'] }}
        sessionId="sess-42"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'help me' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const call = mockFetch.mock.calls[0];
    expect(call?.[0]).toBe('/api/frame/field-help');
    const body = JSON.parse(call?.[1]?.body as string);
    expect(body).toEqual({
      questionId: 'Q_X',
      userMessage: 'help me',
      currentInput: { skills: ['Rust'] },
      sessionId: 'sess-42',
    });
  });

  it('renders assistant message after successful fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Try Next.js + Tailwind',
        suggested_value: 'Next.js + Tailwind',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="s"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText(/Try Next\.js \+ Tailwind/)).toBeInTheDocument(),
    );
  });

  it('clicking "Use this answer" fires onApply with suggested_value and onClose', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Go with this',
        suggested_value: 'the structured value',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="s"
        onClose={onClose}
        onApply={onApply}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ask' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/Go with this/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /use this answer/i }));
    expect(onApply).toHaveBeenCalledWith('the structured value');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render "Use this answer" when suggested_value is null', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: 'This field is where you describe X.',
        suggested_value: null,
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="s"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'what does this mean?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText(/where you describe X/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /use this answer/i })).toBeNull();
  });

  it('Escape key fires onClose', () => {
    const onClose = vi.fn();
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="s"
        onClose={onClose}
        onApply={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking backdrop fires onClose', () => {
    const onClose = vi.fn();
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="s"
        onClose={onClose}
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-drawer-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('429 response shows rate-limit message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate_limited', retry_after_ms: 60000 }),
    });
    vi.stubGlobal('fetch', mockFetch);
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="s"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText(/Too many requests/i)).toBeInTheDocument(),
    );
  });

  it('500 response shows generic error message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'llm_failed' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="s"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument(),
    );
  });

  it('Send button disabled during in-flight request and shows Thinking...', async () => {
    const deferred = {
      resolve: null as ((value: unknown) => void) | null,
    };
    const pending = new Promise((resolve) => {
      deferred.resolve = resolve as (value: unknown) => void;
    });
    const mockFetch = vi.fn().mockReturnValue(pending);
    vi.stubGlobal('fetch', mockFetch);
    render(
      <ChatAssistDrawer
        open={true}
        question={buildQuestion()}
        currentInput={{}}
        sessionId="s"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /thinking/i })).toBeDisabled();
    });
    deferred.resolve?.({
      ok: true,
      status: 200,
      json: async () => ({ message: 'done', suggested_value: 'done' }),
    });
    await waitFor(() => expect(screen.getByText(/done/)).toBeInTheDocument());
  });
});
