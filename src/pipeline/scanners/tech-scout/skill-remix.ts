import { generateObject } from 'ai';
import { ok, err, type Result } from '../../../lib/utils/result';
import { models } from '../../../lib/ai/models';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { ProblemHunts } from '../../../lib/types/problem-hunt';
import {
  SKILL_REMIX_RESPONSE_SCHEMA,
  SKILL_REMIX_WIRE_SCHEMA,
  buildSkillRemixSystemPrompt,
  buildSkillRemixUserPrompt,
} from '../../prompts/tech-scout-skill-remix';

/**
 * Error kinds surfaced by the skill-remix LLM call. `llm_failed` covers
 * transport and timeout errors; `schema_invalid` covers responses that
 * parse as JSON but violate SKILL_REMIX_RESPONSE_SCHEMA.
 */
export type RemixError =
  | { kind: 'llm_failed'; message: string }
  | { kind: 'schema_invalid'; message: string };

export type RemixOptions = {
  /** Scenario marker routed through the MSW OpenAI mock. */
  scenario?: string;
};

/**
 * Translate the founder profile into problem hunts via one LLM call.
 * Never throws; returns err on any failure so the scanner can fall
 * back to the directive keywords if remix is unavailable. The returned
 * hunts pass the SKILL_REMIX_RESPONSE_SCHEMA contract (3-10 items).
 */
export async function generateProblemHunts(
  profile: FounderProfile,
  options: RemixOptions = {},
): Promise<Result<ProblemHunts, RemixError>> {
  try {
    const { object } = await generateObject({
      model: models.tech_scout,
      schema: SKILL_REMIX_WIRE_SCHEMA,
      system: buildSkillRemixSystemPrompt(options.scenario),
      prompt: buildSkillRemixUserPrompt(profile),
    });
    // Post-parse strict validation. Wire schema is loose so
    // Anthropic tool_use accepts it; strict schema re-applies the
    // 3-10 hunts and non-empty field constraints here.
    const validated = SKILL_REMIX_RESPONSE_SCHEMA.safeParse(object);
    if (!validated.success) {
      return err({
        kind: 'schema_invalid',
        message: validated.error.message,
      });
    }
    return ok(validated.data.hunts);
  } catch (e) {
    return err(classifyRemixError(e));
  }
}

/** Map a thrown value into a RemixError discriminator. */
function classifyRemixError(e: unknown): RemixError {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes('schema') || lower.includes('validation')) {
    return { kind: 'schema_invalid', message: msg };
  }
  return { kind: 'llm_failed', message: msg };
}
