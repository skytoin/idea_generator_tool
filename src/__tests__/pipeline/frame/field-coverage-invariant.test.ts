import { describe, it, expect, afterEach } from 'vitest';
import {
  FIELD_COVERAGE,
  type Consumer,
} from '../../../lib/types/field-coverage';
import type {
  FounderProfile,
  FounderProfileField,
} from '../../../lib/types/founder-profile';
import type { FrameInput } from '../../../lib/types/frame-input';
import { extractProfile } from '../../../pipeline/frame/extract-profile';
import { applyAssumptions } from '../../../pipeline/frame/apply-assumptions';
import { buildNarrativePrompt } from '../../../pipeline/prompts/frame-narrative';
import { buildDirectivesPrompt } from '../../../pipeline/prompts/frame-directives';
import { runFrame, type FrameDeps } from '../../../pipeline/steps/00-frame';
import { InMemoryKVStore } from '../../../lib/utils/kv-store';
import { setOpenAIResponse, resetOpenAIMock } from '../../mocks/openai-mock';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import carolRaw from './fixtures/carol-full.json';

const carol = carolRaw as FrameInput;
const FIXED_DATE = new Date('2026-04-09T12:00:00Z');

type ScannerKey =
  | 'tech_scout'
  | 'pain_scanner'
  | 'market_scanner'
  | 'change_scanner';

const SCANNERS: ScannerKey[] = [
  'tech_scout',
  'pain_scanner',
  'market_scanner',
  'change_scanner',
];

async function buildCarolProfile(): Promise<FounderProfile> {
  const ext = await extractProfile({ ...carol, additional_context: '' });
  if (!ext.ok) throw new Error('extract failed');
  const res = applyAssumptions(ext.value, carol.additional_context, 'carol-hash');
  if (!res.ok) throw new Error('assumptions failed');
  return res.value;
}

function techScoutDefault(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud ml'],
    exclude: [],
    notes: 'tech notes',
    target_sources: ['hn'],
    timeframe: 'last 12 months',
  };
}

function painScannerDefault(): ScannerDirectives['pain_scanner'] {
  return {
    keywords: ['audit prep'],
    exclude: [],
    notes: 'pain notes',
    target_subreddits: ['r/soc2'],
    personas: ['solo founder'],
  };
}

function marketScannerDefault(): ScannerDirectives['market_scanner'] {
  return {
    keywords: ['compliance saas'],
    exclude: [],
    notes: 'market notes',
    competitor_domains: ['drata.com'],
    yc_batches_to_scan: ['S23'],
  };
}

function changeScannerDefault(): ScannerDirectives['change_scanner'] {
  return {
    keywords: ['aicpa'],
    exclude: [],
    notes: 'change notes',
    regulatory_areas: ['SOC-2'],
    geographic: ['US'],
  };
}

function defaultDirectives(): ScannerDirectives {
  return {
    tech_scout: techScoutDefault(),
    pain_scanner: painScannerDefault(),
    market_scanner: marketScannerDefault(),
    change_scanner: changeScannerDefault(),
  };
}

function extractionNullJson(): string {
  return JSON.stringify({
    domain: null,
    insider_knowledge: null,
    anti_targets: null,
    network: null,
    audience: null,
    proprietary_access: null,
    rare_combinations: null,
    recurring_frustration: null,
    four_week_mvp: null,
    previous_attempts: null,
    customer_affinity: null,
    trigger: null,
    legal_constraints: null,
  });
}

function buildCarolDeps(narrativeProse: string): FrameDeps {
  setOpenAIResponse('inv-extract', { content: extractionNullJson() });
  setOpenAIResponse('inv-narrative', { content: narrativeProse });
  setOpenAIResponse('inv-directives', {
    content: JSON.stringify(defaultDirectives()),
  });
  return {
    clock: () => FIXED_DATE,
    kv: new InMemoryKVStore(),
    scenarios: {
      extract: 'inv-extract',
      narrative: 'inv-narrative',
      directives: 'inv-directives',
    },
  };
}

describe('§B — runtime trace coverage on carol-full', () => {
  afterEach(() => resetOpenAIMock());

  it('the final FrameOutput trace contains every (field, consumer) from FIELD_COVERAGE', async () => {
    const prose = 'A'.repeat(80);
    const deps = buildCarolDeps(prose);
    const result = await runFrame(carol, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trace = result.value.debug.trace;
    for (const [field, entry] of Object.entries(FIELD_COVERAGE)) {
      for (const consumer of entry.consumers) {
        const present = trace.some(
          (t) => t.field === field && t.consumer === consumer,
        );
        expect(present, `trace missing (${field}, ${consumer})`).toBe(true);
      }
    }
  });
});

describe('§C — prompt literal inclusion of required_in_prompt fields', () => {
  it('narrative prompt contains every required_in_prompt field value', async () => {
    const profile = await buildCarolProfile();
    const { user, system } = buildNarrativePrompt(
      profile,
      'refine',
      carol.existing_idea ?? null,
    );
    const whole = `${system}\n${user}`;
    for (const [field, entry] of Object.entries(FIELD_COVERAGE)) {
      if (!entry.required_in_prompt) continue;
      if (!entry.consumers.includes('narrative')) continue;
      assertFieldValueInPrompt(field as FounderProfileField, profile, whole);
    }
  });

  it('directives prompt contains every required_in_prompt field value per scanner', async () => {
    const profile = await buildCarolProfile();
    const { user } = buildDirectivesPrompt(
      profile,
      'narrative prose placeholder',
      'refine',
      carol.existing_idea ?? null,
    );
    for (const [field, entry] of Object.entries(FIELD_COVERAGE)) {
      if (!entry.required_in_prompt) continue;
      const scannerConsumers = entry.consumers.filter(isScannerConsumer);
      if (scannerConsumers.length === 0) continue;
      assertFieldValueInPrompt(field as FounderProfileField, profile, user);
    }
  });
});

/** Narrow-check helper — true when `c` is one of the 4 scanner consumers. */
function isScannerConsumer(c: Consumer): c is ScannerKey {
  return (
    c === 'tech_scout' ||
    c === 'pain_scanner' ||
    c === 'market_scanner' ||
    c === 'change_scanner'
  );
}

/** Assert every serializable component of a profile field appears in a prompt. */
function assertFieldValueInPrompt(
  field: FounderProfileField,
  profile: FounderProfile,
  prompt: string,
): void {
  const entry = profile[field];
  const value = entry.value;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') expect(prompt).toContain(item);
      else if (item && typeof item === 'object' && 'area' in item)
        expect(prompt).toContain((item as { area: string }).area);
    }
  } else if (typeof value === 'string' && value.length > 0) {
    expect(prompt).toContain(value);
  }
}

describe('§D — mutation propagation (orphan probe)', () => {
  it('mutating each field changes at least one consumer prompt', async () => {
    const profile = await buildCarolProfile();
    for (const field of Object.keys(FIELD_COVERAGE) as FounderProfileField[]) {
      assertFieldInfluencesPrompts(field, profile);
    }
  });
});

/** Mutate a field's value to a sentinel that is guaranteed to be distinguishable. */
function mutateField(
  profile: FounderProfile,
  field: FounderProfileField,
): FounderProfile {
  const clone: FounderProfile = JSON.parse(JSON.stringify(profile));
  const record = clone as unknown as Record<
    string,
    { value: unknown; source: string } | undefined
  >;
  const entry = record[field];
  if (!entry) return clone;
  entry.value = mutationFor(field, entry.value);
  return clone;
}

/** Produce a sentinel replacement value appropriate for the field's type. */
function mutationFor(field: FounderProfileField, current: unknown): unknown {
  const sentinel = `__ORPHAN_PROBE_${field}__`;
  if (field === 'domain') return [{ area: sentinel, years: 0 }];
  if (field === 'skills' || field === 'anti_targets') return [sentinel];
  if (field === 'time_per_week') return current === '40' ? '20' : '40';
  if (field === 'money_available') return current === 'more' ? 'no_limit' : 'more';
  if (field === 'ambition') return current === 'build_company' ? 'unsure' : 'build_company';
  if (field === 'time_to_revenue')
    return current === '1_year_plus' ? '2_months' : '1_year_plus';
  if (field === 'customer_type_preference') return current === 'both' ? 'b2b' : 'both';
  return sentinel;
}

/** Build both the narrative and directives user prompts for a profile. */
function renderPrompts(profile: FounderProfile): {
  narrative: string;
  directives: string;
} {
  const idea = carol.existing_idea ?? null;
  return {
    narrative: buildNarrativePrompt(profile, 'refine', idea).user,
    directives: buildDirectivesPrompt(profile, 'prose', 'refine', idea).user,
  };
}

/** Assert that mutating `field` changes at least one consumer's prompt text. */
function assertFieldInfluencesPrompts(
  field: FounderProfileField,
  profile: FounderProfile,
): void {
  const before = renderPrompts(profile);
  const after = renderPrompts(mutateField(profile, field));
  const consumers = FIELD_COVERAGE[field].consumers;
  const narrativeChanged =
    consumers.includes('narrative') && before.narrative !== after.narrative;
  const directivesChanged =
    consumers.some(isScannerConsumer) && before.directives !== after.directives;
  expect(
    narrativeChanged || directivesChanged,
    `mutating ${field} did not change any consumer prompt`,
  ).toBe(true);
}

describe('§E — anti-target enforcement invariant', () => {
  afterEach(() => resetOpenAIMock());

  it('every carol anti_target appears in every scanner exclude array', async () => {
    const prose = 'A'.repeat(80);
    const deps = buildCarolDeps(prose);
    const result = await runFrame(carol, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const antiTargets = result.value.profile.anti_targets.value;
    for (const scanner of SCANNERS) {
      for (const a of antiTargets) {
        expect(
          result.value.directives[scanner].exclude,
          `${scanner}.exclude missing ${a}`,
        ).toContain(a);
      }
    }
  });
});

describe('§F — refine mode anchor preservation', () => {
  afterEach(() => resetOpenAIMock());

  it('existing_idea description appears in narrative prose and every scanner notes', async () => {
    const existingIdea = carol.existing_idea ?? '';
    // Make the mock narrative include the existing idea verbatim, and
    // ensure it is >= 50 chars.
    const prose = `A founder working on: ${existingIdea}. She has 8 years of payments experience.`;
    const deps = buildCarolDeps(prose);
    const result = await runFrame(carol, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.narrative.prose).toContain(existingIdea);
    for (const scanner of SCANNERS) {
      expect(result.value.directives[scanner].notes).toContain(existingIdea);
    }
  });
});

describe('§G — additional_context_raw propagation invariant', () => {
  it('carol verbatim additional_context appears in the narrative prompt', async () => {
    const ext = await extractProfile({ ...carol, additional_context: '' });
    if (!ext.ok) throw new Error('extract failed');
    const assumed = applyAssumptions(ext.value, carol.additional_context, 'carol-hash');
    if (!assumed.ok) throw new Error('assumptions failed');
    const { user } = buildNarrativePrompt(
      assumed.value,
      'refine',
      carol.existing_idea ?? null,
    );
    // Distinctive phrases that exist ONLY in Carol's additional_context —
    // not in any structured field — so if they appear in the prompt, the
    // raw context propagated.
    expect(user).toContain('Seeing Like a State');
    expect(user).toContain('cabin in Vermont');
    expect(user).toContain('<founder_notes>');
  });

  it('carol verbatim additional_context appears in the directives prompt', async () => {
    const ext = await extractProfile({ ...carol, additional_context: '' });
    if (!ext.ok) throw new Error('extract failed');
    const assumed = applyAssumptions(ext.value, carol.additional_context, 'carol-hash');
    if (!assumed.ok) throw new Error('assumptions failed');
    const { user } = buildDirectivesPrompt(
      assumed.value,
      'narrative prose',
      'refine',
      carol.existing_idea ?? null,
    );
    expect(user).toContain('Seeing Like a State');
    expect(user).toContain('cabin in Vermont');
    expect(user).toContain('<founder_notes>');
  });

  it('empty additional_context produces no founder_notes block in either prompt', async () => {
    const ext = await extractProfile({ ...carol, additional_context: '' });
    if (!ext.ok) throw new Error('extract failed');
    const assumed = applyAssumptions(ext.value, '', 'carol-empty-hash');
    if (!assumed.ok) throw new Error('assumptions failed');
    const narrativePrompt = buildNarrativePrompt(
      assumed.value,
      'refine',
      carol.existing_idea ?? null,
    );
    const directivesPrompt = buildDirectivesPrompt(
      assumed.value,
      'narrative prose',
      'refine',
      carol.existing_idea ?? null,
    );
    expect(narrativePrompt.user).not.toContain('<founder_notes>');
    expect(directivesPrompt.user).not.toContain('<founder_notes>');
  });
});
