'use client';

import { useEffect, useState, type ReactElement } from 'react';
import type { Question } from '../../pipeline/frame/questions';

export type ChatAssistDrawerProps = {
  open: boolean;
  question: Question | null;
  currentInput: Record<string, unknown>;
  sessionId: string;
  onClose: () => void;
  onApply: (value: unknown) => void;
};

type Message = { role: 'user' | 'assistant'; content: string };

type DrawerState = {
  messages: Message[];
  input: string;
  loading: boolean;
  error: 'rate_limited' | 'server_error' | null;
};

const INITIAL_STATE: DrawerState = {
  messages: [],
  input: '',
  loading: false,
  error: null,
};

/**
 * POST the user's message to /api/frame/field-help and return the
 * assistant reply or an error category. Separated from the component
 * so state updates stay linear inside the effect.
 */
async function requestFieldHelp(
  question: Question,
  userMessage: string,
  currentInput: Record<string, unknown>,
  sessionId: string,
): Promise<{ ok: true; message: string } | { ok: false; kind: 'rate_limited' | 'server_error' }> {
  try {
    const response = await fetch('/api/frame/field-help', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: question.id,
        userMessage,
        currentInput,
        sessionId,
      }),
    });
    if (response.status === 429) return { ok: false, kind: 'rate_limited' };
    if (!response.ok) return { ok: false, kind: 'server_error' };
    const data = (await response.json()) as { message: string };
    return { ok: true, message: data.message };
  } catch {
    return { ok: false, kind: 'server_error' };
  }
}

/** Attach a window Escape listener that calls onClose; clean up on unmount. */
function useEscapeKey(enabled: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled, onClose]);
}

/** Render a single chat message bubble with an optional apply button. */
function MessageBubble({
  message,
  onApply,
}: {
  message: Message;
  onApply?: (content: string) => void;
}): ReactElement {
  const align = message.role === 'user' ? 'text-right' : 'text-left';
  return (
    <div className={`mb-2 ${align}`}>
      <div className="inline-block bg-gray-100 rounded px-2 py-1 max-w-[80%]">
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.role === 'assistant' && onApply && (
          <button
            type="button"
            className="text-xs text-blue-700 mt-1"
            onClick={() => onApply(message.content)}
          >
            Use this answer
          </button>
        )}
      </div>
    </div>
  );
}

/** Render the error banner line when a request fails. */
function ErrorBanner({ kind }: { kind: 'rate_limited' | 'server_error' }): ReactElement {
  const text =
    kind === 'rate_limited'
      ? 'Too many requests — please wait a moment'
      : 'Something went wrong — try again';
  return (
    <div className="text-red-700 text-sm mb-2" role="alert">
      {text}
    </div>
  );
}

/**
 * Slide-over drawer UI for per-field LLM chat assist. Manages its own
 * local state (messages, input, loading, error) and posts to
 * /api/frame/field-help when the user clicks Send. Closes on Escape
 * key, backdrop click, or when onApply is called.
 */
export function ChatAssistDrawer({
  open,
  question,
  currentInput,
  sessionId,
  onClose,
  onApply,
}: ChatAssistDrawerProps): ReactElement | null {
  const [state, setState] = useState<DrawerState>(INITIAL_STATE);
  useEscapeKey(open && question !== null, onClose);
  if (!open || question === null) return null;

  const handleSend = async (): Promise<void> => {
    if (state.input.trim().length === 0) return;
    const userMsg: Message = { role: 'user', content: state.input.trim() };
    setState((s) => ({
      ...s,
      messages: [...s.messages, userMsg],
      input: '',
      loading: true,
      error: null,
    }));
    const result = await requestFieldHelp(question, userMsg.content, currentInput, sessionId);
    setState((s) => {
      if (!result.ok) return { ...s, loading: false, error: result.kind };
      return {
        ...s,
        loading: false,
        error: null,
        messages: [...s.messages, { role: 'assistant', content: result.message }],
      };
    });
  };

  const handleApply = (content: string): void => {
    onApply(content);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        data-testid="chat-drawer-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Field help chat"
        className="absolute right-0 top-0 h-full w-96 bg-white shadow-xl flex flex-col"
      >
        <header className="border-b p-4">
          <h2 className="font-bold text-lg">{question.label}</h2>
          <p className="text-sm text-gray-600">{question.hint}</p>
        </header>
        <div className="flex-1 overflow-auto p-4">
          {state.messages.length === 0 ? (
            <p className="text-gray-500">No messages yet</p>
          ) : (
            state.messages.map((m, i) => (
              <MessageBubble
                key={`${m.role}-${i}`}
                message={m}
                onApply={m.role === 'assistant' ? handleApply : undefined}
              />
            ))
          )}
          {state.error && <ErrorBanner kind={state.error} />}
        </div>
        <footer className="border-t p-4 flex gap-2">
          <input
            type="text"
            className="flex-1 border rounded px-2 py-1"
            value={state.input}
            disabled={state.loading}
            onChange={(e) => setState((s) => ({ ...s, input: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !state.loading) void handleSend();
            }}
          />
          <button
            type="button"
            className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={state.loading}
            onClick={() => void handleSend()}
          >
            {state.loading ? 'Thinking...' : 'Send'}
          </button>
        </footer>
      </aside>
    </div>
  );
}
