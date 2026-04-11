import { z } from 'zod';
import { SIGNAL_SCHEMA } from './signal';
import { SOURCE_REPORT_SCHEMA } from './source-report';

/**
 * Aggregate status for a whole scanner run. `ok` = every adapter
 * succeeded; `partial` = some adapter failed but we still have signals;
 * `failed` = no signals produced at all.
 */
export const SCANNER_STATUS = z.enum(['ok', 'partial', 'failed']);

/**
 * Aggregate report for a single scanner run (e.g. 'tech_scout').
 * Contains the normalized signals, per-adapter source_reports, the
 * expansion plan produced by the LLM planner (may be null if the
 * scanner skipped planning), and bookkeeping counts that let the
 * admin debug view show where items were filtered out.
 */
export const SCANNER_REPORT_SCHEMA = z.object({
  scanner: z.string().min(1),
  status: SCANNER_STATUS,
  signals: z.array(SIGNAL_SCHEMA),
  source_reports: z.array(SOURCE_REPORT_SCHEMA),
  expansion_plan: z.record(z.string(), z.unknown()).nullable(),
  total_raw_items: z.number().int().nonnegative(),
  signals_after_dedupe: z.number().int().nonnegative(),
  signals_after_exclude: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  elapsed_ms: z.number().nonnegative(),
  generated_at: z.string().datetime(),
  errors: z.array(z.object({ kind: z.string(), message: z.string() })),
  warnings: z.array(z.string()),
});

export type ScannerReport = z.infer<typeof SCANNER_REPORT_SCHEMA>;
