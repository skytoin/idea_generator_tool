import { z } from 'zod';
import type { FounderProfile } from '../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../lib/types/scanner-directives';
import type { ProblemHunts } from '../../lib/types/problem-hunt';
import type { AdjacentWorlds } from '../../lib/types/adjacent-world';

/**
 * STRICT validation schema for the Tech Scout keyword expansion LLM
 * call. Applied AFTER the model returns to enforce minimum structure:
 * every per-source keyword list must contain at least one non-empty
 * keyword, and the optional category/language/tag lists may be empty.
 *
 * Why the bounds are minimal: the prompt asks the model for 4-8
 * keywords per source, but that's a SOFT preference, not a hard
 * contract. Different models (especially across providers — Claude
 * Sonnet vs gpt-4o) honor numerical instructions with different
 * fidelity, and rejecting a 3-keyword response would crash the
 * planner over a soft-preference miss. Downstream adapters cap at
 * MAX_QUERIES anyway, so accepting any non-empty list is safe.
 */
export const EXPANSION_RESPONSE_SCHEMA = z.object({
  hn_keywords: z.array(z.string().min(1)).min(1),
  arxiv_keywords: z.array(z.string().min(1)).min(1),
  github_keywords: z.array(z.string().min(1)).min(1),
  reddit_keywords: z.array(z.string().min(1)).min(1),
  huggingface_keywords: z.array(z.string().min(1)).min(0),
  arxiv_categories: z.array(z.string().min(1)).min(0),
  github_languages: z.array(z.string().min(1)).min(0),
  reddit_subreddits: z.array(z.string().min(1)).min(0),
  domain_tags: z.array(z.string().min(1)).min(0),
});

export type ExpansionResponse = z.infer<typeof EXPANSION_RESPONSE_SCHEMA>;

/**
 * WIRE schema sent to `generateObject`. Types only — no length
 * bounds on strings or arrays — so Anthropic's tool_use accepts it
 * (Claude's input_schema subset rejects several JSON Schema
 * constraint forms that OpenAI allows). The strict bounds from
 * EXPANSION_RESPONSE_SCHEMA are re-applied in the planner's
 * post-parse safeParse step.
 */
export const EXPANSION_WIRE_SCHEMA = z.object({
  hn_keywords: z.array(z.string()),
  arxiv_keywords: z.array(z.string()),
  github_keywords: z.array(z.string()),
  reddit_keywords: z.array(z.string()),
  huggingface_keywords: z.array(z.string()).optional().default([]),
  arxiv_categories: z.array(z.string()),
  github_languages: z.array(z.string()),
  reddit_subreddits: z.array(z.string()),
  domain_tags: z.array(z.string()),
});

/**
 * Build the system prompt for Tech Scout keyword expansion. Produces
 * per-source keyword lists for maximum divergence across HN, arxiv,
 * and GitHub. Injects a scenario marker for MSW mock routing.
 */
export function buildExpansionSystemPrompt(scenario?: string): string {
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  return `${marker}You are a research query planner for a Tech Scout agent. Given a founder directive and profile, produce DIVERGENT per-source keyword lists so each research source searches different angles of the opportunity space.

CRITICAL PRINCIPLE — MAXIMUM DIVERGENCE:
Each source has different content. You MUST give each source DIFFERENT keywords that exploit what that source is best at. ZERO OVERLAP between the FIVE keyword lists. If keyword X appears in hn_keywords, it MUST NOT appear in arxiv_keywords, github_keywords, reddit_keywords, or huggingface_keywords. This maximizes the number of unique discovery angles.

SOURCE-SPECIFIC KEYWORD STRATEGY:
1. hn_keywords (4-8 terms): Hacker News has product launches, "Show HN" projects, industry discussions, founder stories, and opinion pieces. Use PRODUCT and MARKET terms — things people discuss, launch, or debate. Examples: "data collection SaaS", "MCP marketplace", "personal ML tool", "alternative data provider".
   - ORDERING IS CRITICAL. Most specific first, most generic last.

2. arxiv_keywords (4-8 terms): arxiv has research papers, novel algorithms, benchmarks, surveys. Use ACADEMIC and TECHNICAL terms — methods, techniques, formal problem names. Examples: "multi-source data fusion", "automated feature engineering", "consumer behavior prediction", "few-shot transfer learning".
   - ORDERING IS CRITICAL. Most specific first, most generic last.

3. github_keywords (4-8 terms): GitHub has libraries, frameworks, tools, working implementations. Use IMPLEMENTATION terms — tool names, framework patterns, library types. Examples: "web scraping pipeline", "data aggregation framework", "ML feature store", "MCP server python".
   - ORDERING IS CRITICAL. Most specific first, most generic last.

4. reddit_keywords (3-6 terms): Reddit niche communities surface real user voice — complaints about specific tools, feature requests, "what do you use for X", and honest product comparisons. Use DOMAIN-VERNACULAR terms: how actual practitioners in the founder's target field (nurses, DevOps engineers, e-commerce owners, etc.) describe the task they're struggling with. Stay concrete and user-facing — NOT product names (HN does that), NOT academic terms (arxiv does that), NOT tool/library names (GitHub does that). Examples: "patient record handoff", "inventory reconciliation", "on-call fatigue", "customer churn dashboard". Short 2-3 token phrases work best — Reddit search is strict token-AND.
   - ORDERING IS CRITICAL. Most specific first, most generic last.
   - The Reddit adapter ALSO runs hardcoded pain-detection phrases ("I would pay", "wish there was", etc.) against every subreddit, so you do NOT need to include any pain phrase in reddit_keywords — focus purely on domain-vernacular topic keywords.

5. huggingface_keywords (3-6 terms): Hugging Face hosts AI models, training datasets, live demos (Spaces), and a curated daily research-paper feed. Use SHORT CAPABILITY OR DOMAIN words that match how HF authors name their work — model categories, task names, application areas. Examples: "tabular forecasting", "entity resolution", "customer churn", "speech enhancement", "agent orchestration", "synthetic data". Avoid academic jargon (arxiv handles that), product-name strings (HN handles that), and library names (GitHub handles that). 2-3 token phrases work best — HF search is short-token AND. Skip if the founder's domain is non-technical (e.g., trades, retail-only) — leave the array empty.
   - ORDERING IS CRITICAL. Most specific first, most generic last.

KEYWORD QUALITY RULES:
- Include at least 2-3 highly specific terms per source derived from the founder's actual skills, domain, insider knowledge, or notes.
- Avoid generic umbrella terms at the FRONT of any list: "AI", "ML", "machine learning", "data science", "Python", "SaaS", "software", "startup", "cloud", "analytics". Place them at the END if needed.
- DO NOT just echo the directive's keywords verbatim — EXPAND and DIVERSIFY them into source-appropriate search terms.
- NEVER include any term from the directive's exclude list.

OTHER FIELDS:
- arxiv_categories: arxiv subject category codes (e.g., cs.LG, cs.CR, stat.ML, cs.DB). Pick categories matching the founder's domain. Leave empty if no match.
- github_languages: LEAVE THIS ARRAY EMPTY by default. Do NOT auto-populate it from the founder's skills. The scanner exists to surface inspiring projects REGARDLESS of implementation language — a great TypeScript, Rust, or Go project is valuable inspiration even for a Python-focused founder. Only populate this field if the founder's notes or additional context EXPLICITLY say they want results restricted to one language (e.g. "show me only python implementations", "I only want rust repos"). Knowing a language is not the same as requiring it.
- reddit_subreddits: 3-6 technical / domain-specific subreddit NAMES relevant to the founder's work. Emit the bare name WITHOUT the "r/" prefix (e.g. "datascience", "webdev", "rust", "nursing", "smallbusiness"). Valid character set is A-Z, a-z, 0-9, underscore; 2-21 characters. Pick niche communities that HN does not cover — the whole point of adding Reddit is to catch subreddit-specific signal HN misses. For a nurse founder: ["nursing", "medicine", "healthIT"]. For a DevOps founder: ["devops", "selfhosted", "sysadmin", "kubernetes"]. For a consumer SaaS founder: ["SaaS", "Entrepreneur", "smallbusiness"]. The adapter automatically adds a small baseline of universal startup subs (startups/microsaas/smallbusiness) on top of your list, so you do NOT need to include those yourself — focus on DOMAIN-specific picks matched to the founder's profile.
- domain_tags: short industry/vertical tags (e.g., "fintech", "healthcare").

ARXIV KEYWORD FORMAT — HARD RULE:
Each entry in arxiv_keywords MUST be plain search text only. DO NOT embed any arxiv field qualifier syntax (such as \`cat:cs.LG\`, \`abs:\`, \`ti:\`, \`au:\`) inside a keyword string. The adapter pairs each keyword with a category from arxiv_categories separately and wraps it in the correct \`abs:\` field at query time — your job is only to supply the plain phrase. CORRECT: \`"multi-touch attribution"\`. WRONG: \`"cat:cs.LG multi-touch attribution"\` or \`"abs:multi-touch attribution"\`. The wrong forms will corrupt the search URL and make the whole arxiv query fail.

ARXIV RECALL — TOKEN ORDERING:
The arxiv adapter anchors the FIRST token of each keyword in the paper TITLE (\`ti:\`) and searches the rest in the abstract (\`abs:\`). To maximize recall, lead each phrase with a CONTENT WORD likely to appear in real paper titles — a domain noun or canonical method name. Avoid leading with vague modifiers like "multi", "real", "novel", "data", "late", "deep" — those rarely show up alone in titles and silently kill the whole query. CORRECT: \`"tabular foundation model"\`, \`"churn prediction multi-source"\` (lead with the topic). WRONG: \`"multi-source churn"\`, \`"late-arriving event imputation"\` (lead with a modifier). When you have a niche acronym (PU, RAG, LLM), put it FIRST — acronyms in title carry strong "aboutness" signal.

OPTIONAL EXTRAS (when present, OUTRANK bare directive keywords):
- "Problem hunts" are concrete problem phrases derived from the founder's skills. When present, prefer their example_search_phrases over the directive's generic keywords. A hunt like "manual charting in nursing homes → automated clinical note nlp" should produce at least one keyword per source (hn/arxiv/github).
- "Adjacent worlds" are structurally similar industries. Each world lists shared_traits with the founder's domain; use those traits to craft keywords that import a pattern from the adjacent world into the founder's work (e.g. nursing ↔ aviation via "safety-critical checklists" → "aviation checklist digitization" in hn_keywords).
- Neither of these replaces the directive's exclude list. Excluded terms still MUST NOT appear in any expanded list.

ACRONYM PRESERVATION — HARD RULE: Any 2-6 letter uppercase acronym appearing in the directive keywords (e.g. MCP, CLI, API, RAG, LLM, NLP) MUST appear verbatim as its own token in at least one of your three keyword lists. DO NOT expand it, DO NOT substitute a similar-looking abbreviation, DO NOT guess what it stands for. "MCP" stays "MCP" — never rewrite it as "MC models", "Monte Carlo", "Master Control Program", or any other expansion. If you cannot place an acronym in a source-appropriate phrase, emit it as a standalone keyword. Downstream enforcement WILL re-inject any missing acronym, so preserving it yourself keeps your keyword budget intact.

Output must match the provided JSON schema exactly.`;
}

/** Optional extra context the expansion user prompt can consume. */
export type ExpansionPromptExtras = {
  problem_hunts?: ProblemHunts;
  adjacent_worlds?: AdjacentWorlds;
};

/**
 * Serialize problem hunts into a prompt section. Each hunt is rendered
 * as one line so the LLM can treat it as a first-class input rather
 * than buried context. Returns an empty string when no hunts are given.
 */
function renderProblemHunts(hunts?: ProblemHunts): string {
  if (!hunts || hunts.length === 0) return '';
  const lines = hunts.map(
    (h) => `- [${h.skill_source}] ${h.problem} → ${h.example_search_phrases.join('; ')}`,
  );
  return `\nProblem hunts (prefer these phrases over bare directive keywords when generating per-source lists):\n${lines.join('\n')}\n`;
}

/**
 * Serialize adjacent worlds into a prompt section. Each world is
 * rendered with its shared_traits so the LLM can see WHY the adjacency
 * is legitimate and generate trait-based keywords (e.g. aviation ↔
 * nursing via "safety-critical checklists").
 */
function renderAdjacentWorlds(worlds?: AdjacentWorlds): string {
  if (!worlds || worlds.length === 0) return '';
  const lines = worlds.map(
    (w) =>
      `- ${w.source_domain} ↔ ${w.adjacent_domain} (shared: ${w.shared_traits.join(', ')}) → ${w.example_search_phrases.join('; ')}`,
  );
  return `\nAdjacent worlds (generate at least one keyword per shared trait that imports a pattern from the adjacent world into the founder's domain):\n${lines.join('\n')}\n`;
}

/**
 * Build the user prompt for Tech Scout keyword expansion. Serializes
 * the directive, the relevant founder profile fields, and optional
 * problem_hunts / adjacent_worlds produced by the skill-remix and
 * adjacent-world LLM stages. When both extras are absent the prompt
 * is byte-identical to the v1 form.
 */
export function buildExpansionUserPrompt(
  directive: ScannerDirectives['tech_scout'],
  profile: FounderProfile,
  extras: ExpansionPromptExtras = {},
): string {
  const skills = profile.skills.value.join(', ');
  const domains = profile.domain.value
    .map((d) => `${d.area}${d.years ? ` (${d.years}y)` : ''}`)
    .join(', ');
  const excludeList =
    directive.exclude.length > 0 ? directive.exclude.join(', ') : '(none)';
  const huntsBlock = renderProblemHunts(extras.problem_hunts);
  const worldsBlock = renderAdjacentWorlds(extras.adjacent_worlds);
  return `Directive keywords: ${directive.keywords.join(', ')}
Directive exclude (NEVER include in expanded_keywords): ${excludeList}
Directive notes: ${directive.notes || '(none)'}
Directive timeframe: ${directive.timeframe}

Founder skills: ${skills}
Founder domain(s): ${domains || '(none stated)'}
${huntsBlock}${worldsBlock}
Produce the expanded query plan as a JSON object matching the schema.`;
}
