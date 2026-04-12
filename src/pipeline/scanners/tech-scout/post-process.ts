import type { Signal } from '../../../lib/types/signal';

/**
 * Composite signal score used by dedupe and ranking. Adds the three
 * score axes so a single number captures overall relevance without
 * biasing toward any single dimension.
 */
function compositeScore(s: Signal): number {
  return s.score.novelty + s.score.specificity + s.score.recency;
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
export function filterExcluded(
  signals: Signal[],
  exclude: readonly string[],
): Signal[] {
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
export function interleaveBySource(
  signals: Signal[],
  perSourceCap: number,
): Signal[] {
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
