import { generateObject } from 'ai';
import { ok, err, type Result } from '../../../lib/utils/result';
import { models } from '../../../lib/ai/models';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import type { ProblemHunts } from '../../../lib/types/problem-hunt';
import type { AdjacentWorlds } from '../../../lib/types/adjacent-world';
import type { ExpandedQueryPlan } from '../types';
import {
  EXPANSION_RESPONSE_SCHEMA,
  EXPANSION_WIRE_SCHEMA,
  buildExpansionSystemPrompt,
  buildExpansionUserPrompt,
  type ExpansionResponse,
} from '../../prompts/tech-scout-expansion';

/**
 * Error kinds surfaced by the query planner. `llm_failed` covers
 * transport and timeouts; `schema_invalid` covers responses that
 * parse as JSON but violate EXPANSION_RESPONSE_SCHEMA.
 */
export type PlannerError =
  | { kind: 'llm_failed'; message: string }
  | { kind: 'schema_invalid'; message: string };

export type PlannerOptions = {
  /** Testable clock source. Defaults to `() => new Date()`. */
  clock?: () => Date;
  /** Scenario marker routed through the MSW OpenAI mock. */
  scenario?: string;
  /** Problem hunts produced by the skill-remix LLM stage (v2). */
  problem_hunts?: ProblemHunts;
  /** Adjacent worlds produced by the adjacent-world LLM stage (v2). */
  adjacent_worlds?: AdjacentWorlds;
};

/**
 * Parse a natural-language timeframe into an ISO 8601 date cutoff relative
 * to `now`. Accepts a wide variety of directional prefixes (last/next/past)
 * AND bare counts because scanners always look backward in time regardless
 * of whether the directives LLM wrote "last 6 months", "next 6 months" (a
 * common LLM hallucination — future tense for a backward-looking scanner),
 * "past 6 months", or just "6 months". All of these mean "6 months before
 * now" for our purposes.
 *
 * Examples of parseable inputs:
 *   "last 6 months", "next 6 months", "past 6 months", "6 months"
 *   "last 30 days", "30 days", "next 2 years"
 *   "last month" (count defaults to 1), "week", "year"
 *
 * Unparseable strings (empty, "forever", gibberish) fall back to the Unix
 * epoch so downstream filters treat them as "no time bound". A count of 0
 * with a unit (e.g., "last 0 days") resolves to `now` since subtracting
 * zero units leaves the date unchanged — documenting that edge as a no-op
 * rather than a fall-through to epoch.
 */
export function parseTimeframeToIso(timeframe: string, now: Date): string {
  const s = timeframe.toLowerCase().trim();
  const match = s.match(/^(?:last|next|past)?\s*(\d+)?\s*(day|week|month|year)s?$/);
  if (!match) return new Date(0).toISOString();
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const unit = match[2];
  const date = new Date(now);
  if (unit === 'day') date.setUTCDate(date.getUTCDate() - count);
  else if (unit === 'week') date.setUTCDate(date.getUTCDate() - 7 * count);
  else if (unit === 'month') date.setUTCMonth(date.getUTCMonth() - count);
  else if (unit === 'year') date.setUTCFullYear(date.getUTCFullYear() - count);
  return date.toISOString();
}

/**
 * Remove any keywords that match a directive exclude entry
 * (case-insensitive) from ALL per-source keyword lists. Applied after
 * the LLM response because a misbehaving model may echo excluded terms
 * despite the system prompt telling it not to.
 */
function filterExcludes(
  response: ExpansionResponse,
  exclude: readonly string[],
): ExpansionResponse {
  const lower = new Set(exclude.map((e) => e.toLowerCase()));
  const strip = (kws: string[]) => kws.filter((kw) => !lower.has(kw.toLowerCase()));
  return {
    ...response,
    hn_keywords: strip(response.hn_keywords),
    arxiv_keywords: strip(response.arxiv_keywords),
    github_keywords: strip(response.github_keywords),
  };
}

/**
 * An "acronym" for our purposes is a token of 2-6 uppercase letters with
 * no digits, spaces, or lowercase. Examples: MCP, API, CLI, RAG, LLM,
 * NLP, BERT. This rules out mixed-case brand names (SaaS, Python) and
 * long all-caps words like HACKATHON which are rarely real acronyms.
 */
const ACRONYM_REGEX = /^[A-Z]{2,6}$/;

/**
 * True when `kw` looks like an all-uppercase acronym (2-6 letters). The
 * regex is strict on purpose: mixed-case tokens slip through to normal
 * keyword handling instead of being force-preserved.
 */
function isAcronym(kw: string): boolean {
  return ACRONYM_REGEX.test(kw.trim());
}

/**
 * True when `acronym` appears as a whole-word substring (case-insensitive)
 * anywhere in the joined keyword haystack. Word boundaries matter:
 * "adaptive MC models" must NOT match "MCP", since MC ⊊ MCP accidentally.
 */
function containsAsWord(haystack: string, acronym: string): boolean {
  const pattern = new RegExp(`\\b${acronym}\\b`, 'i');
  return pattern.test(haystack);
}

/**
 * Post-LLM guard that force-preserves every profile acronym in the
 * expansion response. For each directive keyword that looks like an
 * acronym (2-6 uppercase letters), we check whether it still appears
 * as a whole word in any of the three per-source lists; if not, we
 * append it to ALL THREE so the adapters can search for it verbatim.
 *
 * Why: on 2026-04-12 the LLM silently drifted `MCP` → "adaptive MC
 * models" (Monte Carlo, not Model Context Protocol) despite a prompt
 * rule asking for verbatim preservation. Prompt rules alone are not
 * reliable — this enforcer makes preservation a hard guarantee.
 */
export function enforceAcronymPreservation(
  response: ExpansionResponse,
  directiveKeywords: readonly string[],
): ExpansionResponse {
  const acronyms = directiveKeywords.map((kw) => kw.trim()).filter(isAcronym);
  if (acronyms.length === 0) return response;
  const haystack = [
    ...response.hn_keywords,
    ...response.arxiv_keywords,
    ...response.github_keywords,
  ].join(' ');
  const missing = acronyms.filter((ac) => !containsAsWord(haystack, ac));
  if (missing.length === 0) return response;
  return {
    ...response,
    hn_keywords: [...response.hn_keywords, ...missing],
    arxiv_keywords: [...response.arxiv_keywords, ...missing],
    github_keywords: [...response.github_keywords, ...missing],
  };
}

/**
 * Umbrella technical terms that match millions of unrelated items. When
 * these appear among expanded_keywords we move them to the END of the list
 * so source adapters (which take `expanded_keywords.slice(0, N)`) hit more
 * specific terms first. This is a defense against LLM responses that list
 * generics first despite the prompt asking for specificity.
 */
const GENERIC_KEYWORDS: ReadonlySet<string> = new Set([
  'ai',
  'ml',
  'machine learning',
  'data science',
  'deep learning',
  'python',
  'javascript',
  'typescript',
  'rust',
  'go',
  'java',
  'saas',
  'software',
  'software as a service',
  'software development',
  'programming',
  'coding',
  'startup',
  'business',
  'tech',
  'technology',
  'cloud',
  'cloud computing',
  'analytics',
  'data analytics',
  'web',
  'mobile',
  'app',
  'backend',
  'frontend',
  'fullstack',
  'devops',
  'automation',
  'platform',
]);

/** Demote generic umbrella terms to the end of a single keyword list. */
function demoteInList(keywords: string[]): string[] {
  const specific: string[] = [];
  const generic: string[] = [];
  for (const kw of keywords) {
    if (GENERIC_KEYWORDS.has(kw.toLowerCase())) generic.push(kw);
    else specific.push(kw);
  }
  return [...specific, ...generic];
}

/**
 * Re-sort all per-source keyword lists so generic umbrella terms sink
 * to the end. The relative order of specific terms is preserved, as is
 * the relative order of generics. This runs after the LLM response
 * because models frequently list generics first despite prompt
 * instructions.
 */
function demoteGenericKeywords(response: ExpansionResponse): ExpansionResponse {
  return {
    ...response,
    hn_keywords: demoteInList(response.hn_keywords),
    arxiv_keywords: demoteInList(response.arxiv_keywords),
    github_keywords: demoteInList(response.github_keywords),
  };
}

/**
 * Build an ExpandedQueryPlan from the directive + profile via one
 * gpt-4o LLM call. Enforces exclude-list hygiene post-response. Returns
 * err on LLM failure or schema mismatch; never throws.
 */
export async function planQueries(
  directive: ScannerDirectives['tech_scout'],
  profile: FounderProfile,
  options: PlannerOptions = {},
): Promise<Result<ExpandedQueryPlan, PlannerError>> {
  const clock = options.clock ?? (() => new Date());
  try {
    const { object } = await generateObject({
      model: models.tech_scout,
      schema: EXPANSION_WIRE_SCHEMA,
      system: buildExpansionSystemPrompt(options.scenario),
      prompt: buildExpansionUserPrompt(directive, profile, {
        problem_hunts: options.problem_hunts,
        adjacent_worlds: options.adjacent_worlds,
      }),
    });
    // Post-parse strict validation. Wire schema is loose so Anthropic
    // accepts it; strict schema re-applies the 4-8 items per list and
    // non-empty string bounds at the Result boundary.
    const validated = EXPANSION_RESPONSE_SCHEMA.safeParse(object);
    if (!validated.success) {
      return err({
        kind: 'schema_invalid',
        message: validated.error.message,
      });
    }
    const cleaned = filterExcludes(validated.data, directive.exclude);
    const acronymPreserved = enforceAcronymPreservation(cleaned, directive.keywords);
    const reordered = demoteGenericKeywords(acronymPreserved);
    return ok({
      hn_keywords: reordered.hn_keywords,
      arxiv_keywords: reordered.arxiv_keywords,
      github_keywords: reordered.github_keywords,
      arxiv_categories: reordered.arxiv_categories,
      github_languages: reordered.github_languages,
      domain_tags: reordered.domain_tags,
      timeframe_iso: parseTimeframeToIso(directive.timeframe, clock()),
    });
  } catch (e) {
    return err(classifyPlannerError(e));
  }
}

/** Map a thrown value into a PlannerError discriminator. */
function classifyPlannerError(e: unknown): PlannerError {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes('schema') || lower.includes('validation')) {
    return { kind: 'schema_invalid', message: msg };
  }
  return { kind: 'llm_failed', message: msg };
}
