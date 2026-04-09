import { z } from 'zod';

/**
 * Prose summary of the founder profile, produced by the narrative step.
 * Downstream steps read this to provide quick human-friendly context
 * alongside the structured FounderProfile.
 */
export const FOUNDER_NARRATIVE_SCHEMA = z.object({
  prose: z.string().min(50).max(2000),
  word_count: z.number().int().nonnegative(),
  generated_at: z.string().datetime(),
});

export type FounderNarrative = z.infer<typeof FOUNDER_NARRATIVE_SCHEMA>;
