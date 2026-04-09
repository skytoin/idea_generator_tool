import { generateText, type LanguageModel } from 'ai';
import { ok, err, type Result } from '../../lib/utils/result';
import type { FounderProfile } from '../../lib/types/founder-profile';
import type { FounderNarrative } from '../../lib/types/founder-narrative';
import { FOUNDER_NARRATIVE_SCHEMA } from '../../lib/types/founder-narrative';
import { models } from '../../lib/ai/models';
import { buildNarrativePrompt } from '../prompts/frame-narrative';
import type { PromptTrace } from './prompt-trace';
import { estimateCost } from './estimate-cost';

type Mode = 'explore' | 'refine' | 'open_direction';

export type NarrativeError =
  | { kind: 'llm_failed'; message: string }
  | { kind: 'schema_invalid'; message: string };

export type NarrativeOptions = {
  /** Override the language model (tests). */
  model?: LanguageModel;
  /** Test-only scenario marker routed through the MSW mock. */
  scenario?: string;
  /** Clock injection — defaults to Date.now. */
  clock?: () => Date;
};

export type NarrativeResult = {
  narrative: FounderNarrative;
  trace: PromptTrace;
  cost: number;
};

/** Count whitespace-separated words in a prose string. */
function countWords(prose: string): number {
  const trimmed = prose.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Attempt to build and validate a FounderNarrative from an LLM text response.
 * Returns err({kind: 'schema_invalid'}) if the prose fails schema validation.
 */
function buildNarrativeFromText(
  prose: string,
  clock: () => Date,
): Result<FounderNarrative, NarrativeError> {
  const candidate = {
    prose,
    word_count: countWords(prose),
    generated_at: clock().toISOString(),
  };
  const parsed = FOUNDER_NARRATIVE_SCHEMA.safeParse(candidate);
  if (!parsed.success) {
    return err({ kind: 'schema_invalid', message: parsed.error.message });
  }
  return ok(parsed.data);
}

/**
 * Generate a ~200 word prose summary of the founder profile. Records every
 * profile field accessed via a PromptTrace. The returned result also carries
 * a USD cost estimate based on usage reported by the LLM SDK.
 */
export async function generateNarrative(
  profile: FounderProfile,
  mode: Mode,
  existingIdea: string | null,
  options: NarrativeOptions = {},
): Promise<Result<NarrativeResult, NarrativeError>> {
  const clock = options.clock ?? (() => new Date());
  const { system, user, trace } = buildNarrativePrompt(
    profile,
    mode,
    existingIdea,
    options.scenario,
  );
  try {
    const { text, usage } = await generateText({
      model: options.model ?? models.frame,
      system,
      prompt: user,
    });
    const narrative = buildNarrativeFromText(text, clock);
    if (!narrative.ok) return err(narrative.error);
    return ok({ narrative: narrative.value, trace, cost: estimateCost(usage) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ kind: 'llm_failed', message });
  }
}
