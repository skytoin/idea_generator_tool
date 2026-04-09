import { createHash } from 'node:crypto';
import { ok, err, type Result } from '../../lib/utils/result';
import {
  FRAME_INPUT_SCHEMA,
  type FrameInput,
} from '../../lib/types/frame-input';
import type { FrameOutput } from '../../lib/types/frame-output';
import type { KVStore } from '../../lib/utils/kv-store';
import type { FounderProfile } from '../../lib/types/founder-profile';
import { extractProfile } from '../frame/extract-profile';
import { applyAssumptions } from '../frame/apply-assumptions';
import {
  generateNarrative,
  type NarrativeResult,
} from '../frame/generate-narrative';
import {
  generateDirectives,
  type DirectivesResult,
} from '../frame/generate-directives';

type Mode = 'explore' | 'refine' | 'open_direction';

export type FrameDeps = {
  clock: () => Date;
  kv: KVStore;
  /** Test-only: scenario prefixes applied to each LLM call. */
  scenarios?: {
    extract?: string;
    narrative?: string;
    directives?: string;
  };
};

export type FrameError =
  | { kind: 'invalid_input'; issues: string[] }
  | { kind: 'extract_failed'; message: string }
  | { kind: 'missing_required'; fields: string[] }
  | { kind: 'narrative_failed'; message: string }
  | { kind: 'directives_failed'; message: string }
  | { kind: 'persistence_failed'; message: string };

/**
 * Compute a stable SHA-256-derived 16-char hex hash of the FrameInput by
 * canonicalizing JSON with sorted keys. The hash is used as the KV key
 * for every Frame run, giving deterministic cache identity.
 */
export function computeProfileHash(input: FrameInput): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** Validate the input and return its parsed form or an invalid_input error. */
function parseInput(input: FrameInput): Result<FrameInput, FrameError> {
  const parsed = FRAME_INPUT_SCHEMA.safeParse(input);
  if (!parsed.success) {
    return err({
      kind: 'invalid_input',
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  return ok(parsed.data);
}

/**
 * Phase 1: validate the input, extract the profile from the form and
 * additional_context, then run applyAssumptions to fill any remaining
 * optional fields with documented defaults.
 */
async function runPhase1(
  input: FrameInput,
  deps: FrameDeps,
  profileHash: string,
): Promise<Result<FounderProfile, FrameError>> {
  const extract = await extractProfile(input, { scenario: deps.scenarios?.extract });
  if (!extract.ok) return err({ kind: 'extract_failed', message: extract.error.message });
  const assumed = applyAssumptions(extract.value, input.additional_context, profileHash);
  if (!assumed.ok) {
    return err({ kind: 'missing_required', fields: assumed.error.missingFields });
  }
  return ok(assumed.value);
}

type LLMPhaseResult = {
  narrative: Awaited<ReturnType<typeof generateNarrative>>;
  directives: Awaited<ReturnType<typeof generateDirectives>>;
};

/**
 * Phase 2: run narrative generation, then directives generation. Returns
 * both results so the orchestrator can assemble the combined trace and
 * cost_usd debug payload.
 */
async function runLLMPhases(
  profile: FounderProfile,
  mode: Mode,
  existingIdea: string | null,
  deps: FrameDeps,
): Promise<LLMPhaseResult> {
  const narrative = await generateNarrative(profile, mode, existingIdea, {
    scenario: deps.scenarios?.narrative,
    clock: deps.clock,
  });
  if (!narrative.ok) return { narrative, directives: narrative as never };
  const directives = await generateDirectives(
    profile,
    narrative.value.narrative.prose,
    mode,
    existingIdea,
    { scenario: deps.scenarios?.directives },
  );
  return { narrative, directives };
}

/**
 * Assemble the final FrameOutput from the profile, narrative, directives,
 * and combined trace. The trace combines narrative trace entries with all
 * directive trace entries; cost_usd sums narrative and directives cost.
 */
function assembleOutput(
  input: FrameInput,
  profile: FounderProfile,
  narrativeOut: NarrativeResult,
  directivesOut: DirectivesResult,
  deps: FrameDeps,
): FrameOutput {
  const traceEntries = [
    ...narrativeOut.trace.entries(),
    ...directivesOut.traces.flatMap((t) => t.entries()),
  ];
  return {
    mode: input.mode,
    existing_idea:
      input.existing_idea !== undefined ? { description: input.existing_idea } : null,
    profile,
    narrative: narrativeOut.narrative,
    directives: directivesOut.directives,
    debug: {
      trace: traceEntries,
      cost_usd: narrativeOut.cost + directivesOut.cost,
      generated_at: deps.clock().toISOString(),
    },
  };
}

/**
 * Persist FrameOutput to the KV store, surfacing any storage error as
 * a persistence_failed FrameError rather than an exception.
 */
async function persistOutput(
  kv: KVStore,
  hash: string,
  output: FrameOutput,
): Promise<Result<void, FrameError>> {
  try {
    await kv.set(hash, JSON.stringify(output));
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ kind: 'persistence_failed', message });
  }
}

/**
 * Run narrative + directives and surface their errors as FrameErrors.
 * Returns the two success payloads on the happy path.
 */
async function runAllLLMPhases(
  profile: FounderProfile,
  mode: Mode,
  existingIdea: string | null,
  deps: FrameDeps,
): Promise<Result<{ narrative: NarrativeResult; directives: DirectivesResult }, FrameError>> {
  const { narrative, directives } = await runLLMPhases(
    profile,
    mode,
    existingIdea,
    deps,
  );
  if (!narrative.ok) {
    return err({ kind: 'narrative_failed', message: narrative.error.message });
  }
  if (!directives.ok) {
    return err({ kind: 'directives_failed', message: directives.error.message });
  }
  return ok({ narrative: narrative.value, directives: directives.value });
}

/**
 * Frame orchestrator. Validates the input, extracts the profile, runs the
 * narrative + directives LLM phases, and persists the result keyed by a
 * stable profile_hash so the run can be inspected later.
 */
export async function runFrame(
  input: FrameInput,
  deps: FrameDeps,
): Promise<Result<FrameOutput, FrameError>> {
  const parsed = parseInput(input);
  if (!parsed.ok) return err(parsed.error);
  const profileHash = computeProfileHash(parsed.value);
  const phase1 = await runPhase1(parsed.value, deps, profileHash);
  if (!phase1.ok) return err(phase1.error);
  const existingIdea = parsed.value.existing_idea ?? null;
  const llm = await runAllLLMPhases(phase1.value, parsed.value.mode, existingIdea, deps);
  if (!llm.ok) return err(llm.error);
  const output = assembleOutput(
    parsed.value,
    phase1.value,
    llm.value.narrative,
    llm.value.directives,
    deps,
  );
  const persisted = await persistOutput(deps.kv, profileHash, output);
  if (!persisted.ok) return err(persisted.error);
  return ok(output);
}
