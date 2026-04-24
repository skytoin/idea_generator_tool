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
5. KEEP per-source divergence: hn_keywords, arxiv_keywords, github_keywords, reddit_keywords, and huggingface_keywords must each carry DIFFERENT terms — zero overlap across the FIVE lists. HN ~4-8 items, arxiv ~4-8 items, github ~4-8 items, reddit ~3-6 items, huggingface ~3-6 items (capability/domain words like "tabular forecasting", "entity resolution", "agent orchestration" — empty array is fine for non-AI-adjacent founders). Also refresh reddit_subreddits if pass 1's sparse/empty signals suggest the community choices missed — you can swap in niche subs that better match an under-hit direction.
6. PRESERVE acronyms verbatim (MCP stays MCP, never becomes "MC models").
7. NEVER include anything from directive.exclude.

GITHUB_LANGUAGES — HARD RULE:
Leave \`github_languages\` as an EMPTY ARRAY \`[]\` by default. Only populate it (with at most 5 entries from the standard set: Python, TypeScript, JavaScript, Go, Rust, Julia, R, SQL, Java, Kotlin, Scala, C++, C#, Ruby, Shell, Swift, PHP) if the founder's notes EXPLICITLY restrict the language. Knowing a language is not the same as requiring it. NEVER emit obscure entries like "Adobe Font", "5th Gen", "1C Enterprise", "AGS Script", or "VBScript" — they will be silently dropped by the post-parse sanitizer, wasting your output budget.

ARXIV KEYWORD FORMAT — HARD RULE:
Each entry in arxiv_keywords MUST be plain search text only. DO NOT embed any arxiv field qualifier (like \`cat:cs.LG\`, \`cat:stat.ML\`, \`abs:\`, \`ti:\`, \`au:\`) INSIDE a keyword string. The adapter pairs each keyword with a category from arxiv_categories separately — your job is only to supply the plain phrase. CORRECT: \`"tabular foundation model"\`. WRONG: \`"cat:cs.LG tabular foundation model"\` or \`"abs:tabular"\`. The wrong forms corrupt the arxiv search URL and make the whole query fail. If pass 1 hit a saturated \`cat:cs.LG × "foo"\` query, your refinement goes in the keyword (e.g. \`"foo alternative"\`), never the category prefix.

ARXIV RECALL — TOKEN ORDERING + SPARSE-DIRECTION BROADENING:
The arxiv adapter anchors the FIRST token in title (\`ti:\`) and searches the rest in abstract (\`abs:\`). Lead each phrase with a CONTENT WORD likely to appear in paper titles — a domain noun or canonical method name. Avoid leading with vague modifiers ("multi", "real", "novel", "data", "late", "deep"). When refining a SPARSE arxiv direction (1-4 results), do not just rephrase — BROADEN: drop a niche modifier, swap a hyper-specific term for its parent concept (e.g. \`"PU learning for CRM"\` → \`"semi-supervised classification"\`, \`"late-arriving event imputation"\` → \`"streaming data imputation"\`). The fallback path will retry your phrase without the title anchor automatically, so you don't need to hedge — just lead with the most plausibly-in-title word.

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
