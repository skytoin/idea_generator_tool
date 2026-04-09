#!/usr/bin/env tsx
/**
 * Frame dry-run CLI — loads a FrameInput JSON fixture, runs the Frame
 * orchestrator, and pretty-prints the resulting FrameOutput for manual
 * inspection. Intentionally makes REAL LLM calls when executed directly,
 * so OPENAI_API_KEY (and friends) must be set in the environment.
 *
 * Tests import runDryRun directly and inject stub deps — no real LLM
 * calls happen during the unit test suite.
 *
 * Usage:
 *   npm run frame:dry-run -- path/to/fixture.json
 */
import { readFileSync } from 'node:fs';
import { FRAME_INPUT_SCHEMA } from '../src/lib/types/frame-input';
import { runFrame } from '../src/pipeline/steps/00-frame';
import { InMemoryKVStore, type KVStore } from '../src/lib/utils/kv-store';
import type { Result } from '../src/lib/utils/result';
import type { FrameOutput } from '../src/lib/types/frame-output';
import type { FrameError } from '../src/pipeline/steps/00-frame';

export type DryRunDeps = {
  readFile: (path: string) => string;
  write: (msg: string) => void;
  error: (msg: string) => void;
  runFrame: (
    input: import('../src/lib/types/frame-input').FrameInput,
    deps: { clock: () => Date; kv: KVStore },
  ) => Promise<Result<FrameOutput, FrameError>>;
  clock: () => Date;
  kv: KVStore;
};

/** Print the top-level run header (mode, existing_idea, timestamp). */
function printHeader(output: FrameOutput, write: (msg: string) => void): void {
  write('=== Frame Output ===');
  write(`mode: ${output.mode}`);
  write(`existing_idea: ${output.existing_idea?.description ?? '(none)'}`);
  write(`generated_at: ${output.debug.generated_at}`);
}

/** Print the profile table with each field value + confidence source. */
function printProfile(output: FrameOutput, write: (msg: string) => void): void {
  write('\n--- Profile ---');
  const profile = output.profile as unknown as Record<string, { value: unknown; source: string }>;
  const keys = Object.keys(profile).filter(
    (k) => k !== 'additional_context_raw' && k !== 'schema_version' && k !== 'profile_hash',
  );
  for (const key of keys) {
    const entry = profile[key];
    if (!entry) continue;
    const value = JSON.stringify(entry.value);
    write(`  ${key}: ${value} [${entry.source}]`);
  }
}

/** Print the narrative prose and its word count. */
function printNarrative(output: FrameOutput, write: (msg: string) => void): void {
  write('\n--- Narrative ---');
  write(output.narrative.prose);
  write(`(${output.narrative.word_count} words)`);
}

/** Print all four scanner directives sections. */
function printDirectives(output: FrameOutput, write: (msg: string) => void): void {
  write('\n--- Directives ---');
  const scanners = ['tech_scout', 'pain_scanner', 'market_scanner', 'change_scanner'] as const;
  for (const name of scanners) {
    const d = output.directives[name];
    write(`  [${name}]`);
    write(`    keywords: ${JSON.stringify(d.keywords)}`);
    write(`    exclude:  ${JSON.stringify(d.exclude)}`);
    write(`    notes:    ${d.notes}`);
  }
}

/** Print the trace summary (field → consumer mappings) and cost. */
function printTrace(output: FrameOutput, write: (msg: string) => void): void {
  write('\n--- Trace ---');
  write(`  ${output.debug.trace.length} field->consumer pairs`);
  for (const entry of output.debug.trace) {
    write(`    ${entry.field} -> ${entry.consumer}`);
  }
  write('\n--- Cost ---');
  write(`  $${output.debug.cost_usd.toFixed(4)} USD`);
}

/** Pretty-print a FrameOutput to the write sink. */
function printOutput(output: FrameOutput, write: (msg: string) => void): void {
  printHeader(output, write);
  printProfile(output, write);
  printNarrative(output, write);
  printDirectives(output, write);
  printTrace(output, write);
}

/** Load and JSON.parse the fixture file, returning { code } on failure. */
function loadFixture(
  path: string,
  deps: DryRunDeps,
): { ok: true; data: unknown } | { ok: false; code: number } {
  let raw: string;
  try {
    raw = deps.readFile(path);
  } catch (e) {
    deps.error(`Failed to read fixture: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, code: 4 };
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    deps.error(`Invalid JSON in fixture: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, code: 2 };
  }
}

/**
 * Execute a Frame dry run end-to-end given an argv tail and an injected
 * deps bag. Returns the process exit code rather than calling exit so
 * the caller (and tests) can decide what to do with it.
 */
export async function runDryRun(args: string[], deps: DryRunDeps): Promise<number> {
  const fixturePath = args[0];
  if (!fixturePath) {
    deps.error('Usage: npm run frame:dry-run -- path/to/fixture.json');
    return 1;
  }
  const loaded = loadFixture(fixturePath, deps);
  if (!loaded.ok) return loaded.code;
  const validation = FRAME_INPUT_SCHEMA.safeParse(loaded.data);
  if (!validation.success) {
    deps.error(`Fixture failed validation: ${JSON.stringify(validation.error.flatten())}`);
    return 2;
  }
  const result = await deps.runFrame(validation.data, { clock: deps.clock, kv: deps.kv });
  if (!result.ok) {
    deps.error(`Frame run failed: ${result.error.kind}`);
    return 3;
  }
  printOutput(result.value, deps.write);
  return 0;
}

/** Build the default deps bag used when the script runs as a standalone CLI. */
function buildDefaultDeps(): DryRunDeps {
  return {
    readFile: (p) => readFileSync(p, 'utf-8'),
    write: (msg) => process.stdout.write(`${msg}\n`),
    error: (msg) => process.stderr.write(`${msg}\n`),
    runFrame,
    clock: () => new Date(),
    kv: new InMemoryKVStore(),
  };
}

const entry = process.argv[1] ?? '';
const normalized = entry.replace(/\\/g, '/');
const isMainModule = import.meta.url === `file://${normalized}` || import.meta.url.endsWith(normalized);
if (isMainModule) {
  runDryRun(process.argv.slice(2), buildDefaultDeps()).then((code) => process.exit(code));
}
