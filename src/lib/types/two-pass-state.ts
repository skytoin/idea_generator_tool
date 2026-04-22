import { z } from 'zod';

/**
 * Per-query summary entry captured from pass 1 so the refinement LLM
 * can reason about which directions were dense/sparse/empty.
 */
export const QUERY_RUN_SCHEMA = z.object({
  source: z.string().min(1),
  label: z.string().min(1),
  result_count: z.number().int().min(0),
});
export type QueryRun = z.infer<typeof QUERY_RUN_SCHEMA>;

/**
 * One top enriched signal captured for the refinement prompt. Carries
 * just enough context for the refine LLM to judge whether related
 * angles are worth double-downing on: source, title, and the two
 * score axes the quality floor cares about.
 */
export const TOP_SIGNAL_SUMMARY_SCHEMA = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  relevance: z.number().min(0).max(10),
  recency: z.number().min(0).max(10),
});
export type TopSignalSummary = z.infer<typeof TOP_SIGNAL_SUMMARY_SCHEMA>;

/**
 * Compact summary of a first-pass scanner run, produced by the pure
 * first-pass summarizer and consumed by the refinement LLM. The
 * critical "absence as signal" channel is `empty_queries`: a query
 * that returned zero results is MORE interesting than one that
 * returned 100, because it either means the wording was wrong or
 * there's a genuine gap worth exploring.
 *
 * Other fields:
 * - `dense_directions`: labels with ≥5 results (saturated; don't retry)
 * - `sparse_directions`: labels with 1-4 results (gap opportunities)
 * - `top_signal_summary`: top enriched titles per source, for the refine LLM
 * - `exhausted_terms`: keywords pass 2 should NOT reuse (already fully explored)
 */
export const FIRST_PASS_SUMMARY_SCHEMA = z.object({
  queries_run: z.array(QUERY_RUN_SCHEMA),
  dense_directions: z.array(z.string()),
  sparse_directions: z.array(z.string()),
  empty_queries: z.array(z.string()),
  top_signal_summary: z.array(TOP_SIGNAL_SUMMARY_SCHEMA).max(15),
  exhausted_terms: z.array(z.string()),
});
export type FirstPassSummary = z.infer<typeof FIRST_PASS_SUMMARY_SCHEMA>;
