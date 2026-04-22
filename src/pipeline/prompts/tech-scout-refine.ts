import type { FounderProfile } from '../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../lib/types/scanner-directives';
import type { FirstPassSummary } from '../../lib/types/two-pass-state';

/**
 * System prompt for the tech-scout pass-2 refinement LLM. Reuses the
 * pass-1 EXPANSION_RESPONSE_SCHEMA for the response, so callers
 * import that schema directly; this file only provides prompt text.
 *
 * The refinement rules compose five things that are specific to pass 2:
 *   1. NEVER reuse a query that appears in `exhausted_terms`
 *   2. DOUBLE-DOWN on sparse_directions — generate 2-3 variants per sparse label
 *   3. REPHRASE empty_queries once — they might have been wording bugs
 *   4. PREFER keywords that connect to high-relevance top-signals from pass 1
 *   5. STILL PRESERVE acronyms and apply per-source divergence rules from pass 1
 */
export function buildRefineSystemPrompt(scenario?: string): string {
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  return `${marker}You are a pass-2 query refinement planner for a Tech Scout agent. You have already run pass 1 and have a summary of what it found. Your job is to generate a NEW ExpandedQueryPlan for pass 2 that is DIFFERENT from pass 1 in specific, principled ways.

REFINEMENT RULES:
1. DO NOT REUSE any query label listed in "Exhausted terms". Those directions already saturated; repeating them wastes tokens and returns the same signals.
2. DOUBLE DOWN on "Sparse directions". A sparse direction returned 1-4 signals — that's where the gap opportunities live. For each sparse label, generate 2-3 NEW keyword variants targeting the same underlying idea from a different angle.
3. REPHRASE "Empty queries" ONCE each. An empty query might mean the WORDING was wrong, OR the gap is real. Try one alternative phrasing per empty label. Do not try the same phrasing twice.
4. BUILD ON "Top signals from pass 1". These are the highest-relevance items pass 1 found. Generate keywords that chase related angles (same topic, adjacent methodology, next logical question).
5. KEEP per-source divergence: hn_keywords ≠ arxiv_keywords ≠ github_keywords. Every list 4-8 items.
6. PRESERVE acronyms verbatim (MCP stays MCP, never becomes "MC models").
7. NEVER include anything from directive.exclude.

ARXIV KEYWORD FORMAT — HARD RULE:
Each entry in arxiv_keywords MUST be plain search text only. DO NOT embed any arxiv field qualifier (like \`cat:cs.LG\`, \`cat:stat.ML\`, \`abs:\`, \`ti:\`, \`au:\`) INSIDE a keyword string. The adapter pairs each keyword with a category from arxiv_categories separately — your job is only to supply the plain phrase. CORRECT: \`"tabular foundation model"\`. WRONG: \`"cat:cs.LG tabular foundation model"\` or \`"abs:tabular"\`. The wrong forms corrupt the arxiv search URL and make the whole query fail. If pass 1 hit a saturated \`cat:cs.LG × "foo"\` query, your refinement goes in the keyword (e.g. \`"foo alternative"\`), never the category prefix.

OUTPUT FORMAT: Match the EXPANSION_RESPONSE_SCHEMA exactly (the same schema pass 1 used). Downstream post-processing will apply exclude filtering, acronym preservation, and generic keyword demotion automatically.`;
}

/**
 * Build the user prompt for the pass-2 refinement LLM. Serializes
 * the directive, founder profile (skills + domain), and the full
 * FirstPassSummary so the LLM can reason over dense/sparse/empty
 * directions and the top signals produced by pass 1.
 */
export function buildRefineUserPrompt(
  directive: ScannerDirectives['tech_scout'],
  profile: FounderProfile,
  summary: FirstPassSummary,
): string {
  const skills = profile.skills.value.join(', ') || '(none)';
  const domains =
    profile.domain.value
      .map((d) => (d.years ? `${d.area} (${d.years}y)` : d.area))
      .join(', ') || '(none)';
  const excludeList =
    directive.exclude.length > 0 ? directive.exclude.join(', ') : '(none)';

  const denseBlock =
    summary.dense_directions.length > 0
      ? summary.dense_directions.map((d) => `- ${d}`).join('\n')
      : '(none)';
  const sparseBlock =
    summary.sparse_directions.length > 0
      ? summary.sparse_directions.map((d) => `- ${d}`).join('\n')
      : '(none)';
  const emptyBlock =
    summary.empty_queries.length > 0
      ? summary.empty_queries.map((d) => `- ${d}`).join('\n')
      : '(none)';
  const exhaustedBlock =
    summary.exhausted_terms.length > 0
      ? summary.exhausted_terms.map((d) => `- ${d}`).join('\n')
      : '(none)';
  const topBlock =
    summary.top_signal_summary.length > 0
      ? summary.top_signal_summary
          .map(
            (t) =>
              `- [${t.source}] ${t.title} (relevance=${t.relevance}, recency=${t.recency})`,
          )
          .join('\n')
      : '(none)';

  return `Directive keywords: ${directive.keywords.join(', ')}
Directive exclude: ${excludeList}
Directive notes: ${directive.notes || '(none)'}
Directive timeframe: ${directive.timeframe}

Founder skills: ${skills}
Founder domain(s): ${domains}

=== Pass 1 summary ===

Dense directions (saturated — do not repeat):
${denseBlock}

Sparse directions (GAP OPPORTUNITIES — double down here):
${sparseBlock}

Empty queries (rephrase once each; may be wording bugs or real gaps):
${emptyBlock}

Exhausted terms (HARD ban — do not reuse):
${exhaustedBlock}

Top signals pass 1 found (build on these):
${topBlock}

Produce the pass-2 ExpandedQueryPlan as a JSON object matching the schema.`;
}
