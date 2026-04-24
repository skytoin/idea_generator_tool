import type { Scanner, ExpandedQueryPlan, SourceAdapter } from '../types';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import type { Signal } from '../../../lib/types/signal';
import type { SourceReport } from '../../../lib/types/source-report';
import type {
  ScannerReport,
  V2FeaturesMeta,
  V2StageStatus,
} from '../../../lib/types/scanner-report';
import type { ProblemHunts } from '../../../lib/types/problem-hunt';
import type { AdjacentWorlds } from '../../../lib/types/adjacent-world';
import { planQueries as llmPlanQueries } from './query-planner';
import { enrichSignals } from './enricher';
import { generateProblemHunts } from './skill-remix';
import { generateAdjacentWorlds } from './adjacent-worlds';
import {
  dedupeSignals,
  filterExcluded,
  filterByTimeframe,
  filterByMinScore,
  interleaveBySource,
  keepTop,
} from './post-process';
import { TECH_SCOUT_ADAPTERS } from './adapters';
import { withTimeout } from '../../../lib/utils/with-timeout';
import { classifyError } from './classify-error';
import { logger } from '../../../lib/utils/logger';
import { models } from '../../../lib/ai/models';

const PER_SOURCE_TIMEOUT_MS = 60_000;

/**
 * Cap on the number of signals returned in the final ScannerReport.
 * Bumped from 30 → 40 on 2026-04-23 once the Hugging Face adapter
 * landed: with 5 sources contributing distinct signal types
 * (HN, arxiv, github, reddit, huggingface), holding the cap at 30
 * was forcing the diversity-friendly mix to compete for too few
 * slots. 40 lets each source contribute roughly 5-10 signals to the
 * final pool while keeping the downstream review surface manageable.
 */
const MAX_FINAL_SIGNALS = 40;

/**
 * Minimum per-axis scores for post-enrichment signals to survive the
 * final cut. Applied AFTER enrichment so the LLM has already scored
 * each signal. Tuned off the 2026-04-12 run: 1–3 recency arxiv papers
 * were surviving keepTop on composite score alone, and irrelevant
 * dev-tool launches were crowding out actually useful picks.
 */
const MIN_RELEVANCE = 5;
const MIN_RECENCY = 4;

/**
 * Max signals per source fed into enrichment. At 20 per source × 5 sources
 * that's up to 100 signals passed to the enrichment LLM — bounded cost
 * (~$0.13 at gpt-4o pricing) while guaranteeing every source gets fair
 * representation before the final top-N cut. Increased from 15 to 20
 * to accommodate 6 queries per source (v2.0 divergence upgrade).
 */
const PER_SOURCE_CAP_FOR_ENRICHMENT = 20;

/**
 * Upper bound on the number of signals the enricher will actually process
 * in a single LLM call. Sized AT `PER_SOURCE_CAP × len(adapters)` so
 * the enricher never silently truncates the fair interleaving. Bumped
 * from 70 → 100 on 2026-04-23 alongside the Hugging Face adapter:
 * with 5 sources × 20 cap, the prior 70 was clipping ~30 signals
 * before they ever reached the enricher (silent recall loss). 100
 * matches the new 5-adapter ceiling exactly.
 */
const ENRICHMENT_TOP_N = 100;

/**
 * Map from directive target_source aliases to adapter names. The directives
 * schema uses short aliases ('hn', 'arxiv', 'github'); adapters register
 * with their full names ('hn_algolia', etc.). This table bridges them so
 * the orchestrator can respect directive.target_sources when filtering.
 */
const SOURCE_ALIAS_TO_ADAPTER_NAME: Record<string, string> = {
  hn: 'hn_algolia',
  arxiv: 'arxiv',
  github: 'github',
  reddit: 'reddit',
  huggingface: 'huggingface',
  // 'producthunt' is in the schema enum but intentionally unmapped
  // because no adapter exists yet.
};

/**
 * Filter the adapter registry by the directive's target_sources list.
 * Empty or missing target_sources falls back to the full registry. If the
 * filter produces zero runnable adapters (e.g., directive only listed
 * 'producthunt' which has no adapter), we also fall back to the full
 * registry so the scanner never runs with no sources.
 */
function selectAdapters(
  directive: ScannerDirectives['tech_scout'],
  registry: readonly SourceAdapter[],
): readonly SourceAdapter[] {
  const requested = directive.target_sources ?? [];
  if (requested.length === 0) return registry;
  const allowed = new Set(
    requested
      .map((src) => SOURCE_ALIAS_TO_ADAPTER_NAME[src])
      .filter((n): n is string => n !== undefined),
  );
  const selected = registry.filter((a) => allowed.has(a.name));
  return selected.length > 0 ? selected : registry;
}

/**
 * Per-adapter phase result. Wraps the adapter's normalized signals with
 * the SourceReport the orchestrator will roll up into the ScannerReport.
 */
type AdapterOutcome = { signals: Signal[]; report: SourceReport };

/**
 * Output of the pre-enrichment filtering phase. `candidates` is the set
 * fed into the enricher AFTER dedupe/exclude/interleave have run — it
 * contains up to PER_SOURCE_CAP_FOR_ENRICHMENT signals from each source
 * so every adapter gets fair representation in the final output.
 */
type PrefilterResult = {
  candidates: Signal[];
  totalRaw: number;
  afterDedupe: number;
  afterExclude: number;
};

/**
 * Output of one pass: everything the caller needs to either assemble a
 * ScannerReport (single-pass) or feed into the pass-2 merge flow
 * (two-pass). `plan` is the expansion plan this pass ran under, so the
 * orchestrator can stash pass1_plan in the report while pass 2 lives
 * in two_pass_meta.pass2_plan.
 */
export type PassOutcome = {
  plan: ExpandedQueryPlan;
  perSource: AdapterOutcome[];
  prefilter: PrefilterResult;
  enrichment: { signals: Signal[]; cost_usd: number; warnings: string[] };
  qualityFloored: Signal[];
  warnings: string[];
};

/**
 * Execute one full fetch → enrich → quality-floor pass given an
 * already-resolved ExpandedQueryPlan. Extracted from runTechScout so
 * the two-pass orchestrator can call this twice with different plans
 * without duplicating the plumbing.
 */
export async function runPassFromPlan(
  plan: ExpandedQueryPlan,
  directive: ScannerDirectives['tech_scout'],
  profile: Parameters<Scanner>[1],
  narrativeProse: string,
  deps: Parameters<Scanner>[3],
): Promise<PassOutcome> {
  const warnings: string[] = [];
  const selectedAdapters = selectAdapters(directive, TECH_SCOUT_ADAPTERS);
  const perSource = await runAdaptersInParallel(plan, directive, selectedAdapters);
  const prefilter = prefilterSignals(perSource, directive.exclude, plan.timeframe_iso);
  const founderContext = buildFounderContext(directive, profile, narrativeProse);
  const enrichment = await enrichSignals(prefilter.candidates, {
    scenario: deps.scenarios?.enrichment,
    topN: ENRICHMENT_TOP_N,
    founderContext,
  });
  warnings.push(...enrichment.warnings);
  const qualityFloored = filterByMinScore(enrichment.signals, {
    minRelevance: MIN_RELEVANCE,
    minRecency: MIN_RECENCY,
  });
  const dropped = enrichment.signals.length - qualityFloored.length;
  if (dropped > 0) {
    warnings.push(
      `quality_floor: dropped ${dropped} signals below relevance>=${MIN_RELEVANCE} or recency>=${MIN_RECENCY}`,
    );
  }
  return { plan, perSource, prefilter, enrichment, qualityFloored, warnings };
}

/**
 * Tech Scout scanner — runs the hybrid query planning pipeline:
 * expansion LLM call → parallel adapter fetch → dedupe/filter/top-N →
 * enrichment LLM call → ScannerReport. Per-source timeouts are 60s
 * and per-source failures are isolated via classifyError so one
 * denied/failing adapter cannot break the whole scan. When
 * `deps.features.two_pass === true`, delegates to the two-pass
 * orchestrator which runs pass 1, summarizes, refines, and runs
 * pass 2 before merging outputs.
 */
export const runTechScout: Scanner = async (directive, profile, narrativeProse, deps) => {
  if (deps.features?.two_pass === true) {
    const { runTwoPass } = await import('./two-pass-orchestrator');
    return runTwoPass(directive, profile, narrativeProse, deps);
  }
  return runSinglePass(directive, profile, narrativeProse, deps);
};

/**
 * Single-pass implementation: one resolvePlan + one runPassFromPlan +
 * one assembleReport. This is the v1 behavior preserved verbatim when
 * the `two_pass` feature flag is off (or absent).
 */
async function runSinglePass(
  directive: ScannerDirectives['tech_scout'],
  profile: Parameters<Scanner>[1],
  narrativeProse: string,
  deps: Parameters<Scanner>[3],
): Promise<ScannerReport> {
  const start = Date.now();
  const warnings: string[] = [];
  const plan = await resolvePlan(directive, profile, deps, warnings);
  const pass = await runPassFromPlan(
    plan.value,
    directive,
    profile,
    narrativeProse,
    deps,
  );
  warnings.push(...pass.warnings);
  const finalSignals = keepTop(pass.qualityFloored, MAX_FINAL_SIGNALS);
  const report = assembleReport({
    plan,
    perSource: pass.perSource,
    prefilter: pass.prefilter,
    enrichment: pass.enrichment,
    finalSignals,
    warnings,
    startedAt: start,
    clock: deps.clock,
    v2FeaturesMeta: buildV2FeaturesMeta(plan.stageStatus, false),
  });
  logScanComplete(report);
  return report;
}

export { resolvePlan, computeStatus, logScanComplete, MAX_FINAL_SIGNALS };

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
  prefilter: PrefilterResult;
  enrichment: { signals: Signal[]; cost_usd: number; warnings: string[] };
  finalSignals: Signal[];
  warnings: string[];
  startedAt: number;
  clock: () => Date;
  v2FeaturesMeta: V2FeaturesMeta;
};

/** Roll up all phase outputs into a single ScannerReport payload. */
function assembleReport(args: AssembleArgs): ScannerReport {
  const sourceReports = args.perSource.map((r) => r.report);
  return {
    scanner: 'tech_scout',
    status: computeStatus(sourceReports),
    signals: args.finalSignals,
    source_reports: sourceReports,
    expansion_plan: args.plan.ok
      ? (args.plan.value as unknown as Record<string, unknown>)
      : null,
    total_raw_items: args.prefilter.totalRaw,
    signals_after_dedupe: args.prefilter.afterDedupe,
    signals_after_exclude: args.prefilter.afterExclude,
    cost_usd: args.enrichment.cost_usd,
    elapsed_ms: Date.now() - args.startedAt,
    generated_at: args.clock().toISOString(),
    errors: [],
    warnings: args.warnings,
    v2_features_meta: args.v2FeaturesMeta,
    model_used: models.tech_scout.modelId,
  };
}

/**
 * Result of the v2-extras fetch step. `extras` is what the planner
 * consumes; `meta` is the visible run status for each v2 LLM stage
 * so the debug UI can show a ✓/✗ marker per feature without having
 * to scrape warnings strings.
 */
type ExtrasFetchResult = {
  extras: { problem_hunts?: ProblemHunts; adjacent_worlds?: AdjacentWorlds };
  stageStatus: {
    skill_remix: V2StageStatus;
    adjacent_worlds: V2StageStatus;
  };
};

/** Build a disabled-by-default stage status. */
function disabledStage(): V2StageStatus {
  return { status: 'disabled', count: 0, error_kind: null };
}

/**
 * Fetch the optional v2 extras (problem hunts + adjacent worlds) in
 * parallel when their feature flags are on. Both stages are tolerant
 * of LLM failure: on err we record a warning and mark the stage as
 * `failed` in the returned meta, so the planner proceeds without
 * the extra context rather than aborting.
 */
async function fetchPlannerExtras(
  profile: Parameters<Scanner>[1],
  deps: Parameters<Scanner>[3],
  warnings: string[],
): Promise<ExtrasFetchResult> {
  const skillRemixOn = deps.features?.skill_remix === true;
  const adjacentOn = deps.features?.adjacent_worlds === true;
  const stageStatus: ExtrasFetchResult['stageStatus'] = {
    skill_remix: disabledStage(),
    adjacent_worlds: disabledStage(),
  };
  if (!skillRemixOn && !adjacentOn) {
    return { extras: {}, stageStatus };
  }
  const [remix, worlds] = await Promise.all([
    skillRemixOn
      ? generateProblemHunts(profile, { scenario: deps.scenarios?.skill_remix })
      : Promise.resolve(null),
    adjacentOn
      ? generateAdjacentWorlds(profile, {
          scenario: deps.scenarios?.adjacent_worlds,
        })
      : Promise.resolve(null),
  ]);
  const extras: ExtrasFetchResult['extras'] = {};
  if (remix) {
    if (remix.ok) {
      extras.problem_hunts = remix.value;
      stageStatus.skill_remix = {
        status: 'ok',
        count: remix.value.length,
        error_kind: null,
      };
    } else {
      warnings.push(
        `skill_remix_fallback: ${remix.error.kind} — ${truncateMsg(remix.error.message)}`,
      );
      stageStatus.skill_remix = {
        status: 'failed',
        count: 0,
        error_kind: remix.error.kind,
      };
    }
  }
  if (worlds) {
    if (worlds.ok) {
      extras.adjacent_worlds = worlds.value;
      stageStatus.adjacent_worlds = {
        status: 'ok',
        count: worlds.value.length,
        error_kind: null,
      };
    } else {
      warnings.push(
        `adjacent_worlds_fallback: ${worlds.error.kind} — ${truncateMsg(worlds.error.message)}`,
      );
      stageStatus.adjacent_worlds = {
        status: 'failed',
        count: 0,
        error_kind: worlds.error.kind,
      };
    }
  }
  return { extras, stageStatus };
}

/**
 * Truncate an error message to keep warnings panel rows readable
 * while still surfacing enough of the LLM provider's error text to
 * debug. Cuts at 200 chars with an ellipsis when over budget.
 */
function truncateMsg(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 197)}...` : flat;
}

/**
 * Output of the expansion phase. Carries the ExpandedQueryPlan plus
 * the v2 stage-status block so callers can attach it to the final
 * ScannerReport without having to re-call fetchPlannerExtras.
 */
export type ResolvePlanResult = {
  ok: boolean;
  value: ExpandedQueryPlan;
  stageStatus: ExtrasFetchResult['stageStatus'];
};

/** Expansion phase wrapper: calls the LLM planner and falls back to keywords. */
async function resolvePlan(
  directive: ScannerDirectives['tech_scout'],
  profile: Parameters<Scanner>[1],
  deps: Parameters<Scanner>[3],
  warnings: string[],
): Promise<ResolvePlanResult> {
  const { extras, stageStatus } = await fetchPlannerExtras(profile, deps, warnings);
  const result = await llmPlanQueries(directive, profile, {
    clock: deps.clock,
    scenario: deps.scenarios?.expansion,
    problem_hunts: extras.problem_hunts,
    adjacent_worlds: extras.adjacent_worlds,
  });
  if (result.ok) return { ok: true, value: result.value, stageStatus };
  warnings.push(
    `expansion_fallback: ${result.error.kind} — ${truncateMsg(result.error.message)}`,
  );
  return {
    ok: false,
    value: buildFallbackPlan(directive, deps.clock()),
    stageStatus,
  };
}

/**
 * Build the V2FeaturesMeta payload for a scanner report given the
 * stage-status block from resolvePlan and whether two-pass ran.
 * Pure function so both single-pass and two-pass paths can use it.
 */
export function buildV2FeaturesMeta(
  stageStatus: ExtrasFetchResult['stageStatus'],
  twoPassEnabled: boolean,
): V2FeaturesMeta {
  return {
    skill_remix: stageStatus.skill_remix,
    adjacent_worlds: stageStatus.adjacent_worlds,
    two_pass_enabled: twoPassEnabled,
  };
}

/** Run every adapter in parallel, isolating failures via classifyError. */
async function runAdaptersInParallel(
  plan: ExpandedQueryPlan,
  directive: ScannerDirectives['tech_scout'],
  adapters: readonly SourceAdapter[],
): Promise<AdapterOutcome[]> {
  return Promise.all(adapters.map((adapter) => runOneAdapter(adapter, plan, directive)));
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

/**
 * Flatten, dedupe, exclude, timeframe-filter, and fairly interleave signals
 * across sources so the enricher sees a balanced, fresh mix. NO top-N cap
 * here — that happens AFTER enrichment so the final picks use real
 * LLM-scored quality instead of the arbitrary default score every adapter
 * assigns pre-enrichment. Timeframe is enforced HERE (pre-enrichment)
 * because LLM enrichment can't fix a stale 2023 paper — better to drop it
 * before spending tokens on it.
 */
function prefilterSignals(
  perSource: AdapterOutcome[],
  exclude: readonly string[],
  timeframeIso: string,
): PrefilterResult {
  const flat = perSource.flatMap((r) => r.signals);
  const totalRaw = flat.length;
  const deduped = dedupeSignals(flat);
  const afterDedupe = deduped.length;
  const excluded = filterExcluded(deduped, exclude);
  const afterExclude = excluded.length;
  const timeframed = filterByTimeframe(excluded, timeframeIso);
  const candidates = interleaveBySource(timeframed, PER_SOURCE_CAP_FOR_ENRICHMENT);
  return { candidates, totalRaw, afterDedupe, afterExclude };
}

/** Roll up per-source statuses into the aggregate ScannerReport status. */
function computeStatus(reports: SourceReport[]): 'ok' | 'partial' | 'failed' {
  if (reports.length === 0) return 'failed';
  const okCount = reports.filter(
    (r) => r.status === 'ok' || r.status === 'ok_empty',
  ).length;
  if (okCount === reports.length) return 'ok';
  if (okCount === 0) return 'failed';
  return 'partial';
}

/**
 * Build a brief founder context string for the enrichment LLM so it
 * can score relevance. Combines the directive keywords and narrative
 * into a compact summary the enricher uses ONLY for relevance scoring.
 */
/**
 * Build the FOUNDER CONTEXT block that feeds the enrichment LLM.
 * The enricher uses this to score `relevance` per signal. This block
 * is profile-agnostic — every field is read directly from the
 * FounderProfile shape, so the same code works for a nurse, a
 * lawyer, a data scientist, or any other founder without hard-coding.
 *
 * Fields explicitly surfaced (in addition to the directive goals
 * and the narrative prose):
 *  - Audience: who the founder wants to serve (e.g. "ordinary
 *    people", "small business owners", "K-12 teachers"). The
 *    enricher uses this to penalize audience-mismatched signals.
 *  - Customer type preference: b2b / b2c / both / no_preference.
 *  - Anti-targets: topics the enricher must hard-drop to relevance=1.
 */
export function buildFounderContext(
  directive: ScannerDirectives['tech_scout'],
  profile: Parameters<Scanner>[1],
  narrativeProse: string,
): string {
  const goals = directive.keywords.join(', ');
  const notes = directive.notes || '(none)';
  const audience = profile.audience.value ?? '(not specified)';
  const customerType = profile.customer_type_preference.value;
  const antiTargets =
    profile.anti_targets.value.length > 0
      ? profile.anti_targets.value.join(', ')
      : '(none)';
  const narrativeSnippet = narrativeProse.slice(0, 500);
  return `Goals/keywords: ${goals}
Notes: ${notes}
Audience: ${audience} (customer type preference: ${customerType})
Anti-targets (reject matches to relevance=1): ${antiTargets}
Founder summary: ${narrativeSnippet}`;
}

/**
 * Build a minimally-usable ExpandedQueryPlan when the LLM expansion
 * step fails. Uses the directive's keywords verbatim for all sources,
 * picks two generic arxiv ML categories, assumes python as the github
 * language, and sets a 6-month timeframe so adapters still produce
 * meaningful queries. In fallback mode all sources share the same
 * keywords since we can't get divergent per-source lists without the LLM.
 * `reddit_subreddits` is left empty — the Reddit adapter's built-in
 * profile-agnostic baseline (startups/microsaas/smallbusiness) keeps it
 * functional even without an LLM-picked domain sub list.
 */
function buildFallbackPlan(
  directive: ScannerDirectives['tech_scout'],
  now: Date,
): ExpandedQueryPlan {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  return {
    hn_keywords: directive.keywords,
    arxiv_keywords: directive.keywords,
    github_keywords: directive.keywords,
    reddit_keywords: directive.keywords,
    huggingface_keywords: directive.keywords,
    arxiv_categories: ['cs.LG', 'cs.AI'],
    github_languages: ['python'],
    reddit_subreddits: [],
    domain_tags: [],
    timeframe_iso: cutoff.toISOString(),
  };
}
