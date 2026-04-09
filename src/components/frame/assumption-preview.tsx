'use client';

import type { ReactElement } from 'react';
import type { FrameInput } from '../../lib/types/frame-input';
import { ASSUMED_DEFAULTS } from '../../pipeline/frame/apply-assumptions';
import { QUESTIONS } from '../../pipeline/frame/questions';

export type AssumptionPreviewProps = {
  input: Partial<FrameInput>;
  onFocusField: (fieldId: string) => void;
  onAccept: () => void;
};

type OptionalField = keyof typeof ASSUMED_DEFAULTS;

const OPTIONAL_FIELDS: OptionalField[] = [
  'domain',
  'insider_knowledge',
  'anti_targets',
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
];

const QUALITY_CRITICAL: ReadonlySet<OptionalField> = new Set(['anti_targets', 'domain']);

/** Return true when the user has supplied a non-empty value for `field`. */
function isFieldFilled(field: OptionalField, input: Partial<FrameInput>): boolean {
  const value = input[field];
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/** Return the question id matching the given profileField, or the field name. */
function findQuestionIdFor(field: OptionalField): string {
  const question = QUESTIONS.find((q) => q.profileField === field);
  return question?.id ?? field;
}

/** Return the question label matching the given profileField, or the field name. */
function findQuestionLabelFor(field: OptionalField): string {
  const question = QUESTIONS.find((q) => q.profileField === field);
  return question?.label ?? field;
}

/** Human-readable display for the ASSUMED default value of a field. */
function displayDefault(field: OptionalField): string {
  const entry = ASSUMED_DEFAULTS[field];
  const value = entry.value;
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[]';
  if (typeof value === 'string') return `'${value}'`;
  return JSON.stringify(value);
}

/** Render a single row in the assumption preview table for an unset field. */
function AssumptionRow({
  field,
  onFocusField,
}: {
  field: OptionalField;
  onFocusField: (id: string) => void;
}): ReactElement {
  const id = findQuestionIdFor(field);
  const label = findQuestionLabelFor(field);
  const critical = QUALITY_CRITICAL.has(field);
  return (
    <tr data-testid="assumption-row" className="border-b">
      <td className="py-1 pr-2 align-top">
        <span className="font-medium">{label}</span>
        {critical && (
          <span className="ml-2 text-xs text-red-700">⚠️ quality-critical</span>
        )}
      </td>
      <td className="py-1 pr-2 font-mono text-sm">{displayDefault(field)}</td>
      <td className="py-1">
        <button
          type="button"
          className="text-sm text-blue-700"
          onClick={() => onFocusField(id)}
        >
          Fill me in
        </button>
      </td>
    </tr>
  );
}

/**
 * AssumptionPreview — shows the user which empty optional fields will
 * be filled with documented defaults before the pipeline runs. Flags
 * quality-critical fields with a warning marker, and offers "Fill me in"
 * jumps plus an "Accept all assumptions" button.
 */
export function AssumptionPreview({
  input,
  onFocusField,
  onAccept,
}: AssumptionPreviewProps): ReactElement {
  const unfilled = OPTIONAL_FIELDS.filter((f) => !isFieldFilled(f, input));
  if (unfilled.length === 0) {
    return (
      <section className="border rounded p-4 mb-4">
        <p className="text-green-700">All fields filled — ready to run.</p>
      </section>
    );
  }
  return (
    <section className="border rounded p-4 mb-4">
      <h2 className="font-bold text-lg mb-2">Assumption Preview</h2>
      <p className="text-sm text-gray-600 mb-2">
        These optional fields will be filled with defaults. Fill them in for better
        results.
      </p>
      <table className="w-full">
        <tbody>
          {unfilled.map((field) => (
            <AssumptionRow key={field} field={field} onFocusField={onFocusField} />
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="mt-3 px-4 py-2 bg-gray-200 rounded"
        onClick={onAccept}
      >
        Accept all assumptions
      </button>
    </section>
  );
}
