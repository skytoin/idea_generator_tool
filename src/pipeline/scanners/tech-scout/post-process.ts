import type { Signal } from '../../../lib/types/signal';

/**
 * Composite signal score used by dedupe and ranking. Relevance is
 * weighted 2× because a highly relevant signal with moderate novelty
 * is more useful to the founder than a very novel but irrelevant one.
 * Max possible: 20 (relevance) + 10 + 10 + 10 = 50.
 */
function compositeScore(s: Signal): number {
  return s.score.relevance * 2 + s.score.novelty + s.score.specificity + s.score.recency;
}

/**
 * Dedupe signals by URL, keeping the highest-scoring signal in each
 * duplicate group. Multiple adapters can surface the same upstream
 * page (e.g., HN and GitHub both pointing at the same repo), so URL
 * dedup is the canonical identity check.
 */
export function dedupeSignals(signals: Signal[]): Signal[] {
  const byUrl = new Map<string, Signal>();
  for (const s of signals) {
    const existing = byUrl.get(s.url);
    if (!existing || compositeScore(s) > compositeScore(existing)) {
      byUrl.set(s.url, s);
    }
  }
  return Array.from(byUrl.values());
}

/**
 * Drop signals whose title or snippet contains any excluded term
 * (case-insensitive substring match). The empty-exclude fast path
 * returns the input reference so callers can skip work cheaply.
 */
export function filterExcluded(signals: Signal[], exclude: readonly string[]): Signal[] {
  if (exclude.length === 0) return signals;
  const lower = exclude.map((e) => e.toLowerCase());
  return signals.filter((s) => !matchesAnyExclude(s, lower));
}

/** Return true when the signal's title or snippet contains an excluded term. */
function matchesAnyExclude(s: Signal, lowerExclude: string[]): boolean {
  const t = s.title.toLowerCase();
  const n = s.snippet.toLowerCase();
  return lowerExclude.some((e) => t.includes(e) || n.includes(e));
}

/**
 * Sort signals descending by composite score. Returns a new array so
 * callers can keep the original order intact for debugging or
 * alternative ranking passes.
 */
export function sortByScore(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => compositeScore(b) - compositeScore(a));
}

/** Return the top N signals after sorting by composite score. */
export function keepTop(signals: Signal[], n: number): Signal[] {
  return sortByScore(signals).slice(0, n);
}

/**
 * Drop signals whose `date` is strictly before `cutoffIso`. Signals
 * with `date: null` are KEPT because we cannot prove they are stale
 * (some adapters normalize dateless items rather than dropping them).
 * An unparseable cutoff or epoch cutoff is a no-op. This enforces the
 * directive.timeframe hard floor on arxiv papers that would otherwise
 * leak through keepTop purely on composite score.
 */
export function filterByTimeframe(signals: Signal[], cutoffIso: string): Signal[] {
  const cutoff = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoff) || cutoff <= 0) return signals;
  return signals.filter((s) => {
    if (s.date === null) return true;
    const ts = Date.parse(s.date);
    if (!Number.isFinite(ts)) return true;
    return ts >= cutoff;
  });
}

/**
 * Quality floor for enriched signals. Drops anything whose individual
 * `relevance` or `recency` score (1–10 scale) is below the supplied
 * minimums. Applied AFTER enrichment so it filters on real LLM-scored
 * numbers, not the default 5/5/5/5 pre-enrichment placeholder. Both
 * thresholds are inclusive — a score equal to the floor passes.
 */
export function filterByMinScore(
  signals: Signal[],
  opts: { minRelevance: number; minRecency: number },
): Signal[] {
  return signals.filter(
    (s) => s.score.relevance >= opts.minRelevance && s.score.recency >= opts.minRecency,
  );
}

/**
 * Take up to `perSourceCap` signals from each unique source, preserving
 * the original order within each source. This is a fairness mechanism
 * applied BEFORE enrichment so the enricher sees a balanced sample from
 * every adapter, not just whichever adapter happened to produce the most
 * raw signals first. Without this, one verbose source (e.g., HN returning
 * 90 hits) would fill the enrichment budget entirely and silently drop
 * every signal from sources with fewer raw results.
 *
 * Input order: adapter-registry order (HN → arxiv → GitHub in v1).
 * Output order: first `perSourceCap` from HN, then first `perSourceCap`
 * from arxiv, then first `perSourceCap` from GitHub.
 */
export function interleaveBySource(signals: Signal[], perSourceCap: number): Signal[] {
  if (perSourceCap <= 0) return [];
  const bySource = new Map<string, Signal[]>();
  for (const s of signals) {
    const bucket = bySource.get(s.source) ?? [];
    bucket.push(s);
    bySource.set(s.source, bucket);
  }
  const out: Signal[] = [];
  for (const bucket of bySource.values()) {
    out.push(...bucket.slice(0, perSourceCap));
  }
  return out;
}
