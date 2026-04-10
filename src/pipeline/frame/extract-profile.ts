import { generateObject, type LanguageModel } from 'ai';
import { ok, err, type Result } from '../../lib/utils/result';
import type { FrameInput } from '../../lib/types/frame-input';
import type { ProfileBuilder } from './apply-assumptions';
import {
  EXTRACTION_RESPONSE_SCHEMA,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  type ExtractionResponse,
} from '../prompts/frame-extract';
import { models } from '../../lib/ai/models';

export type ExtractError =
  | { kind: 'llm_failed'; message: string }
  | { kind: 'schema_invalid'; message: string };

export type ExtractOptions = {
  /** Override the language model (tests). */
  model?: LanguageModel;
  /** Test-only scenario marker injected into the user prompt. */
  scenario?: string;
};

type OptionalFormField = Exclude<
  keyof FrameInput,
  | 'mode'
  | 'existing_idea'
  | 'additional_context'
  | 'skills'
  | 'time_per_week'
  | 'money_available'
  | 'ambition'
>;

const OPTIONAL_FORM_FIELDS: OptionalFormField[] = [
  'domain',
  'insider_knowledge',
  'anti_targets',
  'network',
  'audience',
  'proprietary_access',
  'rare_combinations',
  'recurring_frustration',
  'four_week_mvp',
  'previous_attempts',
  'customer_affinity',
  'time_to_revenue',
  'customer_type_preference',
  'trigger',
  'legal_constraints',
  'divergence_level',
];

/**
 * Phase 1: build a ProfileBuilder containing every field explicitly supplied
 * on the FrameInput, each tagged `stated`. Optional fields are only copied
 * when the form actually provides a value.
 */
function buildFromForm(input: FrameInput): ProfileBuilder {
  const b: ProfileBuilder = {
    skills: { value: input.skills, source: 'stated' },
    time_per_week: { value: input.time_per_week, source: 'stated' },
    money_available: { value: input.money_available, source: 'stated' },
    ambition: { value: input.ambition, source: 'stated' },
  };
  for (const field of OPTIONAL_FORM_FIELDS) {
    const value = input[field];
    if (value !== undefined) {
      (b as Record<string, unknown>)[field] = { value, source: 'stated' };
    }
  }
  return b;
}

/** List of ExtractionResponse keys corresponding to fillable builder fields. */
const EXTRACTABLE_FIELDS = [
  'domain',
  'insider_knowledge',
  'anti_targets',
  'network',
  'audience',
  'proprietary_access',
  'rare_combinations',
  'recurring_frustration',
  'four_week_mvp',
  'previous_attempts',
  'customer_affinity',
  'trigger',
  'legal_constraints',
] as const satisfies ReadonlyArray<keyof ExtractionResponse>;

/**
 * Merge an LLM extraction result into the builder. Only fills fields not
 * already in the builder, tagging merged fields as `inferred`. Null values
 * from the LLM are skipped — null signals "not present in context".
 */
function mergeExtracted(builder: ProfileBuilder, extracted: ExtractionResponse): void {
  for (const field of EXTRACTABLE_FIELDS) {
    if ((builder as Record<string, unknown>)[field] !== undefined) continue;
    const value = extracted[field];
    if (value === null) continue;
    (builder as Record<string, unknown>)[field] = { value, source: 'inferred' };
  }
}

/**
 * Invoke the LLM to extract profile facts from raw additional_context.
 * Returns the parsed ExtractionResponse or an ExtractError. Any thrown SDK
 * error — network, schema, or model — is surfaced as `llm_failed`.
 */
async function callExtractionLLM(
  additionalContext: string,
  options: ExtractOptions,
): Promise<Result<ExtractionResponse, ExtractError>> {
  try {
    const { object } = await generateObject({
      model: options.model ?? models.frame,
      schema: EXTRACTION_RESPONSE_SCHEMA,
      system: buildExtractSystemPrompt(),
      prompt: buildExtractUserPrompt(additionalContext, options.scenario),
    });
    return ok(object);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ kind: 'llm_failed', message });
  }
}

/**
 * Extracts a partial FounderProfile from FrameInput.
 * Phase 1: deterministic copy of form fields (all tagged 'stated').
 * Phase 2: if additional_context is non-empty, LLM extraction fills gaps
 * tagged 'inferred'. Form fields always win — stated is never overwritten.
 */
export async function extractProfile(
  input: FrameInput,
  options: ExtractOptions = {},
): Promise<Result<ProfileBuilder, ExtractError>> {
  const builder = buildFromForm(input);
  if (input.additional_context.trim().length === 0) return ok(builder);
  const llm = await callExtractionLLM(input.additional_context, options);
  if (!llm.ok) return err(llm.error);
  mergeExtracted(builder, llm.value);
  return ok(builder);
}
