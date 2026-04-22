import type { Scanner, ExpandedQueryPlan } from '../types';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import type { Signal } from '../../../lib/types/signal';
import type { SourceReport } from '../../../lib/types/source-report';
import type {
  ScannerReport,
  TwoPassMeta,
  V2FeaturesMeta,
} from '../../../lib/types/scanner-report';
import type { FirstPassSummary } from '../../../lib/types/two-pass-state';
import {
  runPassFromPlan,
  resolvePlan,
  computeStatus,
  logScanComplete,
  buildV2FeaturesMeta,
  MAX_FINAL_SIGNALS,
  type PassOutcome,
  type ResolvePlanResult,
} from './scanner';
import { summarizeFirstPass } from './first-pass-summary';
import { refinePlan } from './refine-planner';
import { dedupeSignals, keepTop } from './post-process';

/**
 * Decide whether pass 2 is worth running. Requires at least ONE
 * concrete hook to refine around:
 *   - A sparse direction (1-4 results = gap opportunity), OR
 *   - A signal scoring relevance ≥ 6 (a decent match worth chasing)
 *   - Empty queries alone are NOT enough.
 *
 * The threshold was lowered from 7 → 6 because Sonnet's ceiling
 * rule aggressively caps most signals at 5-6. With threshold=7,
 * pass 2 almost never ran because no signal could reach 7 under
 * the strict ceiling. Threshold=6 means "the enricher found at
 * least one signal it considers genuinely relevant to the founder"
 * which is a sufficient hook for refinement.
 */
function hasRefinementSignal(summary: FirstPassSummary): boolean {
  if (summary.sparse_directions.length > 0) return true;
  if (summary.top_signal_summary.some((t) => t.relevance >= 6)) return true;
  return false;
}

/**
 * Run the pass-1 → summarize → refine → pass-2 → merge flow.
 *
 * On pass-2 failure (LLM error, schema invalid, or exhausted-reuse),
 * degrades gracefully to the pass-1 result with an explanatory
 * warning — the user gets the single-pass output instead of an error.
 *
 * Merge strategy: dedupe signals across passes by URL, then apply the
 * shared top-N cap. Both passes already had the quality floor applied
 * inside runPassFromPlan, so the merge doesn't need to re-filter.
 */
export async function runTwoPass(
  directive: ScannerDirectives['tech_scout'],
  profile: Parameters<Scanner>[1],
  narrativeProse: string,
  deps: Parameters<Scanner>[3],
): Promise<ScannerReport> {
  const start = Date.now();
  const warnings: string[] = [];

  const pass1Plan = await resolvePlan(directive, profile, deps, warnings);
  const pass1 = await runPassFromPlan(
    pass1Plan.value,
    directive,
    profile,
    narrativeProse,
    deps,
  );
  warnings.push(...pass1.warnings);

  const summary = summarizeFirstPass({
    sourceReports: pass1.perSource.map((p) => p.report),
    enrichedSignals: pass1.qualityFloored,
  });

  if (!hasRefinementSignal(summary)) {
    return assembleTwoPassReport({
      directive,
      plan: pass1Plan,
      pass1,
      pass2: null,
      summary,
      warnings,
      skippedReason: 'no_refinement_signal',
      startedAt: start,
      clock: deps.clock,
    });
  }

  const refined = await refinePlan({
    directive,
    profile,
    summary,
    options: {
      clock: deps.clock,
      scenario: deps.scenarios?.refine,
    },
  });

  if (!refined.ok) {
    warnings.push(`two_pass_fallback: refine_${refined.error.kind}`);
    return assembleTwoPassReport({
      directive,
      plan: pass1Plan,
      pass1,
      pass2: null,
      summary,
      warnings,
      skippedReason: `refine_failed_${refined.error.kind}`,
      startedAt: start,
      clock: deps.clock,
    });
  }

  const pass2 = await runPassFromPlan(
    refined.value,
    directive,
    profile,
    narrativeProse,
    deps,
  );
  warnings.push(...pass2.warnings.map((w) => `pass2: ${w}`));

  return assembleTwoPassReport({
    directive,
    plan: pass1Plan,
    pass1,
    pass2: { outcome: pass2, plan: refined.value },
    summary,
    warnings,
    skippedReason: null,
    startedAt: start,
    clock: deps.clock,
  });
}

type AssembleTwoPassArgs = {
  directive: ScannerDirectives['tech_scout'];
  plan: ResolvePlanResult;
  pass1: PassOutcome;
  pass2: { outcome: PassOutcome; plan: ExpandedQueryPlan } | null;
  summary: FirstPassSummary;
  warnings: string[];
  skippedReason: string | null;
  startedAt: number;
  clock: () => Date;
};

/**
 * Build the merged ScannerReport for a two-pass run. Dedupes signals
 * across passes by URL, applies the final top-N cap, and attaches the
 * two_pass_meta field with pass1/pass2 signal counts and the summary
 * buckets so the debug UI can show refinement decisions.
 */
function assembleTwoPassReport(args: AssembleTwoPassArgs): ScannerReport {
  const mergedSignals = mergeAcrossPasses(
    args.pass1.qualityFloored,
    args.pass2?.outcome.qualityFloored ?? [],
  );
  const finalSignals = keepTop(mergedSignals, MAX_FINAL_SIGNALS);

  const sourceReports = combineSourceReports(
    args.pass1.perSource.map((p) => p.report),
    args.pass2?.outcome.perSource.map((p) => p.report) ?? [],
  );

  const totalRaw =
    args.pass1.prefilter.totalRaw + (args.pass2?.outcome.prefilter.totalRaw ?? 0);
  const afterDedupe =
    args.pass1.prefilter.afterDedupe +
    (args.pass2?.outcome.prefilter.afterDedupe ?? 0);
  const afterExclude =
    args.pass1.prefilter.afterExclude +
    (args.pass2?.outcome.prefilter.afterExclude ?? 0);
  const cost =
    args.pass1.enrichment.cost_usd +
    (args.pass2?.outcome.enrichment.cost_usd ?? 0);

  const meta: TwoPassMeta = {
    pass1_signal_count: args.pass1.qualityFloored.length,
    pass2_signal_count: args.pass2?.outcome.qualityFloored.length ?? 0,
    dense_directions: args.summary.dense_directions,
    sparse_directions: args.summary.sparse_directions,
    empty_queries: args.summary.empty_queries,
    exhausted_terms: args.summary.exhausted_terms,
    pass2_plan: args.pass2
      ? (args.pass2.plan as unknown as Record<string, unknown>)
      : null,
    pass2_skipped_reason: args.skippedReason,
  };

  // Two-pass always runs under a two_pass_enabled=true flag; reuse the
  // skill_remix and adjacent_worlds stage status captured during pass-1
  // expansion so the debug UI can render a ✓/✗ per v2 stage.
  const v2Meta: V2FeaturesMeta = buildV2FeaturesMeta(args.plan.stageStatus, true);

  const report: ScannerReport = {
    scanner: 'tech_scout',
    status: computeStatus(sourceReports),
    signals: finalSignals,
    source_reports: sourceReports,
    expansion_plan: args.plan.ok
      ? (args.plan.value as unknown as Record<string, unknown>)
      : null,
    total_raw_items: totalRaw,
    signals_after_dedupe: afterDedupe,
    signals_after_exclude: afterExclude,
    cost_usd: cost,
    elapsed_ms: Date.now() - args.startedAt,
    generated_at: args.clock().toISOString(),
    errors: [],
    warnings: args.warnings,
    two_pass_meta: meta,
    v2_features_meta: v2Meta,
  };
  logScanComplete(report);
  return report;
}

/**
 * Dedupe signals across pass 1 and pass 2 by URL. Uses the shared
 * post-process dedupeSignals which preserves the highest-composite
 * score when two passes see the same URL.
 */
function mergeAcrossPasses(
  pass1Signals: readonly Signal[],
  pass2Signals: readonly Signal[],
): Signal[] {
  return dedupeSignals([...pass1Signals, ...pass2Signals]);
}

/**
 * Combine per-source reports across the two passes. For sources that
 * appear in both, sum signals_count and elapsed_ms, concatenate
 * queries_ran, and prefer the more-pessimistic status (failed >
 * denied > timeout > ok_empty > ok). This keeps the UI honest about
 * what happened across the whole run.
 */
function combineSourceReports(
  pass1: readonly SourceReport[],
  pass2: readonly SourceReport[],
): SourceReport[] {
  const byName = new Map<string, SourceReport>();
  for (const r of pass1) byName.set(r.name, r);
  for (const r of pass2) {
    const existing = byName.get(r.name);
    if (!existing) {
      byName.set(r.name, r);
      continue;
    }
    byName.set(r.name, mergeOneSourceReport(existing, r));
  }
  return Array.from(byName.values());
}

/** Merge two SourceReports for the same adapter (pass 1 + pass 2). */
function mergeOneSourceReport(a: SourceReport, b: SourceReport): SourceReport {
  return {
    name: a.name,
    status: worstStatus(a.status, b.status),
    signals_count: a.signals_count + b.signals_count,
    queries_ran: [...a.queries_ran, ...b.queries_ran],
    queries_with_zero_results: [
      ...a.queries_with_zero_results,
      ...b.queries_with_zero_results,
    ],
    error: a.error ?? b.error,
    elapsed_ms: a.elapsed_ms + b.elapsed_ms,
    cost_usd: a.cost_usd + b.cost_usd,
  };
}

/** Rank SourceReport statuses so the aggregate picks the worst one. */
function worstStatus(
  a: SourceReport['status'],
  b: SourceReport['status'],
): SourceReport['status'] {
  const rank: Record<SourceReport['status'], number> = {
    ok: 0,
    ok_empty: 1,
    timeout: 2,
    denied: 3,
    failed: 4,
  };
  return rank[a] >= rank[b] ? a : b;
}
