import { z } from 'zod';
import { FOUNDER_PROFILE_SCHEMA } from './founder-profile';
import { FOUNDER_NARRATIVE_SCHEMA } from './founder-narrative';
import { SCANNER_DIRECTIVES_SCHEMA } from './scanner-directives';

/**
 * Complete output of the Frame step — the canonical payload consumed
 * by every downstream pipeline stage. Combines structured profile,
 * prose narrative, per-scanner directives, and debug metadata.
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
});

export type FrameOutput = z.infer<typeof FRAME_OUTPUT_SCHEMA>;
