import { z } from 'zod';
import { PROBLEM_HUNTS_SCHEMA } from '../../lib/types/problem-hunt';
import type { FounderProfile } from '../../lib/types/founder-profile';

/**
 * STRICT validation schema for the skill-remix LLM call, applied
 * after the model returns. Enforces 3-10 hunts with non-empty
 * fields via PROBLEM_HUNTS_SCHEMA. Never sent to the model — see
 * SKILL_REMIX_WIRE_SCHEMA below.
 */
export const SKILL_REMIX_RESPONSE_SCHEMA = z.object({
  hunts: PROBLEM_HUNTS_SCHEMA,
});
export type SkillRemixResponse = z.infer<typeof SKILL_REMIX_RESPONSE_SCHEMA>;

/**
 * WIRE schema sent to `generateObject`. Types only, no length/size
 * bounds, so Anthropic's tool_use input_schema subset accepts it.
 * The skill-remix module re-validates against
 * SKILL_REMIX_RESPONSE_SCHEMA after parsing to re-apply the 3-10
 * hunts and non-empty field constraints.
 */
export const SKILL_REMIX_WIRE_SCHEMA = z.object({
  hunts: z.array(
    z.object({
      skill_source: z.string(),
      problem: z.string(),
      example_search_phrases: z.array(z.string()),
    }),
  ),
});

/**
 * System prompt for the skill-remix LLM call. Instructs the model to
 * perform functional decomposition on founder skills: Python is a
 * capability, "manual reconciliation in small accounting firms" is a
 * problem that capability can solve. The goal is to produce problem
 * phrases specific enough that a search engine can find real discussions.
 */
export function buildSkillRemixSystemPrompt(scenario?: string): string {
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  return `${marker}You are a problem-hunt generator for a Tech Scout agent. Apply FUNCTIONAL DECOMPOSITION to the founder's skills and domain: for each skill, identify 1-2 concrete CLASSES OF PROBLEMS that skill can solve, phrased specifically enough that search engines can find real discussions of them.

PRINCIPLES:
- A skill (e.g. "Python", "nursing", "SQL") is NEVER a problem. It is a CAPABILITY.
- A problem is a concrete pain: "manual charting steals 90 minutes per nurse per shift", not "data work is hard".
- Prefer problems with a clear audience ("small accounting firms", "rural home-health agencies", "freelance photographers") over abstract ones.
- Ground problems in the founder's domain and insider knowledge where possible.
- Return 3-10 hunts total. Each hunt must include 1-6 example_search_phrases that could be run verbatim against Hacker News, arXiv, or GitHub.
- Example search phrases should look like real search queries: short, specific, noun-heavy. Avoid filler words.

ACRONYM RULE: If the founder notes contain an uppercase 2-6 letter acronym (MCP, CLI, API, RAG, LLM, NLP), keep it verbatim in at least one hunt's problem or example_search_phrases. Never expand it, never substitute it.

Output must match the provided JSON schema exactly.`;
}

/**
 * User prompt serializing the profile fields that inform skill-remix.
 * Only includes fields the LLM actually needs so the prompt stays
 * focused and cheap to run.
 */
export function buildSkillRemixUserPrompt(profile: FounderProfile): string {
  const skills = profile.skills.value.join(', ') || '(none stated)';
  const domains =
    profile.domain.value
      .map((d) => (d.years ? `${d.area} (${d.years}y)` : d.area))
      .join(', ') || '(none stated)';
  const insider = profile.insider_knowledge.value || '(none)';
  const notes = profile.additional_context_raw || '(none)';
  return `Founder skills: ${skills}
Founder domain(s): ${domains}
Insider knowledge: ${insider}
Additional context: ${notes}

Produce the problem hunts as a JSON object matching the schema.`;
}
