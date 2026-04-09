'use client';

import type { ReactElement, ChangeEvent } from 'react';

export type AdditionalContextProps = {
  value: string;
  onChange: (value: string) => void;
};

const MAX_CHARS = 5000;
const WARN_THRESHOLD = 4500;

/** Return a Tailwind class name for the char counter based on length. */
function counterClass(length: number): string {
  if (length >= MAX_CHARS) return 'text-red-700 error';
  if (length >= WARN_THRESHOLD) return 'text-amber-600 warn';
  return 'text-gray-500';
}

/**
 * Free-text "anything else" field at the bottom of the intake form.
 * Hard-caps at 5000 chars and shows a live char counter; anything typed
 * beyond 5000 is clamped before firing onChange.
 */
export function AdditionalContext({ value, onChange }: AdditionalContextProps): ReactElement {
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value;
    const clamped = next.length > MAX_CHARS ? next.slice(0, MAX_CHARS) : next;
    onChange(clamped);
  };
  return (
    <section className="border rounded p-4 mb-4">
      <h2 className="font-bold text-lg">Anything else I should know about you?</h2>
      <p className="text-sm text-gray-600 mb-1">
        This field is <strong>heavily weighted</strong>. The best ideas often come from quirky
        context that does not fit neat categories. Quirks, obsessions, weird constraints — anything.
      </p>
      <p className="text-sm text-amber-700 mb-2">
        ⚠️ This text is sent to an AI provider. Don&apos;t include anything you wouldn&apos;t
        want processed.
      </p>
      <textarea
        className="border rounded px-2 py-1 w-full"
        rows={6}
        placeholder="Write as much or as little as you want…"
        value={value}
        onChange={handleChange}
      />
      <div className={`text-right text-sm ${counterClass(value.length)}`}>
        {value.length} / {MAX_CHARS}
      </div>
    </section>
  );
}
