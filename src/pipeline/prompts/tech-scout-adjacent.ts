import { z } from 'zod';
import { ADJACENT_WORLDS_SCHEMA } from '../../lib/types/adjacent-world';
import type { FounderProfile } from '../../lib/types/founder-profile';

/**
 * STRICT validation schema for the adjacent-world LLM call, applied
 * after the model returns. Enforces 2-6 worlds with at least one
 * shared_trait each (the drift guard). Never sent to the model.
 */
export const ADJACENT_WORLDS_RESPONSE_SCHEMA = z.object({
  worlds: ADJACENT_WORLDS_SCHEMA,
});
export type AdjacentWorldsResponse = z.infer<typeof ADJACENT_WORLDS_RESPONSE_SCHEMA>;

/**
 * WIRE schema sent to `generateObject`. Types only, no length/size
 * bounds, so Anthropic's tool_use input_schema subset accepts it.
 * The adjacent-worlds module re-validates against the strict
 * ADJACENT_WORLDS_RESPONSE_SCHEMA after parsing, which re-applies
 * the 2-6 worlds bound AND the critical shared_traits.min(1)
 * drift guard that prevents random-adjacency LLM drift.
 */
export const ADJACENT_WORLDS_WIRE_SCHEMA = z.object({
  worlds: z.array(
    z.object({
      source_domain: z.string(),
      adjacent_domain: z.string(),
      shared_traits: z.array(z.string()),
      example_search_phrases: z.array(z.string()),
    }),
  ),
});

/**
 * System prompt for the adjacent-world LLM call. The hard rule is that
 * every adjacency MUST cite at least one shared structural trait. This
 * is the drift guard: without it the LLM free-associates to random
 * industries. The schema's shared_traits.min(1) enforces this at parse
 * time, but stating it explicitly in the prompt reduces retries.
 */
export function buildAdjacentWorldsSystemPrompt(scenario?: string): string {
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  return `${marker}You are an analogical-transfer generator for a Tech Scout agent. Given a founder's domain and skills, propose 2-6 ADJACENT WORLDS — industries or fields that share concrete structural traits with the founder's world so solutions from the adjacent world can be imported.

CRITICAL RULE — STRUCTURAL TRAITS REQUIRED:
Every adjacency MUST name at least 1 (and up to 5) concrete shared_traits. A shared trait is a structural pattern both worlds exhibit: "safety-critical checklists", "shift handoffs", "compliance documentation", "appointment no-shows", "high-variance demand". If you cannot name a trait, DO NOT propose the adjacency. Random jumps ("nursing → film industry") are WRONG.

GOOD EXAMPLES:
- nursing ↔ aviation (shared: safety-critical checklists, fatigue management, regulated handoffs)
- small accounting ↔ veterinary clinics (shared: solo practitioners, appointment no-shows, manual invoicing)
- freelance photographers ↔ touring musicians (shared: irregular income, gig scheduling, client acquisition via referrals)

BAD EXAMPLES (REJECT):
- nursing ↔ cryptocurrency (no structural overlap)
- accounting ↔ e-sports (no shared trait that generates a real search query)

PRINCIPLES:
- Prefer LOW-OVERLAP labels with HIGH-OVERLAP structure. "Hospital ↔ clinic" is too close to be useful; "hospital ↔ hotel" (shift work, front desk, housekeeping checklists) is useful.
- Each world must carry 1-5 example_search_phrases that IMPORT a pattern from the adjacent world into the founder's work, not just name the adjacent world itself.
- Skip worlds whose shared traits are vague ("both involve people", "both use computers"). Demand concreteness.

Output must match the provided JSON schema exactly.`;
}

/** User prompt serializing the profile fields the LLM needs. */
export function buildAdjacentWorldsUserPrompt(profile: FounderProfile): string {
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

Produce the adjacent worlds as a JSON object matching the schema. Remember: every world needs concrete shared_traits or it must be dropped.`;
}
