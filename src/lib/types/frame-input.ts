import { z } from 'zod';

/**
 * Raw input from the frame UI form before profile extraction.
 * This is what the user submits — unstructured strings and enums.
 * The Frame step converts this into a FounderProfile with confidence tagging.
 */
export const FRAME_INPUT_SCHEMA = z
  .object({
    mode: z.enum(['explore', 'refine', 'open_direction']),
    existing_idea: z.string().optional(),
    // Required
    skills: z.array(z.string().min(1)).min(1),
    time_per_week: z.enum(['2', '5', '10', '20', '40']),
    money_available: z.enum(['lt_500', 'lt_5k', 'lt_50k', 'more', 'no_limit']),
    ambition: z.enum([
      'side_project',
      'supplemental',
      'replace_income',
      'build_company',
      'unsure',
    ]),
    // Optional
    domain: z.array(z.object({ area: z.string(), years: z.number().nullable() })).optional(),
    insider_knowledge: z.string().optional(),
    anti_targets: z.array(z.string()).optional(),
    network: z.string().optional(),
    audience: z.string().optional(),
    proprietary_access: z.string().optional(),
    rare_combinations: z.string().optional(),
    recurring_frustration: z.string().optional(),
    four_week_mvp: z.string().optional(),
    previous_attempts: z.string().optional(),
    customer_affinity: z.string().optional(),
    time_to_revenue: z
      .enum(['2_weeks', '2_months', '6_months', '1_year_plus', 'no_preference'])
      .optional(),
    customer_type_preference: z.enum(['b2b', 'b2c', 'both', 'no_preference']).optional(),
    trigger: z.string().optional(),
    legal_constraints: z.string().optional(),
    divergence_level: z
      .enum(['strict', 'balanced', 'adventurous', 'wild'])
      .optional(),
    additional_context: z.string().max(5000).default(''),
  })
  .refine(
    (data) =>
      data.mode === 'explore' ||
      (data.existing_idea !== undefined && data.existing_idea.trim().length > 0),
    {
      message: 'existing_idea is required when mode is refine or open_direction',
      path: ['existing_idea'],
    },
  );

export type FrameInput = z.infer<typeof FRAME_INPUT_SCHEMA>;
