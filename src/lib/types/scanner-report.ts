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
/**
 * Optional two-pass metadata. When the scanner ran in two-pass mode,
 * this captures the pass-1 summary, the pass-2 expansion plan, and
 * per-pass signal counts so the debug UI can show what refinement
 * changed. In single-pass mode the field is absent or null.
 */
export const TWO_PASS_META_SCHEMA = z.object({
  pass1_signal_count: z.number().int().nonnegative(),
  pass2_signal_count: z.number().int().nonnegative(),
  dense_directions: z.array(z.string()),
  sparse_directions: z.array(z.string()),
  empty_queries: z.array(z.string()),
  exhausted_terms: z.array(z.string()),
  pass2_plan: z.record(z.string(), z.unknown()).nullable(),
  pass2_skipped_reason: z.string().nullable(),
});
export type TwoPassMeta = z.infer<typeof TWO_PASS_META_SCHEMA>;

/**
 * Result of one optional v2 LLM stage (skill_remix or adjacent_worlds).
 * `status` carries "disabled" when the feature flag was off, "ok"
 * when the LLM succeeded, and "failed:<kind>" when it fell back.
 * `count` is the number of hunts or worlds the stage produced on
 * success. The debug UI uses this to render a visible ✓/✗ marker
 * per v2 stage so testers can tell which features actually ran.
 */
export const V2_STAGE_STATUS_SCHEMA = z.object({
  status: z.enum(['disabled', 'ok', 'failed']),
  count: z.number().int().nonnegative(),
  error_kind: z.string().nullable(),
});
export type V2StageStatus = z.infer<typeof V2_STAGE_STATUS_SCHEMA>;

/**
 * Aggregate v2-feature run summary. Attached to every ScannerReport so
 * testers can see — at a glance — which of the three v2 features
 * (skill_remix, adjacent_worlds, two_pass) actually ran and what they
 * produced. Silence on success was the previous failure mode: if you
 * turned a flag on you had no way to tell whether it fired. This
 * struct fixes that by always being present and always carrying the
 * stage state, even when every flag is off.
 */
export const V2_FEATURES_META_SCHEMA = z.object({
  skill_remix: V2_STAGE_STATUS_SCHEMA,
  adjacent_worlds: V2_STAGE_STATUS_SCHEMA,
  two_pass_enabled: z.boolean(),
});
export type V2FeaturesMeta = z.infer<typeof V2_FEATURES_META_SCHEMA>;

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
  two_pass_meta: TWO_PASS_META_SCHEMA.nullish(),
  v2_features_meta: V2_FEATURES_META_SCHEMA.nullish(),
  /**
   * Identifier of the LLM that produced the tech_scout enrichment /
   * planning calls for this run (e.g. "gpt-4o", "claude-opus-4-6").
   * Surfaced so the admin debug view can confirm which model the
   * `TECH_SCOUT_MODEL` env var actually resolved to. Nullish so older
   * fixtures and the synthetic crash report stay valid without it.
   */
  model_used: z.string().nullish(),
});

export type ScannerReport = z.infer<typeof SCANNER_REPORT_SCHEMA>;
