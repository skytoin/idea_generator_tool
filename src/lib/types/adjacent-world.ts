import { z } from 'zod';

/**
 * One adjacent world for analogical transfer. The key constraint is
 * `shared_traits`: at least one concrete structural trait the adjacent
 * domain shares with the founder's source domain. Without this guard
 * the LLM drifts to random industries (see the 2026-04-12 MCP→MC drift
 * incident). Callers should reject worlds whose trait list is empty.
 */
export const ADJACENT_WORLD_SCHEMA = z.object({
  source_domain: z.string().min(1),
  adjacent_domain: z.string().min(1),
  shared_traits: z.array(z.string().min(1)).min(1).max(5),
  example_search_phrases: z.array(z.string().min(1)).min(1).max(5),
});
export type AdjacentWorld = z.infer<typeof ADJACENT_WORLD_SCHEMA>;

/**
 * 2-6 adjacent worlds per founder. Fewer than 2 means the LLM couldn't
 * identify solid adjacencies — that's fine and callers should treat an
 * empty/short list as "no analogical angle today" rather than an error.
 */
export const ADJACENT_WORLDS_SCHEMA = z.array(ADJACENT_WORLD_SCHEMA).min(2).max(6);
export type AdjacentWorlds = z.infer<typeof ADJACENT_WORLDS_SCHEMA>;
