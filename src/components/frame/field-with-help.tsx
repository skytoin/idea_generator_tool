'use client';

import { useState, type ReactElement, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Question } from '../../pipeline/frame/questions';

export type FieldWithHelpProps = {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
  onRequestHelp: (questionId: string) => void;
  /** When true, disable the input and show 'Filling...' spinner label. */
  filling?: boolean;
  onCancelFill?: () => void;
};

type DomainEntry = { area: string; years: number | null };

/** Type guard: narrow `value` to an array of strings, defaulting to empty. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === 'string') as string[]) : [];
}

/** Type guard: narrow `value` to an array of domain entries, defaulting to empty. */
function asDomainArray(value: unknown): DomainEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is DomainEntry =>
      v !== null &&
      typeof v === 'object' &&
      typeof (v as DomainEntry).area === 'string',
  );
}

/** Render a single-line text input that is always controlled by `value` as string. */
function renderTextInput(
  question: Question,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
  onCancelFill: (() => void) | undefined,
): ReactElement {
  const str = typeof value === 'string' ? value : '';
  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (disabled) {
      onCancelFill?.();
      return;
    }
    onChange(e.target.value);
  };
  return (
    <input
      type="text"
      className="border rounded px-2 py-1 w-full"
      value={str}
      disabled={disabled}
      placeholder={question.placeholder ?? ''}
      onChange={handleChange}
    />
  );
}

/** Render a multi-line textarea controlled by `value` as string. */
function renderTextarea(
  question: Question,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
  onCancelFill: (() => void) | undefined,
): ReactElement {
  const str = typeof value === 'string' ? value : '';
  return (
    <textarea
      className="border rounded px-2 py-1 w-full"
      rows={4}
      value={str}
      disabled={disabled}
      placeholder={question.placeholder ?? ''}
      onClick={() => disabled && onCancelFill?.()}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
    />
  );
}

/** Render a <select> with an option per question.options entry. */
function renderSelect(
  question: Question,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
): ReactElement {
  const options = question.options ?? [];
  const str = typeof value === 'string' ? value : '';
  return (
    <select
      className="border rounded px-2 py-1"
      value={str}
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
    >
      <option value="">-- select --</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** Render a group of radio inputs, one per question.options entry. */
function renderRadio(
  question: Question,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
): ReactElement {
  const options = question.options ?? [];
  const str = typeof value === 'string' ? value : '';
  return (
    <div className="flex flex-col gap-1">
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2">
          <input
            type="radio"
            name={question.id}
            value={opt.value}
            checked={str === opt.value}
            disabled={disabled}
            onChange={() => onChange(opt.value)}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Render a single tag chip with a × remove button. */
function renderTagChip(
  tag: string,
  onRemove: () => void,
  disabled: boolean,
): ReactElement {
  return (
    <span
      key={tag}
      className="inline-flex items-center gap-1 bg-gray-200 rounded px-2 py-0.5 text-sm"
    >
      {tag}
      <button
        type="button"
        aria-label={`remove ${tag}`}
        className="ml-1"
        disabled={disabled}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}

/** Render a tags widget: chip list + free-text input, Enter to add, Backspace to remove last. */
function renderTags(
  question: Question,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
  draft: string,
  setDraft: (s: string) => void,
): ReactElement {
  const tags = asStringArray(value);
  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && draft.trim().length > 0) {
      e.preventDefault();
      onChange([...tags, draft.trim()]);
      setDraft('');
    } else if (e.key === 'Backspace' && draft.length === 0 && tags.length > 0) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };
  return (
    <div className="flex flex-wrap gap-1 border rounded p-2">
      {tags.map((tag) => renderTagChip(tag, () => onChange(tags.filter((t) => t !== tag)), disabled))}
      <input
        type="text"
        className="flex-1 outline-none min-w-[120px]"
        value={draft}
        placeholder={`add ${question.inputType === 'tags' ? 'tag' : 'item'}…`}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
      />
    </div>
  );
}

/** Render a single domain-duration chip displaying "area (Nyrs)". */
function renderDomainChip(
  entry: DomainEntry,
  onRemove: () => void,
  disabled: boolean,
): ReactElement {
  const years = entry.years === null ? '?' : String(entry.years);
  return (
    <span
      key={entry.area}
      className="inline-flex items-center gap-1 bg-gray-200 rounded px-2 py-0.5 text-sm"
    >
      {entry.area} ({years}yrs)
      <button
        type="button"
        aria-label={`remove ${entry.area}`}
        className="ml-1"
        disabled={disabled}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}

/** Render a tags_with_duration widget: chip list + area + years inputs. */
function renderTagsWithDuration(
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
  draftArea: string,
  setDraftArea: (s: string) => void,
  draftYears: string,
  setDraftYears: (s: string) => void,
): ReactElement {
  const entries = asDomainArray(value);
  const addEntry = (): void => {
    if (draftArea.trim().length === 0) return;
    const years = draftYears.trim().length > 0 ? Number(draftYears) : null;
    const next: DomainEntry = {
      area: draftArea.trim(),
      years: years !== null && Number.isFinite(years) ? years : null,
    };
    onChange([...entries, next]);
    setDraftArea('');
    setDraftYears('');
  };
  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntry();
    }
  };
  return (
    <div className="flex flex-col gap-1 border rounded p-2">
      <div className="flex flex-wrap gap-1">
        {entries.map((entry) =>
          renderDomainChip(
            entry,
            () => onChange(entries.filter((e) => e.area !== entry.area)),
            disabled,
          ),
        )}
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          className="flex-1 border rounded px-2 py-1"
          placeholder="area"
          value={draftArea}
          disabled={disabled}
          onChange={(e) => setDraftArea(e.target.value)}
          onKeyDown={handleKey}
        />
        <input
          type="number"
          className="w-20 border rounded px-2 py-1"
          placeholder="years"
          value={draftYears}
          disabled={disabled}
          onChange={(e) => setDraftYears(e.target.value)}
        />
      </div>
    </div>
  );
}

/** Render the preset+custom chips widget used for anti_targets and similar fields. */
function renderChips(
  question: Question,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
  draft: string,
  setDraft: (s: string) => void,
): ReactElement {
  const selected = asStringArray(value);
  const examples = question.examples ?? [];
  const allPresets = Array.from(new Set([...examples, ...selected]));
  const toggle = (chip: string): void => {
    if (selected.includes(chip)) {
      onChange(selected.filter((c) => c !== chip));
    } else {
      onChange([...selected, chip]);
    }
  };
  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && draft.trim().length > 0) {
      e.preventDefault();
      if (!selected.includes(draft.trim())) onChange([...selected, draft.trim()]);
      setDraft('');
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {allPresets.map((chip) => {
          const on = selected.includes(chip);
          return (
            <button
              key={chip}
              type="button"
              className={`px-2 py-0.5 rounded text-sm border ${on ? 'bg-blue-200 border-blue-400' : 'bg-white'}`}
              disabled={disabled}
              onClick={() => toggle(chip)}
            >
              {chip}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        className="border rounded px-2 py-1"
        value={draft}
        placeholder="add custom chip…"
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
      />
    </div>
  );
}

/**
 * Render a single question's label, hint, input widget, and help button.
 * Dispatches on question.inputType to the appropriate renderer; handles
 * filling state (disables input, shows placeholder, cancels on interaction).
 */
export function FieldWithHelp({
  question,
  value,
  onChange,
  onRequestHelp,
  filling = false,
  onCancelFill,
}: FieldWithHelpProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [draftArea, setDraftArea] = useState('');
  const [draftYears, setDraftYears] = useState('');
  const disabled = filling;
  const input = dispatchInput({
    question,
    value,
    onChange,
    disabled,
    onCancelFill,
    draft,
    setDraft,
    draftArea,
    setDraftArea,
    draftYears,
    setDraftYears,
  });
  return (
    <div className="flex flex-col gap-1 mb-4">
      <div className="flex items-center gap-2">
        <label className="font-medium">{question.label}</label>
        <button
          type="button"
          className="text-sm text-blue-700"
          onClick={() => onRequestHelp(question.id)}
        >
          💬 Help
        </button>
        {filling && <span className="text-xs text-gray-500">Filling...</span>}
      </div>
      <p className="text-sm text-gray-600">{question.hint}</p>
      {input}
    </div>
  );
}

type DispatchArgs = {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  onCancelFill: (() => void) | undefined;
  draft: string;
  setDraft: (s: string) => void;
  draftArea: string;
  setDraftArea: (s: string) => void;
  draftYears: string;
  setDraftYears: (s: string) => void;
};

/** Dispatch input rendering based on question.inputType. */
function dispatchInput(args: DispatchArgs): ReactElement {
  const { question, value, onChange, disabled, onCancelFill } = args;
  switch (question.inputType) {
    case 'text':
      return renderTextInput(question, value, onChange, disabled, onCancelFill);
    case 'textarea':
      return renderTextarea(question, value, onChange, disabled, onCancelFill);
    case 'select':
      return renderSelect(question, value, onChange, disabled);
    case 'radio':
      return renderRadio(question, value, onChange, disabled);
    case 'tags':
      return renderTags(question, value, onChange, disabled, args.draft, args.setDraft);
    case 'tags_with_duration':
      return renderTagsWithDuration(
        value,
        onChange,
        disabled,
        args.draftArea,
        args.setDraftArea,
        args.draftYears,
        args.setDraftYears,
      );
    case 'chips':
      return renderChips(question, value, onChange, disabled, args.draft, args.setDraft);
    default:
      return <div>unsupported input type</div>;
  }
}
