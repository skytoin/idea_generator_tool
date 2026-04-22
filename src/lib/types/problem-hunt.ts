import { z } from 'zod';

/**
 * One functional-decomposition hunt derived from a founder skill. A
 * skill like "Python" or "nursing" is not a search target by itself;
 * what matters is the class of problems that skill can solve. Each hunt
 * names one such problem plus short, search-ready phrases adapters can
 * use directly. Downstream the expansion planner slices these into
 * per-source keyword lists.
 */
export const PROBLEM_HUNT_SCHEMA = z.object({
  skill_source: z.string().min(1),
  problem: z.string().min(5),
  example_search_phrases: z.array(z.string().min(1)).min(1).max(6),
});
export type ProblemHunt = z.infer<typeof PROBLEM_HUNT_SCHEMA>;

/**
 * 3-10 problem hunts per founder. Fewer than 3 means the LLM couldn't
 * decompose the profile meaningfully — callers should treat that as a
 * soft failure and fall back to directive keywords.
 */
export const PROBLEM_HUNTS_SCHEMA = z.array(PROBLEM_HUNT_SCHEMA).min(3).max(10);
export type ProblemHunts = z.infer<typeof PROBLEM_HUNTS_SCHEMA>;
