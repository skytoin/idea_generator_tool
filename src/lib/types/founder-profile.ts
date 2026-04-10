import { z } from 'zod';

export const CONFIDENCE = z.enum(['stated', 'inferred', 'assumed']);
export type Confidence = z.infer<typeof CONFIDENCE>;

/**
 * Controls how closely the downstream pipeline (generators, ranker) must
 * adhere to the founder's stated profile. `strict` = tightly constrained;
 * `wild` = allow surprising, profile-divergent ideas. See `questions.ts`
 * Q20 for the user-facing copy.
 */
export const DIVERGENCE_LEVEL = z.enum(['strict', 'balanced', 'adventurous', 'wild']);
export type DivergenceLevel = z.infer<typeof DIVERGENCE_LEVEL>;

/** Every profile field is { value, source } so confidence travels with data. */
const tagged = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ value: inner, source: CONFIDENCE });

/**
 * Canonical founder profile contract. Every downstream pipeline step
 * (narrative, scanners, generators) reads from this schema. Every field
 * carries a confidence source so later steps can weight stated vs assumed
 * information. Adding or removing fields here is a breaking change and
 * must be reflected in FIELD_COVERAGE.
 */
export const FOUNDER_PROFILE_SCHEMA = z.object({
  // Required
  skills: tagged(z.array(z.string().min(1)).min(1)),
  time_per_week: tagged(z.enum(['2', '5', '10', '20', '40'])),
  money_available: tagged(z.enum(['lt_500', 'lt_5k', 'lt_50k', 'more', 'no_limit'])),
  ambition: tagged(
    z.enum(['side_project', 'supplemental', 'replace_income', 'build_company', 'unsure']),
  ),

  // Recommended
  domain: tagged(z.array(z.object({ area: z.string(), years: z.number().nullable() }))),
  insider_knowledge: tagged(z.string().nullable()),
  anti_targets: tagged(z.array(z.string())),

  // Optional
  network: tagged(z.string().nullable()),
  audience: tagged(z.string().nullable()),
  proprietary_access: tagged(z.string().nullable()),
  rare_combinations: tagged(z.string().nullable()),
  recurring_frustration: tagged(z.string().nullable()),
  four_week_mvp: tagged(z.string().nullable()),
  previous_attempts: tagged(z.string().nullable()),
  customer_affinity: tagged(z.string().nullable()),
  time_to_revenue: tagged(
    z.enum(['2_weeks', '2_months', '6_months', '1_year_plus', 'no_preference']),
  ),
  customer_type_preference: tagged(z.enum(['b2b', 'b2c', 'both', 'no_preference'])),
  trigger: tagged(z.string().nullable()),
  legal_constraints: tagged(z.string().nullable()),

  // Strategy knob: how closely should generated ideas match the profile?
  divergence_level: tagged(DIVERGENCE_LEVEL),

  // Raw preservation
  additional_context_raw: z.string().max(5000),

  // Metadata
  schema_version: z.literal(1),
  profile_hash: z.string(),
});

export type FounderProfile = z.infer<typeof FOUNDER_PROFILE_SCHEMA>;

export type FounderProfileField = Exclude<
  keyof FounderProfile,
  'additional_context_raw' | 'schema_version' | 'profile_hash'
>;
