import type { Signal } from '../../../lib/types/signal';
import type { SourceReport } from '../../../lib/types/source-report';
import type {
  FirstPassSummary,
  QueryRun,
  TopSignalSummary,
} from '../../../lib/types/two-pass-state';

/** A query that returned ≥ this many raw items is considered saturated. */
const DENSE_THRESHOLD = 5;
/** A query that returned ≥ this many raw items is "exhausted" (refuse pass-2 reuse). */
const EXHAUSTED_THRESHOLD = 10;
/** Max top-signal summaries captured per source for the refinement prompt. */
const TOP_PER_SOURCE = 5;

/**
 * Produce a compact summary of a first-pass scanner run. Pure function:
 * no LLM, no network, just shape transformation over the pass-1 outputs.
 *
 * Classifies each query label into one of three buckets by result count:
 *   - dense: ≥ DENSE_THRESHOLD (saturated)
 *   - sparse: 1..DENSE_THRESHOLD-1 (gap opportunity)
 *   - empty: 0 (absence signal — the most interesting bucket)
 *
 * Any query that hit EXHAUSTED_THRESHOLD or more is also added to
 * `exhausted_terms` so the refinement planner refuses to reuse it.
 */
export function summarizeFirstPass(args: {
  sourceReports: readonly SourceReport[];
  enrichedSignals: readonly Signal[];
}): FirstPassSummary {
  const queries_run = collectQueryRuns(args.sourceReports);
  const { dense, sparse, empty } = classifyQueries(args.sourceReports);
  const exhausted_terms = collectExhaustedTerms(args.sourceReports);
  const top_signal_summary = collectTopSignals(args.enrichedSignals);
  return {
    queries_run,
    dense_directions: dense,
    sparse_directions: sparse,
    empty_queries: empty,
    top_signal_summary,
    exhausted_terms,
  };
}

/**
 * Flatten per-source reports into one ordered list of QueryRun entries.
 * We know the exact result_count only for queries that returned zero
 * (via queries_with_zero_results) or for the total aggregated across
 * the adapter's queries; since adapters don't expose per-query counts,
 * the non-empty entries use `signals_count / (queries_ran.length - zeroCount)`
 * as an average estimate. Good enough for dense/sparse/empty bucketing.
 */
function collectQueryRuns(reports: readonly SourceReport[]): QueryRun[] {
  const out: QueryRun[] = [];
  for (const r of reports) {
    const zeroSet = new Set(r.queries_with_zero_results);
    const nonZeroQueries = r.queries_ran.filter((q) => !zeroSet.has(q));
    // If the adapter reports signals_count=0, every query is empty
    // regardless of what queries_with_zero_results says — we cannot
    // attribute signals that don't exist. This makes a `failed` or
    // `ok_empty` source report correctly classify all of its queries
    // as empty, so they reach the absence-as-signal bucket.
    const avgNonZero =
      r.signals_count > 0 && nonZeroQueries.length > 0
        ? Math.max(1, Math.round(r.signals_count / nonZeroQueries.length))
        : 0;
    for (const label of r.queries_ran) {
      out.push({
        source: r.name,
        label,
        result_count: zeroSet.has(label) || r.signals_count === 0 ? 0 : avgNonZero,
      });
    }
  }
  return out;
}

/** Partition query labels into dense / sparse / empty buckets. */
function classifyQueries(reports: readonly SourceReport[]): {
  dense: string[];
  sparse: string[];
  empty: string[];
} {
  const dense: string[] = [];
  const sparse: string[] = [];
  const empty: string[] = [];
  const runs = collectQueryRuns(reports);
  for (const q of runs) {
    if (q.result_count === 0) empty.push(q.label);
    else if (q.result_count >= DENSE_THRESHOLD) dense.push(q.label);
    else sparse.push(q.label);
  }
  return { dense, sparse, empty };
}

/**
 * Extract query labels that saturated (≥ EXHAUSTED_THRESHOLD). The
 * refinement prompt uses this list as a "do not reuse" set so pass 2
 * doesn't burn budget on directions that already maxed out.
 */
function collectExhaustedTerms(reports: readonly SourceReport[]): string[] {
  const out: string[] = [];
  const runs = collectQueryRuns(reports);
  for (const q of runs) {
    if (q.result_count >= EXHAUSTED_THRESHOLD) out.push(q.label);
  }
  return out;
}

/**
 * Pick the top-scoring enriched signals per source (up to TOP_PER_SOURCE
 * per source) so the refinement LLM can see what pass 1 actually found.
 * Sorts descending by relevance + recency composite to surface the
 * signals most worth building on.
 */
function collectTopSignals(signals: readonly Signal[]): TopSignalSummary[] {
  const bySource = new Map<string, Signal[]>();
  for (const s of signals) {
    const bucket = bySource.get(s.source) ?? [];
    bucket.push(s);
    bySource.set(s.source, bucket);
  }
  const out: TopSignalSummary[] = [];
  for (const bucket of bySource.values()) {
    const sorted = [...bucket].sort(
      (a, b) =>
        b.score.relevance + b.score.recency - (a.score.relevance + a.score.recency),
    );
    for (const s of sorted.slice(0, TOP_PER_SOURCE)) {
      out.push({
        source: s.source,
        title: s.title,
        relevance: s.score.relevance,
        recency: s.score.recency,
      });
    }
  }
  return out;
}
