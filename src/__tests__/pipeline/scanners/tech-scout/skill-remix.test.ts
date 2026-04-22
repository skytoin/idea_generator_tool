import { describe, it, expect, afterEach } from 'vitest';
import { generateProblemHunts } from '../../../../pipeline/scanners/tech-scout/skill-remix';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
import type { FounderProfile } from '../../../../lib/types/founder-profile';

/** Minimum valid founder profile for LLM call tests. */
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
    profile_hash: 'test',
  };
}

/** Build a valid skill-remix JSON response string. */
function buildRemixJson(count = 3): string {
  return JSON.stringify({
    hunts: Array.from({ length: count }, (_, i) => ({
      skill_source: 'Python',
      problem: `concrete problem number ${i}`,
      example_search_phrases: [`search phrase ${i}`],
    })),
  });
}

describe('generateProblemHunts — happy path', () => {
  afterEach(() => resetOpenAIMock());

  it('returns ok with the LLM-produced hunts on success', async () => {
    setOpenAIResponse('remix-ok', { content: buildRemixJson(3) });
    const result = await generateProblemHunts(buildProfile(), { scenario: 'remix-ok' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value[0]!.skill_source).toBe('Python');
  });

  it('returns ok with 10 hunts at the upper bound', async () => {
    setOpenAIResponse('remix-10', { content: buildRemixJson(10) });
    const result = await generateProblemHunts(buildProfile(), { scenario: 'remix-10' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(10);
  });
});

describe('generateProblemHunts — failure', () => {
  afterEach(() => resetOpenAIMock());

  it('returns err when schema validation fails', async () => {
    // Unregistered scenario → MSW fallback returns {"ideas":[]} which
    // doesn't match the hunts schema.
    const result = await generateProblemHunts(buildProfile(), {
      scenario: 'remix-missing',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['llm_failed', 'schema_invalid']).toContain(result.error.kind);
  });

  it('returns err with llm_failed when response has only 2 hunts (below minimum)', async () => {
    setOpenAIResponse('remix-too-few', { content: buildRemixJson(2) });
    const result = await generateProblemHunts(buildProfile(), {
      scenario: 'remix-too-few',
    });
    expect(result.ok).toBe(false);
  });

  it('never throws on LLM error (returns err Result instead)', async () => {
    // Deliberately missing scenario; Result should be err, not a thrown exception.
    await expect(
      generateProblemHunts(buildProfile(), { scenario: 'remix-ghost' }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe('generateProblemHunts — edge cases', () => {
  afterEach(() => resetOpenAIMock());

  it('returns err when a hunt has zero example_search_phrases', async () => {
    setOpenAIResponse('remix-no-phrases', {
      content: JSON.stringify({
        hunts: [
          { skill_source: 'Python', problem: 'real problem here', example_search_phrases: [] },
          { skill_source: 'Python', problem: 'real problem two', example_search_phrases: ['a'] },
          { skill_source: 'Python', problem: 'real problem three', example_search_phrases: ['b'] },
        ],
      }),
    });
    const result = await generateProblemHunts(buildProfile(), {
      scenario: 'remix-no-phrases',
    });
    expect(result.ok).toBe(false);
  });

  it('returns err when a hunt problem is too short (<5 chars)', async () => {
    setOpenAIResponse('remix-short', {
      content: JSON.stringify({
        hunts: [
          { skill_source: 'Python', problem: 'x', example_search_phrases: ['a'] },
          { skill_source: 'Python', problem: 'real problem two', example_search_phrases: ['b'] },
          { skill_source: 'Python', problem: 'real problem three', example_search_phrases: ['c'] },
        ],
      }),
    });
    const result = await generateProblemHunts(buildProfile(), {
      scenario: 'remix-short',
    });
    expect(result.ok).toBe(false);
  });

  it('returns err when the response has 11 hunts (above max=10)', async () => {
    const content = JSON.stringify({
      hunts: Array.from({ length: 11 }, (_, i) => ({
        skill_source: 'Python',
        problem: `real problem ${i}`,
        example_search_phrases: ['a'],
      })),
    });
    setOpenAIResponse('remix-too-many', { content });
    const result = await generateProblemHunts(buildProfile(), {
      scenario: 'remix-too-many',
    });
    expect(result.ok).toBe(false);
  });

  it('works with a profile that has empty insider_knowledge and additional_context_raw', async () => {
    setOpenAIResponse('remix-empty-profile', { content: buildRemixJson(3) });
    const profile = buildProfile();
    profile.insider_knowledge = { value: null, source: 'assumed' };
    profile.additional_context_raw = '';
    const result = await generateProblemHunts(profile, {
      scenario: 'remix-empty-profile',
    });
    expect(result.ok).toBe(true);
  });
});
