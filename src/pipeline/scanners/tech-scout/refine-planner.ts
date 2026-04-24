import { generateObject } from 'ai';
import { ok, err, type Result } from '../../../lib/utils/result';
import { models } from '../../../lib/ai/models';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import type { FirstPassSummary } from '../../../lib/types/two-pass-state';
import type { ExpandedQueryPlan } from '../types';
import {
  EXPANSION_RESPONSE_SCHEMA,
  EXPANSION_WIRE_SCHEMA,
} from '../../prompts/tech-scout-expansion';
import {
  buildRefineSystemPrompt,
  buildRefineUserPrompt,
} from '../../prompts/tech-scout-refine';
import {
  parseTimeframeToIso,
  enforceAcronymPreservation,
  sanitizeGithubLanguages,
} from './query-planner';

/**
 * Error kinds surfaced by the pass-2 refine planner. Identical to
 * the pass-1 planner errors — if refinement fails, the orchestrator
 * falls back to a single-pass result.
 */
export type RefineError =
  | { kind: 'llm_failed'; message: string }
  | { kind: 'schema_invalid'; message: string }
  | { kind: 'reused_exhausted'; message: string };

export type RefineOptions = {
  clock?: () => Date;
  scenario?: string;
};

/**
 * Build a pass-2 ExpandedQueryPlan by reading the first-pass summary
 * and issuing one LLM call with the refine prompt. Post-processes the
 * response with the same acronym-preservation guard pass 1 uses, and
 * HARD-REJECTS any keyword list whose entries match an exhausted_terms
 * label (word-boundary check, case-insensitive). Rejection returns
 * a `reused_exhausted` error so the orchestrator can decide whether
 * to retry, fall back, or accept the degraded plan.
 */
export async function refinePlan(args: {
  directive: ScannerDirectives['tech_scout'];
  profile: FounderProfile;
  summary: FirstPassSummary;
  options?: RefineOptions;
}): Promise<Result<ExpandedQueryPlan, RefineError>> {
  const { directive, profile, summary } = args;
  const clock = args.options?.clock ?? (() => new Date());
  try {
    const { object } = await generateObject({
      model: models.tech_scout,
      schema: EXPANSION_WIRE_SCHEMA,
      system: buildRefineSystemPrompt(args.options?.scenario),
      prompt: buildRefineUserPrompt(directive, profile, summary),
    });
    // Post-parse strict validation. Wire schema is loose so
    // Anthropic tool_use accepts it; the strict
    // EXPANSION_RESPONSE_SCHEMA re-applies 4-8 item bounds per list.
    const validated = EXPANSION_RESPONSE_SCHEMA.safeParse(object);
    if (!validated.success) {
      return err({
        kind: 'schema_invalid',
        message: validated.error.message,
      });
    }
    const reused = findReusedExhausted(validated.data, summary.exhausted_terms);
    if (reused.length > 0) {
      return err({
        kind: 'reused_exhausted',
        message: `pass-2 planner reused exhausted labels: ${reused.join(', ')}`,
      });
    }
    const acronymPreserved = enforceAcronymPreservation(
      validated.data,
      directive.keywords,
    );
    return ok({
      hn_keywords: acronymPreserved.hn_keywords,
      arxiv_keywords: acronymPreserved.arxiv_keywords,
      github_keywords: acronymPreserved.github_keywords,
      reddit_keywords: acronymPreserved.reddit_keywords,
      huggingface_keywords: acronymPreserved.huggingface_keywords,
      arxiv_categories: acronymPreserved.arxiv_categories,
      github_languages: sanitizeGithubLanguages(acronymPreserved.github_languages),
      reddit_subreddits: acronymPreserved.reddit_subreddits,
      domain_tags: acronymPreserved.domain_tags,
      timeframe_iso: parseTimeframeToIso(directive.timeframe, clock()),
    });
  } catch (e) {
    return err(classifyRefineError(e));
  }
}

/**
 * Return the subset of `exhausted_terms` that appear as whole-word
 * substrings of any keyword in any of the three per-source lists.
 * Word-boundary matching keeps us from false-positive-flagging a
 * substring match inside a longer unrelated keyword.
 */
function findReusedExhausted(
  response: {
    hn_keywords: string[];
    arxiv_keywords: string[];
    github_keywords: string[];
    reddit_keywords: string[];
    huggingface_keywords: string[];
  },
  exhausted: readonly string[],
): string[] {
  if (exhausted.length === 0) return [];
  const haystack = [
    ...response.hn_keywords,
    ...response.arxiv_keywords,
    ...response.github_keywords,
    ...response.reddit_keywords,
    ...response.huggingface_keywords,
  ]
    .join(' ')
    .toLowerCase();
  return exhausted.filter((term) => {
    const core = term.replace(/^[a-z_]+:\s*/i, '').trim();
    if (core.length === 0) return false;
    const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped.toLowerCase()}\\b`).test(haystack);
  });
}

/** Map a thrown value into a RefineError discriminator. */
function classifyRefineError(e: unknown): RefineError {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes('schema') || lower.includes('validation')) {
    return { kind: 'schema_invalid', message: msg };
  }
  return { kind: 'llm_failed', message: msg };
}
