'use client';

import type { ReactElement } from 'react';
import type { FrameInput } from '../../lib/types/frame-input';

export type ProfileProgressProps = {
  input: Partial<FrameInput>;
};

const RECOMMENDED_FIELDS = ['domain', 'insider_knowledge', 'anti_targets'] as const;

const OPTIONAL_FIELDS = [
  'network',
  'audience',
  'proprietary_access',
  'rare_combinations',
  'recurring_frustration',
  'four_week_mvp',
  'previous_attempts',
  'customer_affinity',
  'time_to_revenue',
  'customer_type_preference',
  'trigger',
  'legal_constraints',
] as const;

/** Return whether a Partial<FrameInput> field is truthy enough to count as filled. */
function isFilled(input: Partial<FrameInput>, key: keyof FrameInput): boolean {
  const v = input[key];
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

/** Compute the number of the 5 required fields that are filled. */
function countRequired(input: Partial<FrameInput>): number {
  let count = 0;
  const mode = input.mode;
  if (mode !== undefined) {
    if (mode === 'explore') count += 1;
    else if (
      input.existing_idea !== undefined &&
      input.existing_idea.trim().length > 0
    )
      count += 1;
  }
  if (isFilled(input, 'skills')) count += 1;
  if (isFilled(input, 'time_per_week')) count += 1;
  if (isFilled(input, 'money_available')) count += 1;
  if (isFilled(input, 'ambition')) count += 1;
  return count;
}

/** Count recommended fields filled (domain, insider_knowledge, anti_targets). */
function countRecommended(input: Partial<FrameInput>): number {
  return RECOMMENDED_FIELDS.filter((f) => isFilled(input, f)).length;
}

/** Count optional fields filled. */
function countOptional(input: Partial<FrameInput>): number {
  return OPTIONAL_FIELDS.filter((f) => isFilled(input, f)).length;
}

/** Render the progress bar div with a computed fill width. */
function ProgressBar({ value, total }: { value: number; total: number }): ReactElement {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className="h-2 bg-gray-200 rounded" aria-label="progress">
      <div className="h-2 bg-blue-600 rounded" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Sticky top-bar summarizing required/recommended/optional progress.
 * Counts mode as "filled" only when mode is 'explore' OR mode is
 * refine/open_direction with a non-empty existing_idea.
 */
export function ProfileProgress({ input }: ProfileProgressProps): ReactElement {
  const required = countRequired(input);
  const recommended = countRecommended(input);
  const optional = countOptional(input);
  const ready = required === 5;
  return (
    <div className="sticky top-0 bg-white border-b p-2 z-10">
      <div className="flex items-center justify-between">
        <p>{required} of 5 required filled</p>
        {ready && (
          <span className="bg-green-200 text-green-900 px-2 py-0.5 rounded text-sm">
            Pipeline ready ✓
          </span>
        )}
      </div>
      <ProgressBar value={required} total={5} />
      <p className="text-sm text-gray-600">
        {recommended} of 3 recommended filled · Optional: {optional} of 12 filled
      </p>
    </div>
  );
}
