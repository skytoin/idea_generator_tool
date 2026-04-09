'use client';

import type { ReactElement, ChangeEvent } from 'react';

export type Mode = 'explore' | 'refine' | 'open_direction';

export type ModeSelectorProps = {
  mode: Mode | null;
  existingIdea: string;
  onModeChange: (mode: Mode) => void;
  onExistingIdeaChange: (idea: string) => void;
};

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'explore', label: 'Help me find ideas' },
  { value: 'refine', label: 'I have an idea — help me refine it' },
  { value: 'open_direction', label: "I have a rough direction but I'm open" },
];

/** Render the three radio options for mode selection. */
function renderRadioGroup(
  mode: Mode | null,
  onModeChange: (mode: Mode) => void,
): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {MODE_OPTIONS.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="frame-mode"
            value={opt.value}
            checked={mode === opt.value}
            onChange={() => onModeChange(opt.value)}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Render the existing_idea textarea shown when mode is refine/open_direction. */
function renderExistingIdea(
  existingIdea: string,
  onExistingIdeaChange: (idea: string) => void,
): ReactElement {
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    onExistingIdeaChange(e.target.value);
  };
  return (
    <div className="mt-4">
      <label className="block text-sm font-medium mb-1">
        Describe your idea or rough direction in a few sentences.
      </label>
      <textarea
        className="border rounded px-2 py-1 w-full"
        rows={4}
        value={existingIdea}
        placeholder="What is it, who is it for, and what problem does it solve?"
        onChange={handleChange}
      />
      {existingIdea.trim().length === 0 && (
        <p className="text-sm text-red-700 mt-1">Please describe your idea</p>
      )}
    </div>
  );
}

/**
 * ModeSelector — the first card on the intake page. Lets the user pick
 * between explore, refine, or open_direction, and reveals the
 * existing_idea textarea when a non-explore mode is picked.
 */
export function ModeSelector({
  mode,
  existingIdea,
  onModeChange,
  onExistingIdeaChange,
}: ModeSelectorProps): ReactElement {
  const showExistingIdea = mode === 'refine' || mode === 'open_direction';
  return (
    <section className="border rounded p-4 mb-4">
      <h2 className="font-bold text-lg">Mode</h2>
      <p className="text-sm text-gray-600 mb-2">
        Do you have a specific idea you want to develop, or do you want help finding ideas?
      </p>
      {renderRadioGroup(mode, onModeChange)}
      {showExistingIdea && renderExistingIdea(existingIdea, onExistingIdeaChange)}
    </section>
  );
}
