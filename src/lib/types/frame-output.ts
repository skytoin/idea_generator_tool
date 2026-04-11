import { z } from 'zod';
import { FOUNDER_PROFILE_SCHEMA } from './founder-profile';
import { FOUNDER_NARRATIVE_SCHEMA } from './founder-narrative';
import { SCANNER_DIRECTIVES_SCHEMA } from './scanner-directives';
import { SCANNER_REPORT_SCHEMA } from './scanner-report';

/**
 * Complete output of the Frame step — the canonical payload consumed
 * by every downstream pipeline stage. Combines structured profile,
 * prose narrative, per-scanner directives, debug metadata, and the
 * optional per-scanner reports attached by Layer 2 runs (tech_scout
 * today; more scanners in the future).
 */
export const FRAME_OUTPUT_SCHEMA = z.object({
  mode: z.enum(['explore', 'refine', 'open_direction']),
  existing_idea: z.object({ description: z.string() }).nullable(),
  profile: FOUNDER_PROFILE_SCHEMA,
  narrative: FOUNDER_NARRATIVE_SCHEMA,
  directives: SCANNER_DIRECTIVES_SCHEMA,
  debug: z.object({
    trace: z.array(z.object({ field: z.string(), consumer: z.string() })),
    cost_usd: z.number().nonnegative(),
    generated_at: z.string().datetime(),
  }),
  scanners: z
    .object({
      tech_scout: SCANNER_REPORT_SCHEMA.optional(),
    })
    .optional(),
});

export type FrameOutput = z.infer<typeof FRAME_OUTPUT_SCHEMA>;
