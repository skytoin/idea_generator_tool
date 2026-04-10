import { describe, it, expect, afterEach } from 'vitest';
import { buildDirectivesPrompt } from '../../../pipeline/prompts/frame-directives';
import { generateDirectives } from '../../../pipeline/frame/generate-directives';
import { setOpenAIResponse, resetOpenAIMock } from '../../mocks/openai-mock';
import { FIELD_COVERAGE, CONSUMERS } from '../../../lib/types/field-coverage';
import { extractProfile } from '../../../pipeline/frame/extract-profile';
import { applyAssumptions } from '../../../pipeline/frame/apply-assumptions';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { FrameInput } from '../../../lib/types/frame-input';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import carolRaw from './fixtures/carol-full.json';
import bobRaw from './fixtures/bob-medium.json';

const carol = carolRaw as FrameInput;
const bob = bobRaw as FrameInput;

async function buildProfile(
  input: FrameInput,
  hash: string,
): Promise<FounderProfile> {
  const ext = await extractProfile({ ...input, additional_context: '' });
  if (!ext.ok) throw new Error('extract failed');
  const res = applyAssumptions(ext.value, input.additional_context, hash);
  if (!res.ok) throw new Error('assumptions failed');
  return res.value;
}

type ScannerKey = 'tech_scout' | 'pain_scanner' | 'market_scanner' | 'change_scanner';

const SCANNER_CONSUMERS: ScannerKey[] = [
  'tech_scout',
  'pain_scanner',
  'market_scanner',
  'change_scanner',
];

function makeScannerDirectivesContent(
  overrides: Partial<{
    techExclude: string[];
    painExclude: string[];
    marketExclude: string[];
    changeExclude: string[];
    techNotes: string;
    painNotes: string;
    marketNotes: string;
    changeNotes: string;
  }> = {},
): string {
  const base: ScannerDirectives = {
    tech_scout: {
      keywords: ['fraud ml'],
      exclude: overrides.techExclude ?? [],
      notes: overrides.techNotes ?? 'Look at new fraud tools',
      target_sources: ['hn', 'arxiv'],
      timeframe: 'last 12 months',
    },
    pain_scanner: {
      keywords: ['audit prep'],
      exclude: overrides.painExclude ?? [],
      notes: overrides.painNotes ?? 'Focus on compliance pain',
      target_subreddits: ['r/soc2'],
      personas: ['solo founder'],
    },
    market_scanner: {
      keywords: ['compliance saas'],
      exclude: overrides.marketExclude ?? [],
      notes: overrides.marketNotes ?? 'Check YC compliance batches',
      competitor_domains: ['drata.com'],
      yc_batches_to_scan: ['S23'],
    },
    change_scanner: {
      keywords: ['aicpa change'],
      exclude: overrides.changeExclude ?? [],
      notes: overrides.changeNotes ?? 'Watch AICPA updates',
      regulatory_areas: ['SOC-2'],
      geographic: ['US'],
    },
  };
  return JSON.stringify(base);
}

describe('buildDirectivesPrompt — trace and prompt content', () => {
  it('records a trace entry for every field/consumer pair declared in coverage', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    const { traces } = buildDirectivesPrompt(
      profile,
      'narrative prose here',
      'refine',
      carol.existing_idea ?? null,
    );
    const consumerTrace = new Map(traces.map((t) => [t.consumerName, t]));
    for (const scanner of SCANNER_CONSUMERS) {
      const trace = consumerTrace.get(scanner);
      expect(trace, `no trace for ${scanner}`).toBeDefined();
      if (!trace) continue;
      for (const [field, entry] of Object.entries(FIELD_COVERAGE)) {
        if (!entry.consumers.includes(scanner)) continue;
        expect(
          trace.hasUsed(field, scanner),
          `${scanner} trace missing ${field}`,
        ).toBe(true);
      }
    }
  });

  it('includes every narrative-consumer field value that a scanner reads (carol)', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    const { user } = buildDirectivesPrompt(
      profile,
      'narrative prose here',
      'refine',
      carol.existing_idea ?? null,
    );
    // Any field that ANY scanner consumes — its value must appear in the
    // user prompt (each scanner-consumer uses its own fields via traces).
    const scannerFields = Object.entries(FIELD_COVERAGE).filter(([, e]) =>
      e.consumers.some((c) => c !== 'narrative'),
    );
    for (const [field] of scannerFields) {
      const entry = (profile as unknown as Record<
        string,
        { value: unknown } | undefined
      >)[field];
      const value = entry?.value;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') expect(user).toContain(item);
          else if (item && typeof item === 'object' && 'area' in item)
            expect(user).toContain((item as { area: string }).area);
        }
      } else if (typeof value === 'string') {
        expect(user).toContain(value);
      }
    }
  });

  it('includes the narrative prose in the user prompt', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    const { user } = buildDirectivesPrompt(
      profile,
      'DISTINCT_NARRATIVE_PROSE_HERE',
      'refine',
      carol.existing_idea ?? null,
    );
    expect(user).toContain('DISTINCT_NARRATIVE_PROSE_HERE');
  });

  it('includes anti_targets in the prompt', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    const { user } = buildDirectivesPrompt(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
    );
    for (const a of profile.anti_targets.value) expect(user).toContain(a);
  });

  it('injects scenario marker in system prompt when provided', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    const { system } = buildDirectivesPrompt(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
      'directives-scenario',
    );
    expect(system.startsWith('[[SCENARIO:directives-scenario]]')).toBe(true);
  });

  it('builds one trace per scanner consumer (4 total)', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    const { traces } = buildDirectivesPrompt(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
    );
    const names = traces.map((t) => t.consumerName).sort();
    expect(names).toEqual(SCANNER_CONSUMERS.slice().sort());
  });

  it('injects verbatim additional_context_raw into the user prompt when present', async () => {
    const { extractProfile } = await import('../../../pipeline/frame/extract-profile');
    const { applyAssumptions } = await import('../../../pipeline/frame/apply-assumptions');
    const ext = await extractProfile({ ...bob, additional_context: '' });
    if (!ext.ok) throw new Error('extract failed');
    const assumed = applyAssumptions(
      ext.value,
      'Obsessed with Shopify Liquid and love helping theme shops.',
      'bob-hash',
    );
    if (!assumed.ok) throw new Error('assumptions failed');
    const { user } = buildDirectivesPrompt(assumed.value, 'prose', 'explore', null);
    expect(user).toContain('<founder_notes>');
    expect(user).toContain('</founder_notes>');
    expect(user).toContain('Obsessed with Shopify Liquid');
    expect(user).toContain('love helping theme shops');
  });

  it('omits founder_notes block when additional_context_raw is empty', async () => {
    const profile = await buildProfile({ ...bob, additional_context: '' }, 'bob-hash');
    expect(profile.additional_context_raw).toBe('');
    const { user } = buildDirectivesPrompt(profile, 'prose', 'explore', null);
    expect(user).not.toContain('<founder_notes>');
  });

  it('system prompt warns that founder_notes content is untrusted', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    const { system } = buildDirectivesPrompt(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
    );
    expect(system).toContain('<founder_notes>');
    expect(system.toLowerCase()).toContain('untrusted');
  });
});

describe('generateDirectives — end to end', () => {
  afterEach(() => resetOpenAIMock());

  it('returns ok with parsed directives when LLM returns valid JSON', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    setOpenAIResponse('directives-ok', { content: makeScannerDirectivesContent() });
    const result = await generateDirectives(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
      { scenario: 'directives-ok' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.directives.tech_scout.keywords).toContain('fraud ml');
    expect(result.value.traces).toHaveLength(4);
    expect(result.value.cost).toBeGreaterThanOrEqual(0);
  });

  it('merges anti_targets into every scanner exclude (post-processing)', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    // Profile anti_targets: ['crypto', 'gambling', 'adult content', 'defense']
    setOpenAIResponse('directives-empty-exclude', {
      content: makeScannerDirectivesContent(),
    });
    const result = await generateDirectives(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
      { scenario: 'directives-empty-exclude' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dir = result.value.directives;
    for (const scanner of SCANNER_CONSUMERS) {
      const entry = dir[scanner];
      for (const a of profile.anti_targets.value) {
        expect(entry.exclude).toContain(a);
      }
    }
  });

  it('dedupes anti_targets against existing exclude values', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    setOpenAIResponse('directives-pre-excluded', {
      content: makeScannerDirectivesContent({
        techExclude: ['crypto'],
        painExclude: ['gambling', 'crypto'],
      }),
    });
    const result = await generateDirectives(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
      { scenario: 'directives-pre-excluded' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tech = result.value.directives.tech_scout.exclude;
    const cryptoCount = tech.filter((x) => x === 'crypto').length;
    expect(cryptoCount).toBe(1);
  });

  it('refine mode appends existing idea to every scanner notes', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    setOpenAIResponse('directives-refine-notes', {
      content: makeScannerDirectivesContent(),
    });
    const result = await generateDirectives(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
      { scenario: 'directives-refine-notes' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const scanner of SCANNER_CONSUMERS) {
      expect(result.value.directives[scanner].notes).toContain(carol.existing_idea ?? '');
    }
  });

  it('explore mode does not append an existing idea to notes', async () => {
    const profile = await buildProfile(bob, 'bob-hash');
    setOpenAIResponse('directives-explore-notes', {
      content: makeScannerDirectivesContent({
        techNotes: 'plain tech notes',
        painNotes: 'plain pain notes',
        marketNotes: 'plain market notes',
        changeNotes: 'plain change notes',
      }),
    });
    const result = await generateDirectives(
      profile,
      'prose',
      'explore',
      null,
      { scenario: 'directives-explore-notes' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.directives.tech_scout.notes).toBe('plain tech notes');
    expect(result.value.directives.pain_scanner.notes).toBe('plain pain notes');
  });

  it('returns err when LLM response fails schema validation', async () => {
    const profile = await buildProfile(carol, 'carol-hash');
    // unregistered scenario -> default '{"ideas": []}' which doesn't match
    // the directives schema
    const result = await generateDirectives(
      profile,
      'prose',
      'refine',
      carol.existing_idea ?? null,
      { scenario: 'unregistered-directives' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['llm_failed', 'schema_invalid']).toContain(result.error.kind);
  });

  it('CONSUMERS list still includes all 4 scanners', () => {
    for (const scanner of SCANNER_CONSUMERS) {
      expect(CONSUMERS).toContain(scanner);
    }
  });
});
