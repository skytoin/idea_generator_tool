'use client';

import { useEffect, useState, type ReactElement } from 'react';
import type { FrameInput } from '../../lib/types/frame-input';
import { saveDraft, loadDraft } from '../../lib/frame/client-state';
import { QUESTIONS, type Question, type QuestionTarget } from '../../pipeline/frame/questions';
import { ModeSelector, type Mode } from './mode-selector';
import { FieldWithHelp } from './field-with-help';
import { AdditionalContext } from './additional-context';
import { ProfileProgress } from './profile-progress';
import { AssumptionPreview } from './assumption-preview';
import { ChatAssistDrawer } from './chat-assist-drawer';

type FormState = Partial<FrameInput>;

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; profileHash: string }
  | { kind: 'error'; message: string };

const REQUIRED_IDS = new Set(['Q1', 'Q2', 'Q3', 'Q4']);
const RECOMMENDED_IDS = new Set(['Q5', 'Q6', 'Q7']);
const OPTIONAL_IDS = new Set([
  'Q8',
  'Q9',
  'Q10',
  'Q11',
  'Q12',
  'Q13',
  'Q14',
  'Q15',
  'Q16',
  'Q17',
  'Q18',
  'Q19',
]);

/** Load any persisted draft on mount and commit it to the form state. */
function useDraftLoad(setInput: (input: FormState) => void): void {
  useEffect(() => {
    const draft = loadDraft();
    if (draft !== null) setInput(draft);
  }, [setInput]);
}

/** Debounceless save-on-change effect — saveDraft is cheap and idempotent. */
function useDraftSave(input: FormState): void {
  useEffect(() => {
    saveDraft(input);
  }, [input]);
}

/** Read the value for a given question from form state by its profileField. */
function readValue(input: FormState, question: Question): unknown {
  const field = question.profileField as keyof FormState | 'mode' | 'existing_idea' | 'additional_context';
  if (field === 'mode') return input.mode;
  if (field === 'existing_idea') return input.existing_idea;
  if (field === 'additional_context') return input.additional_context;
  return input[field as keyof FormState];
}

/** Write a new value for a given question into form state by its profileField. */
function writeValue(
  input: FormState,
  question: Question,
  value: unknown,
): FormState {
  const field = question.profileField as QuestionTarget;
  return { ...input, [field]: value };
}

/**
 * Return true when the form state has all 5 required fields filled. Used to
 * enable/disable the submit button at the bottom of the intake page.
 */
function isSubmittable(input: FormState): boolean {
  if (input.mode === undefined) return false;
  if (input.mode !== 'explore') {
    if (!input.existing_idea || input.existing_idea.trim().length === 0) return false;
  }
  if (!Array.isArray(input.skills) || input.skills.length === 0) return false;
  if (!input.time_per_week) return false;
  if (!input.money_available) return false;
  if (!input.ambition) return false;
  return true;
}

type GroupProps = {
  ids: Set<string>;
  input: FormState;
  onChange: (q: Question, v: unknown) => void;
  onRequestHelp: (q: Question) => void;
};

/** Render a slice of QUESTIONS filtered by a given id set. */
function QuestionGroup({ ids, input, onChange, onRequestHelp }: GroupProps): ReactElement {
  return (
    <div>
      {QUESTIONS.filter((q) => ids.has(q.id)).map((q) => (
        <FieldWithHelp
          key={q.id}
          question={q}
          value={readValue(input, q)}
          onChange={(v) => onChange(q, v)}
          onRequestHelp={() => onRequestHelp(q)}
        />
      ))}
    </div>
  );
}

/** Render the optional question group with a show/hide toggle. */
function OptionalSection({
  expanded,
  setExpanded,
  input,
  onChange,
  onRequestHelp,
}: {
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  input: FormState;
  onChange: (q: Question, v: unknown) => void;
  onRequestHelp: (q: Question) => void;
}): ReactElement {
  return (
    <div className="mb-4">
      <button
        type="button"
        className="text-blue-700"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
      {expanded && (
        <QuestionGroup
          ids={OPTIONAL_IDS}
          input={input}
          onChange={onChange}
          onRequestHelp={onRequestHelp}
        />
      )}
    </div>
  );
}

/** POST current form state to /api/frame/extract and return the new SubmitState. */
async function submitForm(input: FormState): Promise<SubmitState> {
  try {
    const response = await fetch('/api/frame/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) return { kind: 'error', message: 'Something went wrong' };
    const data = (await response.json()) as {
      profile: { profile_hash: string };
    };
    return { kind: 'success', profileHash: data.profile.profile_hash };
  } catch {
    return { kind: 'error', message: 'Something went wrong' };
  }
}

/** Render the submit status banner (success or error). */
function SubmitBanner({ state }: { state: SubmitState }): ReactElement | null {
  if (state.kind === 'success') {
    return (
      <div className="bg-green-100 border border-green-400 text-green-900 rounded p-3 mb-2">
        <p>
          Success! profile_hash: <code>{state.profileHash}</code>
        </p>
        <a
          href={`/debug/frame?hash=${state.profileHash}`}
          className="text-blue-700 underline"
        >
          View debug output
        </a>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div
        role="alert"
        className="bg-red-100 border border-red-400 text-red-900 rounded p-3 mb-2"
      >
        {state.message}
      </div>
    );
  }
  return null;
}

type DrawerState = {
  open: boolean;
  question: Question | null;
};

/**
 * Build a stable sessionId the first time the form mounts. Uses a lazy
 * initializer in useState so Math.random is only called once, and only
 * on the client. Starts empty during SSR, then hydrates on mount.
 */
function useSessionId(): string {
  const [sessionId] = useState<string>(() => {
    if (typeof globalThis === 'undefined') return '';
    return `session-${Math.random().toString(36).slice(2, 10)}`;
  });
  return sessionId;
}

/**
 * ProfileForm — main container for the Frame intake page. Owns the
 * Partial<FrameInput> state, auto-saves it to localStorage, renders
 * all question sections, and handles submit to /api/frame/extract.
 * Opens the ChatAssistDrawer when the user clicks a field's help button.
 */
export function ProfileForm(): ReactElement {
  const [input, setInput] = useState<FormState>({});
  const [expanded, setExpanded] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>({ open: false, question: null });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' });
  const sessionId = useSessionId();
  useDraftLoad(setInput);
  useDraftSave(input);

  const onChangeQuestion = (q: Question, v: unknown): void => {
    setInput((prev) => writeValue(prev, q, v));
  };

  const onRequestHelp = (q: Question): void => {
    setDrawer({ open: true, question: q });
  };

  const onApplyFromDrawer = (value: unknown): void => {
    if (drawer.question === null) return;
    setInput((prev) => writeValue(prev, drawer.question as Question, value));
  };

  const onSubmit = async (): Promise<void> => {
    setSubmitState({ kind: 'loading' });
    const result = await submitForm(input);
    setSubmitState(result);
  };

  const onFocusField = (fieldId: string): void => {
    const el = document.getElementById(`field-${fieldId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <ProfileProgress input={input} />
      <ModeSelector
        mode={(input.mode as Mode) ?? null}
        existingIdea={input.existing_idea ?? ''}
        onModeChange={(m) => setInput((prev) => ({ ...prev, mode: m }))}
        onExistingIdeaChange={(v) => setInput((prev) => ({ ...prev, existing_idea: v }))}
      />
      <h3 className="font-bold text-lg mt-4 mb-1">Required</h3>
      <div data-testid="required-section">
        <QuestionGroup
          ids={REQUIRED_IDS}
          input={input}
          onChange={onChangeQuestion}
          onRequestHelp={onRequestHelp}
        />
      </div>
      <h3 className="font-bold text-lg mt-4 mb-1">Recommended</h3>
      <div data-testid="recommended-section">
        <QuestionGroup
          ids={RECOMMENDED_IDS}
          input={input}
          onChange={onChangeQuestion}
          onRequestHelp={onRequestHelp}
        />
      </div>
      <h3 className="font-bold text-lg mt-4 mb-1">Optional</h3>
      <div data-testid="optional-section">
        <OptionalSection
          expanded={expanded}
          setExpanded={setExpanded}
          input={input}
          onChange={onChangeQuestion}
          onRequestHelp={onRequestHelp}
        />
      </div>
      <AdditionalContext
        value={input.additional_context ?? ''}
        onChange={(v) => setInput((prev) => ({ ...prev, additional_context: v }))}
      />
      <AssumptionPreview
        input={input}
        onFocusField={onFocusField}
        onAccept={() => {
          /* no-op: assumptions will be applied server-side */
        }}
      />
      <SubmitBanner state={submitState} />
      <button
        type="button"
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        disabled={!isSubmittable(input) || submitState.kind === 'loading'}
        onClick={() => void onSubmit()}
      >
        Submit
      </button>
      <ChatAssistDrawer
        open={drawer.open}
        question={drawer.question}
        currentInput={input as Record<string, unknown>}
        sessionId={sessionId}
        onClose={() => setDrawer({ open: false, question: null })}
        onApply={onApplyFromDrawer}
      />
    </div>
  );
}
