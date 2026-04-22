import { generateObject } from 'ai';
import { ok, err, type Result } from '../../../lib/utils/result';
import { models } from '../../../lib/ai/models';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { AdjacentWorlds } from '../../../lib/types/adjacent-world';
import {
  ADJACENT_WORLDS_RESPONSE_SCHEMA,
  ADJACENT_WORLDS_WIRE_SCHEMA,
  buildAdjacentWorldsSystemPrompt,
  buildAdjacentWorldsUserPrompt,
} from '../../prompts/tech-scout-adjacent';

/**
 * Error kinds surfaced by the adjacent-world LLM call. `llm_failed`
 * covers transport and timeout errors; `schema_invalid` covers
 * responses that parse as JSON but violate the worlds schema (which
 * enforces at least one shared_trait per world).
 */
export type AdjacencyError =
  | { kind: 'llm_failed'; message: string }
  | { kind: 'schema_invalid'; message: string };

export type AdjacencyOptions = {
  /** Scenario marker routed through the MSW OpenAI mock. */
  scenario?: string;
};

/**
 * Generate 2-6 analogically-adjacent worlds for the founder via one
 * LLM call. Never throws; returns err on failure so the scanner can
 * continue without analogical keywords if the call fails or produces
 * a schema-invalid response. Every returned world is guaranteed (by
 * the schema) to carry at least one shared_trait, preventing random
 * adjacency drift.
 */
export async function generateAdjacentWorlds(
  profile: FounderProfile,
  options: AdjacencyOptions = {},
): Promise<Result<AdjacentWorlds, AdjacencyError>> {
  try {
    const { object } = await generateObject({
      model: models.tech_scout,
      schema: ADJACENT_WORLDS_WIRE_SCHEMA,
      system: buildAdjacentWorldsSystemPrompt(options.scenario),
      prompt: buildAdjacentWorldsUserPrompt(profile),
    });
    // Post-parse strict validation. The drift guard
    // (shared_traits.min(1)) is in the strict schema, so rejecting
    // empty-trait worlds still happens here, just one step later.
    const validated = ADJACENT_WORLDS_RESPONSE_SCHEMA.safeParse(object);
    if (!validated.success) {
      return err({
        kind: 'schema_invalid',
        message: validated.error.message,
      });
    }
    return ok(validated.data.worlds);
  } catch (e) {
    return err(classifyAdjacencyError(e));
  }
}

/** Map a thrown value into an AdjacencyError discriminator. */
function classifyAdjacencyError(e: unknown): AdjacencyError {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes('schema') || lower.includes('validation')) {
    return { kind: 'schema_invalid', message: msg };
  }
  return { kind: 'llm_failed', message: msg };
}
