import { err, ok, type Result } from '../../lib/utils/result';
import {
  FOUNDER_PROFILE_SCHEMA,
  type FounderProfile,
  type FounderProfileField,
} from '../../lib/types/founder-profile';

export type ProfileBuilder = Partial<FounderProfile>;

export type ValidationError = {
  kind: 'missing_required';
  missingFields: FounderProfileField[];
};

const REQUIRED_FIELDS: FounderProfileField[] = [
  'skills',
  'time_per_week',
  'money_available',
  'ambition',
];

/**
 * Documented assumption defaults — the value each optional field takes on
 * when neither the form nor the extraction step provided it. Exported for
 * debug/UI use so the same source of truth feeds both the filler and any
 * "you haven't told us X, we're assuming Y" UI copy.
 */
export const ASSUMED_DEFAULTS = {
  domain: { value: [] as Array<{ area: string; years: number | null }>, source: 'assumed' },
  insider_knowledge: { value: null, source: 'assumed' },
  anti_targets: { value: [] as string[], source: 'assumed' },
  network: { value: null, source: 'assumed' },
  audience: { value: null, source: 'assumed' },
  proprietary_access: { value: null, source: 'assumed' },
  rare_combinations: { value: null, source: 'assumed' },
  recurring_frustration: { value: null, source: 'assumed' },
  four_week_mvp: { value: null, source: 'assumed' },
  previous_attempts: { value: null, source: 'assumed' },
  customer_affinity: { value: null, source: 'assumed' },
  time_to_revenue: { value: 'no_preference', source: 'assumed' },
  customer_type_preference: { value: 'no_preference', source: 'assumed' },
  trigger: { value: null, source: 'assumed' },
  legal_constraints: { value: null, source: 'assumed' },
} as const;

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

/**
 * Return the value of `field` from the builder if present, otherwise
 * the documented default entry from ASSUMED_DEFAULTS. Existing stated or
 * inferred tags are preserved untouched.
 */
function fillField<K extends OptionalField>(
  builder: ProfileBuilder,
  field: K,
): FounderProfile[K] {
  const existing = builder[field];
  if (existing !== undefined) return existing as FounderProfile[K];
  return ASSUMED_DEFAULTS[field] as unknown as FounderProfile[K];
}

/**
 * Return the list of required fields missing from the builder. A field
 * counts as present only when the entire tagged object is defined.
 */
function findMissingRequired(builder: ProfileBuilder): FounderProfileField[] {
  return REQUIRED_FIELDS.filter((field) => builder[field] === undefined);
}

/**
 * Build the candidate profile object pre-validation, merging required fields
 * from the builder with optional fields filled from ASSUMED_DEFAULTS.
 */
function buildCandidate(
  builder: ProfileBuilder,
  rawContext: string,
  profileHash: string,
): unknown {
  const optional: Record<string, unknown> = {};
  for (const field of OPTIONAL_FIELDS) {
    optional[field] = fillField(builder, field);
  }
  return {
    skills: builder.skills,
    time_per_week: builder.time_per_week,
    money_available: builder.money_available,
    ambition: builder.ambition,
    ...optional,
    additional_context_raw: rawContext,
    schema_version: 1 as const,
    profile_hash: profileHash,
  };
}

/**
 * Fills empty optional fields with documented `assumed` defaults.
 * - Never overwrites fields already tagged `stated` or `inferred`.
 * - Returns err if any required field is missing.
 * - Sets metadata (schema_version, profile_hash, additional_context_raw).
 */
export function applyAssumptions(
  builder: ProfileBuilder,
  rawContext: string,
  profileHash: string,
): Result<FounderProfile, ValidationError> {
  const missing = findMissingRequired(builder);
  if (missing.length > 0) {
    return err({ kind: 'missing_required', missingFields: missing });
  }
  const candidate = buildCandidate(builder, rawContext, profileHash);
  const parsed = FOUNDER_PROFILE_SCHEMA.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `applyAssumptions produced an invalid profile: ${parsed.error.message}`,
    );
  }
  return ok(parsed.data);
}
