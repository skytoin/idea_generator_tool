import { z } from 'zod';

/**
 * Category taxonomy for scanner signals. Every normalized Signal must
 * pick exactly one of these so downstream aggregation and ranking can
 * reason about signal type without re-parsing raw data.
 */
export const SIGNAL_CATEGORY = z.enum([
  'tech_capability',
  'product_launch',
  'research',
  'adoption',
  'standards',
  'infrastructure',
]);

/**
 * Canonical scanner signal type. Every source adapter (HN, arxiv,
 * GitHub, Product Hunt, etc.) normalizes its upstream records into
 * this shape so the rest of the pipeline operates on one schema.
 * `raw` preserves the original payload for debugging and re-ranking.
 */
export const SIGNAL_SCHEMA = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  date: z.string().datetime().nullable(),
  snippet: z.string(),
  score: z.object({
    novelty: z.number().min(1).max(10),
    specificity: z.number().min(1).max(10),
    recency: z.number().min(1).max(10),
  }),
  category: SIGNAL_CATEGORY,
  raw: z.unknown(),
});

export type Signal = z.infer<typeof SIGNAL_SCHEMA>;
