import { generateObject } from 'ai';
import { ok, err, type Result } from '../../../lib/utils/result';
import { models } from '../../../lib/ai/models';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import type { ExpandedQueryPlan } from '../types';
import {
  EXPANSION_RESPONSE_SCHEMA,
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
  const match = s.match(
    /^(?:last|next|past)?\s*(\d+)?\s*(day|week|month|year)s?$/,
  );
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
 * Remove any expanded_keywords that match a directive exclude entry
 * (case-insensitive). Applied after the LLM response because a
 * misbehaving model may echo excluded terms despite the system prompt
 * telling it not to.
 */
function filterExcludes(
  response: ExpansionResponse,
  exclude: readonly string[],
): ExpansionResponse {
  const lower = new Set(exclude.map((e) => e.toLowerCase()));
  return {
    ...response,
    expanded_keywords: response.expanded_keywords.filter(
      (kw) => !lower.has(kw.toLowerCase()),
    ),
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

/**
 * Re-sort expanded_keywords so generic umbrella terms sink to the end of
 * the list. The relative order of specific terms is preserved, as is the
 * relative order of generics. This runs after the LLM response because
 * models frequently list generics first despite prompt instructions.
 */
function demoteGenericKeywords(response: ExpansionResponse): ExpansionResponse {
  const specific: string[] = [];
  const generic: string[] = [];
  for (const kw of response.expanded_keywords) {
    if (GENERIC_KEYWORDS.has(kw.toLowerCase())) generic.push(kw);
    else specific.push(kw);
  }
  return { ...response, expanded_keywords: [...specific, ...generic] };
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
      schema: EXPANSION_RESPONSE_SCHEMA,
      system: buildExpansionSystemPrompt(options.scenario),
      prompt: buildExpansionUserPrompt(directive, profile),
    });
    const cleaned = filterExcludes(object, directive.exclude);
    const reordered = demoteGenericKeywords(cleaned);
    return ok({
      expanded_keywords: reordered.expanded_keywords,
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
