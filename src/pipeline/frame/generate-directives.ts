import { generateObject, type LanguageModel } from 'ai';
import { ok, err, type Result } from '../../lib/utils/result';
import type { FounderProfile } from '../../lib/types/founder-profile';
import {
  SCANNER_DIRECTIVES_SCHEMA,
  type ScannerDirectives,
} from '../../lib/types/scanner-directives';
import { models } from '../../lib/ai/models';
import { buildDirectivesPrompt } from '../prompts/frame-directives';
import type { PromptTrace } from './prompt-trace';
import { estimateCost } from './estimate-cost';

type Mode = 'explore' | 'refine' | 'open_direction';

export type DirectivesError =
  | { kind: 'llm_failed'; message: string }
  | { kind: 'schema_invalid'; message: string };

export type DirectivesOptions = {
  /** Override the language model (tests). */
  model?: LanguageModel;
  /** Test-only scenario marker routed via the MSW mock. */
  scenario?: string;
};

export type DirectivesResult = {
  directives: ScannerDirectives;
  traces: PromptTrace[];
  cost: number;
};

/**
 * Merge the founder's anti_targets into each scanner's exclude array,
 * deduping against existing entries. Mutates `directives` in place.
 */
function mergeAntiTargets(
  directives: ScannerDirectives,
  antiTargets: readonly string[],
): void {
  const dedupe = (existing: string[]): string[] =>
    Array.from(new Set([...existing, ...antiTargets]));
  directives.tech_scout.exclude = dedupe(directives.tech_scout.exclude);
  directives.pain_scanner.exclude = dedupe(directives.pain_scanner.exclude);
  directives.market_scanner.exclude = dedupe(directives.market_scanner.exclude);
  directives.change_scanner.exclude = dedupe(directives.change_scanner.exclude);
}

/**
 * Append the existing idea description to every scanner's notes field when
 * mode is refine or open_direction. Explore mode leaves notes untouched.
 */
function injectExistingIdea(
  directives: ScannerDirectives,
  mode: Mode,
  existingIdea: string | null,
): void {
  if (mode === 'explore' || existingIdea === null) return;
  const suffix = `\n\nExisting idea: ${existingIdea}`;
  directives.tech_scout.notes = `${directives.tech_scout.notes}${suffix}`;
  directives.pain_scanner.notes = `${directives.pain_scanner.notes}${suffix}`;
  directives.market_scanner.notes = `${directives.market_scanner.notes}${suffix}`;
  directives.change_scanner.notes = `${directives.change_scanner.notes}${suffix}`;
}

type RawDirectivesResult = {
  directives: ScannerDirectives;
  traces: PromptTrace[];
  cost: number;
};

/**
 * Invoke the LLM to produce a ScannerDirectives object constrained by the
 * canonical schema. Any SDK/validation error surfaces as llm_failed.
 */
async function callDirectivesLLM(
  profile: FounderProfile,
  narrativeProse: string,
  mode: Mode,
  existingIdea: string | null,
  options: DirectivesOptions,
): Promise<Result<RawDirectivesResult, DirectivesError>> {
  const { system, user, traces } = buildDirectivesPrompt(
    profile,
    narrativeProse,
    mode,
    existingIdea,
    options.scenario,
  );
  try {
    const { object, usage } = await generateObject({
      model: options.model ?? models.frame,
      schema: SCANNER_DIRECTIVES_SCHEMA,
      system,
      prompt: user,
    });
    return ok({ directives: object, traces, cost: estimateCost(usage) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ kind: 'llm_failed', message });
  }
}

/**
 * Produce the per-scanner ScannerDirectives for the given profile + narrative.
 * After the LLM returns, the founder's anti_targets are merged into every
 * scanner's exclude list and (in refine/open_direction modes) the existing
 * idea is appended to each scanner's notes.
 */
export async function generateDirectives(
  profile: FounderProfile,
  narrativeProse: string,
  mode: Mode,
  existingIdea: string | null,
  options: DirectivesOptions = {},
): Promise<Result<DirectivesResult, DirectivesError>> {
  const llm = await callDirectivesLLM(
    profile,
    narrativeProse,
    mode,
    existingIdea,
    options,
  );
  if (!llm.ok) return err(llm.error);
  mergeAntiTargets(llm.value.directives, profile.anti_targets.value);
  injectExistingIdea(llm.value.directives, mode, existingIdea);
  return ok(llm.value);
}
