import { describe, it, expect, afterEach } from 'vitest';
import { buildNarrativePrompt } from '../../../pipeline/prompts/frame-narrative';
import { generateNarrative } from '../../../pipeline/frame/generate-narrative';
import { setOpenAIResponse, resetOpenAIMock } from '../../mocks/openai-mock';
import { FIELD_COVERAGE } from '../../../lib/types/field-coverage';
import { extractProfile } from '../../../pipeline/frame/extract-profile';
import { applyAssumptions } from '../../../pipeline/frame/apply-assumptions';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { FrameInput } from '../../../lib/types/frame-input';
import carolRaw from './fixtures/carol-full.json';
import aliceRaw from './fixtures/alice-minimum.json';

const carol = carolRaw as FrameInput;
const alice = aliceRaw as FrameInput;

async function buildCarolProfile(): Promise<FounderProfile> {
  const ext = await extractProfile({ ...carol, additional_context: '' });
  if (!ext.ok) throw new Error('extract failed');
  const res = applyAssumptions(ext.value, carol.additional_context, 'carol-hash');
  if (!res.ok) throw new Error('assumptions failed');
  return res.value;
}

async function buildAliceProfile(): Promise<FounderProfile> {
  const ext = await extractProfile(alice);
  if (!ext.ok) throw new Error('extract failed');
  const res = applyAssumptions(ext.value, alice.additional_context, 'alice-hash');
  if (!res.ok) throw new Error('assumptions failed');
  return res.value;
}

describe('buildNarrativePrompt — field coverage for narrative consumer', () => {
  it('contains every profile field value that is non-null on carol', async () => {
    const profile = await buildCarolProfile();
    const { user, system, trace } = buildNarrativePrompt(
      profile,
      'refine',
      carol.existing_idea ?? null,
    );
    const whole = `${system}\n${user}`;
    // skills array elements appear
    for (const s of profile.skills.value) expect(whole).toContain(s);
    // time_per_week & money_available enums appear
    expect(whole).toContain(profile.time_per_week.value);
    expect(whole).toContain(profile.money_available.value);
    expect(whole).toContain(profile.ambition.value);
    // domain entries — each area
    for (const d of profile.domain.value) expect(whole).toContain(d.area);
    // insider_knowledge
    if (profile.insider_knowledge.value !== null)
      expect(whole).toContain(profile.insider_knowledge.value);
    // anti_targets
    for (const a of profile.anti_targets.value) expect(whole).toContain(a);
    // network, audience
    if (profile.network.value !== null) expect(whole).toContain(profile.network.value);
    if (profile.audience.value !== null) expect(whole).toContain(profile.audience.value);
    // proprietary_access, rare_combinations, recurring_frustration, four_week_mvp
    if (profile.proprietary_access.value !== null)
      expect(whole).toContain(profile.proprietary_access.value);
    if (profile.rare_combinations.value !== null)
      expect(whole).toContain(profile.rare_combinations.value);
    if (profile.recurring_frustration.value !== null)
      expect(whole).toContain(profile.recurring_frustration.value);
    if (profile.four_week_mvp.value !== null)
      expect(whole).toContain(profile.four_week_mvp.value);
    if (profile.previous_attempts.value !== null)
      expect(whole).toContain(profile.previous_attempts.value);
    if (profile.customer_affinity.value !== null)
      expect(whole).toContain(profile.customer_affinity.value);
    expect(whole).toContain(profile.time_to_revenue.value);
    expect(whole).toContain(profile.customer_type_preference.value);
    if (profile.trigger.value !== null) expect(whole).toContain(profile.trigger.value);
    if (profile.legal_constraints.value !== null)
      expect(whole).toContain(profile.legal_constraints.value);
    // Trace entries cover every narrative field
    const entries = trace.entries();
    for (const [field, entry] of Object.entries(FIELD_COVERAGE)) {
      if (!entry.consumers.includes('narrative')) continue;
      expect(
        entries.some((e) => e.field === field && e.consumer === 'narrative'),
        `narrative trace missing ${field}`,
      ).toBe(true);
    }
  });

  it('trace has an entry for every field with narrative consumer (alice minimal)', async () => {
    const profile = await buildAliceProfile();
    const { trace } = buildNarrativePrompt(profile, 'explore', null);
    for (const [field, entry] of Object.entries(FIELD_COVERAGE)) {
      if (!entry.consumers.includes('narrative')) continue;
      expect(
        trace.hasUsed(field),
        `narrative trace missing ${field} for alice`,
      ).toBe(true);
    }
  });

  it('refine mode prompt includes existing idea verbatim', async () => {
    const profile = await buildCarolProfile();
    const { user } = buildNarrativePrompt(
      profile,
      'refine',
      carol.existing_idea ?? null,
    );
    expect(user).toContain(carol.existing_idea);
  });

  it('explore mode does not mention refining an existing idea', async () => {
    const profile = await buildAliceProfile();
    const { user } = buildNarrativePrompt(profile, 'explore', null);
    expect(user).not.toContain('existing idea');
  });

  it('anti_targets appear as individual strings', async () => {
    const profile = await buildCarolProfile();
    const { user } = buildNarrativePrompt(profile, 'refine', carol.existing_idea ?? null);
    for (const a of profile.anti_targets.value) {
      expect(user).toContain(a);
    }
  });

  it('confidence tags are communicated in prompt (assumed fields flagged)', async () => {
    const profile = await buildAliceProfile();
    const { user } = buildNarrativePrompt(profile, 'explore', null);
    // audience is assumed on alice — expect some "(assumed)" annotation
    expect(user).toContain('(assumed)');
  });

  it('injects scenario marker at the start of the system prompt', async () => {
    const profile = await buildAliceProfile();
    const { system } = buildNarrativePrompt(profile, 'explore', null, 'narrative-demo');
    expect(system.startsWith('[[SCENARIO:narrative-demo]]')).toBe(true);
  });

  it('injects verbatim additional_context_raw into the user prompt when present', async () => {
    const ext = await extractProfile({ ...alice, additional_context: '' });
    if (!ext.ok) throw new Error('extract failed');
    const assumed = applyAssumptions(
      ext.value,
      'I am obsessed with fraud detection UX and dream of running this from a Vermont cabin.',
      'notes-hash',
    );
    if (!assumed.ok) throw new Error('assumptions failed');
    const { user } = buildNarrativePrompt(assumed.value, 'explore', null);
    expect(user).toContain('<founder_notes>');
    expect(user).toContain('</founder_notes>');
    expect(user).toContain('obsessed with fraud detection UX');
    expect(user).toContain('Vermont cabin');
  });

  it('omits the founder_notes block entirely when additional_context_raw is empty', async () => {
    const profile = await buildAliceProfile();
    expect(profile.additional_context_raw).toBe('');
    const { user } = buildNarrativePrompt(profile, 'explore', null);
    expect(user).not.toContain('<founder_notes>');
  });

  it('system prompt warns that founder_notes content is untrusted', async () => {
    const profile = await buildAliceProfile();
    const { system } = buildNarrativePrompt(profile, 'explore', null);
    expect(system).toContain('<founder_notes>');
    expect(system.toLowerCase()).toContain('untrusted');
  });

  it('system prompt includes acronym-preservation rule with MCP example', async () => {
    // Regression test for the MCP-interpreted-as-Multi-Cloud-Platform bug.
    // The LLM was expanding "MCP" to "multi-cloud platforms" in narratives,
    // which misdirected every downstream scanner query. The prompt now
    // tells the LLM to preserve unknown acronyms verbatim.
    const profile = await buildAliceProfile();
    const { system } = buildNarrativePrompt(profile, 'explore', null);
    expect(system.toUpperCase()).toContain('ACRONYM');
    expect(system).toMatch(/preserve the acronym verbatim/i);
    expect(system).toContain('MCP');
  });

  it('required_in_prompt fields appear in the prompt', async () => {
    const profile = await buildCarolProfile();
    const { user, system } = buildNarrativePrompt(
      profile,
      'refine',
      carol.existing_idea ?? null,
    );
    const whole = `${system}\n${user}`;
    const required = Object.entries(FIELD_COVERAGE)
      .filter(([, e]) => e.required_in_prompt)
      .map(([k]) => k);
    for (const field of required) {
      // skills, time_per_week, money_available, ambition, domain,
      // insider_knowledge, anti_targets
      // All of these have non-null values for carol.
      const entry = (profile as unknown as Record<string, { value: unknown } | undefined>)[
        field
      ];
      const value = entry?.value;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') expect(whole).toContain(item);
          else if (item && typeof item === 'object' && 'area' in item)
            expect(whole).toContain((item as { area: string }).area);
        }
      } else if (typeof value === 'string') {
        expect(whole).toContain(value);
      }
    }
  });
});

describe('generateNarrative — end to end', () => {
  afterEach(() => resetOpenAIMock());

  it('returns ok with narrative when LLM returns valid prose', async () => {
    const profile = await buildCarolProfile();
    const prose = 'A'.repeat(80);
    setOpenAIResponse('narrative-ok', { content: prose });
    const result = await generateNarrative(profile, 'refine', carol.existing_idea ?? null, {
      scenario: 'narrative-ok',
      clock: () => new Date('2026-04-09T12:00:00Z'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.narrative.prose).toBe(prose);
    expect(result.value.narrative.word_count).toBe(1);
    expect(result.value.narrative.generated_at).toBe('2026-04-09T12:00:00.000Z');
    expect(result.value.cost).toBe(0);
    expect(result.value.trace.consumerName).toBe('narrative');
  });

  it('returns schema_invalid when LLM content is too short', async () => {
    const profile = await buildCarolProfile();
    setOpenAIResponse('narrative-short', { content: 'too short' });
    const result = await generateNarrative(profile, 'refine', carol.existing_idea ?? null, {
      scenario: 'narrative-short',
      clock: () => new Date('2026-04-09T12:00:00Z'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('schema_invalid');
  });

  it('word_count counts multi-word prose correctly', async () => {
    const profile = await buildCarolProfile();
    const prose = 'one two three four five '.repeat(20).trim();
    setOpenAIResponse('narrative-multi', { content: prose });
    const result = await generateNarrative(profile, 'refine', carol.existing_idea ?? null, {
      scenario: 'narrative-multi',
      clock: () => new Date('2026-04-09T12:00:00Z'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.narrative.word_count).toBe(100);
  });

  it('default fallthrough response (too short) returns err', async () => {
    const profile = await buildCarolProfile();
    // unregistered scenario -> default "{"ideas": []}" content, 13 chars, too short
    const result = await generateNarrative(profile, 'refine', carol.existing_idea ?? null, {
      scenario: 'unregistered-narr',
      clock: () => new Date('2026-04-09T12:00:00Z'),
    });
    expect(result.ok).toBe(false);
  });
});
