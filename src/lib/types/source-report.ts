import { z } from 'zod';

/**
 * Outcome status for a single source adapter invocation. `ok_empty`
 * is distinct from `ok` so the orchestrator can distinguish between
 * "the source answered with zero signals" (ok_empty, not an error)
 * and "the source returned signals" (ok). `denied` covers rate-limit
 * and forbidden responses; `failed` is everything else.
 */
export const SOURCE_STATUS = z.enum([
  'ok',
  'ok_empty',
  'timeout',
  'denied',
  'failed',
]);

/**
 * Per-source outcome report for a single adapter within a scanner run.
 * The orchestrator collects one of these per adapter so the aggregate
 * ScannerReport can tell which adapter contributed what (and which
 * queries returned zero results, useful for expansion-plan debugging).
 */
export const SOURCE_REPORT_SCHEMA = z.object({
  name: z.string().min(1),
  status: SOURCE_STATUS,
  signals_count: z.number().int().nonnegative(),
  queries_ran: z.array(z.string()),
  queries_with_zero_results: z.array(z.string()),
  error: z.object({ kind: z.string(), message: z.string() }).nullable(),
  elapsed_ms: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
});

export type SourceReport = z.infer<typeof SOURCE_REPORT_SCHEMA>;
