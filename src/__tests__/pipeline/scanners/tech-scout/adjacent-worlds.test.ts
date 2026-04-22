import { describe, it, expect, afterEach } from 'vitest';
import { generateAdjacentWorlds } from '../../../../pipeline/scanners/tech-scout/adjacent-worlds';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
import type { FounderProfile } from '../../../../lib/types/founder-profile';

function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['python', 'nursing']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'healthcare', years: 10 }]),
    insider_knowledge: stated('clinical workflow'),
    anti_targets: stated([]),
    network: stated(null),
    audience: stated(null),
    proprietary_access: stated(null),
    rare_combinations: stated(null),
    recurring_frustration: stated(null),
    four_week_mvp: stated(null),
    previous_attempts: stated(null),
    customer_affinity: stated(null),
    time_to_revenue: stated('no_preference'),
    customer_type_preference: stated('no_preference'),
    trigger: stated(null),
    legal_constraints: stated(null),
    divergence_level: stated('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'adj-test',
  };
}

/** Build a valid adjacent-worlds JSON response with n worlds. */
function buildWorldsJson(n = 2): string {
  return JSON.stringify({
    worlds: Array.from({ length: n }, (_, i) => ({
      source_domain: 'nursing',
      adjacent_domain: `world${i}`,
      shared_traits: ['trait'],
      example_search_phrases: [`phrase${i}`],
    })),
  });
}

describe('generateAdjacentWorlds — happy path', () => {
  afterEach(() => resetOpenAIMock());

  it('returns ok with 2 worlds on successful LLM response', async () => {
    setOpenAIResponse('adj-ok', { content: buildWorldsJson(2) });
    const result = await generateAdjacentWorlds(buildProfile(), { scenario: 'adj-ok' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.shared_traits).toContain('trait');
  });

  it('returns ok with 6 worlds at the upper bound', async () => {
    setOpenAIResponse('adj-6', { content: buildWorldsJson(6) });
    const result = await generateAdjacentWorlds(buildProfile(), { scenario: 'adj-6' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(6);
  });
});

describe('generateAdjacentWorlds — failure', () => {
  afterEach(() => resetOpenAIMock());

  it('returns err when schema validation fails (unregistered scenario)', async () => {
    const result = await generateAdjacentWorlds(buildProfile(), {
      scenario: 'adj-ghost',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['llm_failed', 'schema_invalid']).toContain(result.error.kind);
  });

  it('returns err when the response has only 1 world (below min=2)', async () => {
    setOpenAIResponse('adj-one', { content: buildWorldsJson(1) });
    const result = await generateAdjacentWorlds(buildProfile(), { scenario: 'adj-one' });
    expect(result.ok).toBe(false);
  });

  it('returns err when a world has zero shared_traits (drift guard)', async () => {
    setOpenAIResponse('adj-empty-traits', {
      content: JSON.stringify({
        worlds: [
          {
            source_domain: 'nursing',
            adjacent_domain: 'aviation',
            shared_traits: [],
            example_search_phrases: ['x'],
          },
          {
            source_domain: 'nursing',
            adjacent_domain: 'hospitality',
            shared_traits: ['shifts'],
            example_search_phrases: ['y'],
          },
        ],
      }),
    });
    const result = await generateAdjacentWorlds(buildProfile(), {
      scenario: 'adj-empty-traits',
    });
    expect(result.ok).toBe(false);
  });

  it('never throws on error (returns err Result instead)', async () => {
    await expect(
      generateAdjacentWorlds(buildProfile(), { scenario: 'adj-vanish' }),
    ).resolves.toMatchObject({ ok: false });
  });
});
