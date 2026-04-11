import type {
  Scanner,
  ExpandedQueryPlan,
  SourceAdapter,
} from '../types';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import type { Signal } from '../../../lib/types/signal';
import type { SourceReport } from '../../../lib/types/source-report';
import type { ScannerReport } from '../../../lib/types/scanner-report';
import { planQueries as llmPlanQueries } from './query-planner';
import { enrichSignals } from './enricher';
import { dedupeSignals, filterExcluded, keepTop } from './post-process';
import { TECH_SCOUT_ADAPTERS } from './adapters';
import { withTimeout } from '../../../lib/utils/with-timeout';
import { classifyError } from './classify-error';
import { logger } from '../../../lib/utils/logger';

const PER_SOURCE_TIMEOUT_MS = 60_000;
const MAX_FINAL_SIGNALS = 25;

/**
 * Per-adapter phase result. Wraps the adapter's normalized signals with
 * the SourceReport the orchestrator will roll up into the ScannerReport.
 */
type AdapterOutcome = { signals: Signal[]; report: SourceReport };

/** Output of the post-processing phase (dedupe/exclude/top-N). */
type PostProcessResult = {
  topSignals: Signal[];
  totalRaw: number;
  afterDedupe: number;
  afterExclude: number;
};

/**
 * Tech Scout scanner — runs the hybrid query planning pipeline:
 * expansion LLM call → parallel adapter fetch → dedupe/filter/top-N →
 * enrichment LLM call → ScannerReport. Per-source timeouts are 60s
 * and per-source failures are isolated via classifyError so one
 * denied/failing adapter cannot break the whole scan.
 */
export const runTechScout: Scanner = async (
  directive,
  profile,
  _narrative,
  deps,
) => {
  const start = Date.now();
  const warnings: string[] = [];
  const plan = await resolvePlan(directive, profile, deps, warnings);
  const perSource = await runAdaptersInParallel(
    plan.value,
    directive,
    TECH_SCOUT_ADAPTERS,
  );
  const postProcessed = postProcess(perSource, directive.exclude);
  const enrichment = await enrichSignals(postProcessed.topSignals, {
    scenario: deps.scenarios?.enrichment,
  });
  warnings.push(...enrichment.warnings);
  const report = assembleReport({
    plan,
    perSource,
    postProcessed,
    enrichment,
    warnings,
    startedAt: start,
    clock: deps.clock,
  });
  logScanComplete(report);
  return report;
};

/** Emit a single structured log line summarizing the completed scan. */
function logScanComplete(report: ScannerReport): void {
  logger.child({ scanner: 'tech_scout' }).info(
    {
      status: report.status,
      cost_usd: report.cost_usd,
      elapsed_ms: report.elapsed_ms,
      signals: report.signals.length,
    },
    'tech_scout complete',
  );
}

type AssembleArgs = {
  plan: { ok: boolean; value: ExpandedQueryPlan };
  perSource: AdapterOutcome[];
  postProcessed: PostProcessResult;
  enrichment: { signals: Signal[]; cost_usd: number; warnings: string[] };
  warnings: string[];
  startedAt: number;
  clock: () => Date;
};

/** Roll up all phase outputs into a single ScannerReport payload. */
function assembleReport(args: AssembleArgs): ScannerReport {
  const sourceReports = args.perSource.map((r) => r.report);
  return {
    scanner: 'tech_scout',
    status: computeStatus(sourceReports),
    signals: args.enrichment.signals,
    source_reports: sourceReports,
    expansion_plan: args.plan.ok
      ? (args.plan.value as unknown as Record<string, unknown>)
      : null,
    total_raw_items: args.postProcessed.totalRaw,
    signals_after_dedupe: args.postProcessed.afterDedupe,
    signals_after_exclude: args.postProcessed.afterExclude,
    cost_usd: args.enrichment.cost_usd,
    elapsed_ms: Date.now() - args.startedAt,
    generated_at: args.clock().toISOString(),
    errors: [],
    warnings: args.warnings,
  };
}

/** Expansion phase wrapper: calls the LLM planner and falls back to keywords. */
async function resolvePlan(
  directive: ScannerDirectives['tech_scout'],
  profile: Parameters<Scanner>[1],
  deps: Parameters<Scanner>[3],
  warnings: string[],
): Promise<{ ok: boolean; value: ExpandedQueryPlan }> {
  const result = await llmPlanQueries(directive, profile, {
    clock: deps.clock,
    scenario: deps.scenarios?.expansion,
  });
  if (result.ok) return { ok: true, value: result.value };
  warnings.push(`expansion_fallback: ${result.error.kind}`);
  return { ok: false, value: buildFallbackPlan(directive, deps.clock()) };
}

/** Run every adapter in parallel, isolating failures via classifyError. */
async function runAdaptersInParallel(
  plan: ExpandedQueryPlan,
  directive: ScannerDirectives['tech_scout'],
  adapters: readonly SourceAdapter[],
): Promise<AdapterOutcome[]> {
  return Promise.all(
    adapters.map((adapter) => runOneAdapter(adapter, plan, directive)),
  );
}

/**
 * Plan, fetch, and normalize one adapter under a per-source timeout.
 * On any throw, classify the error into a SourceReport status bucket
 * and return an empty signals array so the orchestrator can continue
 * with the remaining adapters.
 */
async function runOneAdapter(
  adapter: SourceAdapter,
  plan: ExpandedQueryPlan,
  directive: ScannerDirectives['tech_scout'],
): Promise<AdapterOutcome> {
  const queries = adapter.planQueries(plan, directive);
  const labels = queries.map((q) => q.label);
  const controller = new AbortController();
  const startedAt = Date.now();
  try {
    const raws = await withTimeout(
      adapter.fetch(queries, {
        timeoutMs: PER_SOURCE_TIMEOUT_MS,
        signal: controller.signal,
      }),
      PER_SOURCE_TIMEOUT_MS,
      controller,
    );
    const signals = raws.map((r) => adapter.normalize(r));
    return {
      signals,
      report: buildOkReport(adapter.name, signals, labels, startedAt),
    };
  } catch (e) {
    return {
      signals: [],
      report: buildErrorReport(adapter.name, labels, startedAt, e),
    };
  }
}

/** Build a successful SourceReport (ok or ok_empty). */
function buildOkReport(
  name: string,
  signals: Signal[],
  labels: string[],
  startedAt: number,
): SourceReport {
  const status = signals.length > 0 ? 'ok' : 'ok_empty';
  return {
    name,
    status,
    signals_count: signals.length,
    queries_ran: labels,
    queries_with_zero_results: signals.length === 0 ? labels : [],
    error: null,
    elapsed_ms: Date.now() - startedAt,
    cost_usd: 0,
  };
}

/** Build a failure SourceReport from a thrown error. */
function buildErrorReport(
  name: string,
  labels: string[],
  startedAt: number,
  e: unknown,
): SourceReport {
  const kind = classifyError(e);
  const message = e instanceof Error ? e.message : String(e);
  return {
    name,
    status: kind,
    signals_count: 0,
    queries_ran: labels,
    queries_with_zero_results: [],
    error: { kind, message },
    elapsed_ms: Date.now() - startedAt,
    cost_usd: 0,
  };
}

/** Flatten, dedupe, exclude, sort, and cap the signals from every adapter. */
function postProcess(
  perSource: AdapterOutcome[],
  exclude: readonly string[],
): PostProcessResult {
  const flat = perSource.flatMap((r) => r.signals);
  const totalRaw = flat.length;
  const deduped = dedupeSignals(flat);
  const afterDedupe = deduped.length;
  const excluded = filterExcluded(deduped, exclude);
  const afterExclude = excluded.length;
  const topSignals = keepTop(excluded, MAX_FINAL_SIGNALS);
  return { topSignals, totalRaw, afterDedupe, afterExclude };
}

/** Roll up per-source statuses into the aggregate ScannerReport status. */
function computeStatus(
  reports: SourceReport[],
): 'ok' | 'partial' | 'failed' {
  if (reports.length === 0) return 'failed';
  const okCount = reports.filter(
    (r) => r.status === 'ok' || r.status === 'ok_empty',
  ).length;
  if (okCount === reports.length) return 'ok';
  if (okCount === 0) return 'failed';
  return 'partial';
}

/**
 * Build a minimally-usable ExpandedQueryPlan when the LLM expansion
 * step fails. Uses the directive's keywords verbatim, picks two generic
 * arxiv ML categories, assumes python as the github language, and sets
 * a 6-month timeframe so adapters still produce meaningful queries.
 */
function buildFallbackPlan(
  directive: ScannerDirectives['tech_scout'],
  now: Date,
): ExpandedQueryPlan {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  return {
    expanded_keywords: directive.keywords,
    arxiv_categories: ['cs.LG', 'cs.AI'],
    github_languages: ['python'],
    domain_tags: [],
    timeframe_iso: cutoff.toISOString(),
  };
}
