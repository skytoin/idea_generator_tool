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
 * Parse a natural-language timeframe ("last 6 months", "last 30 days")
 * into an ISO 8601 date cutoff relative to `now`. Unparseable strings
 * fall back to the Unix epoch so downstream filters treat them as
 * unlimited.
 */
export function parseTimeframeToIso(timeframe: string, now: Date): string {
  const s = timeframe.toLowerCase().trim();
  const match = s.match(/^last\s+(\d+)?\s*(day|week|month|year)s?$/);
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
    return ok({
      expanded_keywords: cleaned.expanded_keywords,
      arxiv_categories: cleaned.arxiv_categories,
      github_languages: cleaned.github_languages,
      domain_tags: cleaned.domain_tags,
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
