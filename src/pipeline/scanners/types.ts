import type { FounderProfile } from '../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../lib/types/scanner-directives';
import type { Signal } from '../../lib/types/signal';
import type { ScannerReport } from '../../lib/types/scanner-report';

/**
 * LLM-produced query expansion plan. The tech_scout planner takes the
 * frame directive + founder narrative and expands the seed keywords
 * into per-source keyword lists so each adapter gets divergent,
 * source-optimized search terms. HN keywords target product discussions,
 * arxiv keywords target academic research, GitHub keywords target
 * implementations and libraries.
 */
export type ExpandedQueryPlan = {
  hn_keywords: string[];
  arxiv_keywords: string[];
  github_keywords: string[];
  arxiv_categories: string[];
  github_languages: string[];
  domain_tags: string[];
  timeframe_iso: string;
};

/**
 * A single query a source adapter will execute. `label` is a human-
 * readable identifier surfaced in SourceReport.queries_ran; `params`
 * is the adapter-specific payload (e.g. Algolia search params).
 */
export type SourceQuery = {
  label: string;
  params: Record<string, unknown>;
};

/**
 * A raw, un-normalized record fetched from a source. Each adapter
 * wraps its upstream response in this envelope so the orchestrator
 * can batch normalize() calls uniformly.
 */
export type RawItem = {
  source: string;
  data: unknown;
};

/**
 * Options passed to an adapter's fetch() call. `timeoutMs` is the
 * deadline the orchestrator will enforce via withTimeout(); `signal`
 * is the corresponding AbortSignal so fetch() can cancel in flight.
 */
export type FetchOpts = {
  timeoutMs: number;
  signal?: AbortSignal;
};

/**
 * Contract every tech_scout source adapter must satisfy. Implementations
 * live in src/pipeline/scanners/tech-scout/adapters/*. The three methods
 * separate planning (pure), fetching (IO + timeouts), and normalization
 * (pure) so each can be unit-tested in isolation.
 */
export type SourceAdapter = {
  name: string;
  planQueries(
    plan: ExpandedQueryPlan,
    directive: ScannerDirectives['tech_scout'],
  ): SourceQuery[];
  fetch(queries: SourceQuery[], opts: FetchOpts): Promise<RawItem[]>;
  normalize(raw: RawItem): Signal;
};

/**
 * Dependencies injected into every scanner run. `clock` is a testable
 * time source; `scenarios` is an optional per-component MSW scenario
 * selector so tests can drive each adapter (hn_algolia, arxiv, github)
 * or LLM pass (expansion, enrichment, skill_remix, adjacent_worlds,
 * refine) into a specific fixture branch. `features` is a per-run
 * flag bag for opt-in v2 pipeline stages: set `skill_remix` to inject
 * problem hunts, `adjacent_worlds` to inject analogical worlds, and
 * `two_pass` to run the pass-1 → refine → pass-2 loop. All default to
 * OFF so existing v1 behavior is unchanged when these are omitted.
 */
export type ScannerDeps = {
  clock: () => Date;
  scenarios?: {
    expansion?: string;
    enrichment?: string;
    hn_algolia?: string;
    arxiv?: string;
    github?: string;
    skill_remix?: string;
    adjacent_worlds?: string;
    refine?: string;
  };
  features?: {
    skill_remix?: boolean;
    adjacent_worlds?: boolean;
    two_pass?: boolean;
  };
};

/**
 * Signature for a top-level scanner function (e.g. tech_scout). Takes
 * the scanner's slice of the frame directive, the full founder profile
 * and narrative prose, plus injectable deps; returns a ScannerReport.
 * Never throws: errors are reflected in report.status and report.errors.
 */
export type Scanner = (
  directive: ScannerDirectives['tech_scout'],
  profile: FounderProfile,
  narrativeProse: string,
  deps: ScannerDeps,
) => Promise<ScannerReport>;
