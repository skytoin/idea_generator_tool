# Tech Scout v2 — Skill Remix + Adjacent World + Two-Pass Loop

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve tech-scout query quality by (a) translating founder skills into problem-hunts instead of literal keywords, (b) mapping adjacent worlds for analogical transfer, and (c) wrapping the scan in a two-pass loop that refines queries based on first-pass results.

**Architecture:** Three new pure LLM modules feed structured inputs (`ProblemHunts`, `AdjacentWorlds`) into the existing query planner, which now consumes those in addition to directive keywords. A new orchestrator module runs the existing scan once, summarizes results, generates pass-2 refinements via a new LLM call, and merges the outputs. Each module is independently testable and behind a feature flag so we can A/B against the v1 pipeline.

**Tech Stack:** TypeScript, Vercel AI SDK (`generateObject`), Zod, Vitest, MSW for LLM mocking. Follows the same Result<T, E> + per-step-module patterns already established in `src/pipeline/scanners/tech-scout/`.

---

## Preflight

- [ ] **Confirm baseline is green for files this plan touches**

Run: `npm test -- --run src/__tests__/pipeline/scanners/tech-scout/adapters/github.test.ts src/__tests__/pipeline/scanners/tech-scout/post-process.test.ts src/__tests__/pipeline/scanners/tech-scout/query-planner.test.ts`

Expected: github + post-process green, query-planner has 30 pre-existing failures from the v1→v2 schema drift. New tests added in this plan must not increase that count.

- [ ] **Read referenced skills**

Reference: @superpowers:test-driven-development, @superpowers:systematic-debugging. Every task below uses red → green → refactor.

---

## File Structure

```
src/lib/types/
  problem-hunt.ts              NEW   Zod schema: problem hunts (functional decomposition of skills)
  adjacent-world.ts            NEW   Zod schema: adjacent worlds with shared structural traits
  two-pass-state.ts            NEW   Zod schema: first-pass summary + refinement inputs

src/pipeline/prompts/
  tech-scout-skill-remix.ts    NEW   Prompt for skill → problem hunts
  tech-scout-adjacent.ts       NEW   Prompt for domain → adjacent worlds
  tech-scout-refine.ts         NEW   Prompt for pass-2 refinement

src/pipeline/scanners/tech-scout/
  skill-remix.ts               NEW   LLM call: founder → ProblemHunts
  adjacent-worlds.ts           NEW   LLM call: founder → AdjacentWorlds
  first-pass-summary.ts        NEW   Pure: summarize pass-1 results for the refinement LLM
  refine-planner.ts            NEW   LLM call: summary → refined ExpandedQueryPlan
  two-pass-orchestrator.ts     NEW   Orchestrates pass 1 → summarize → pass 2 → merge
  query-planner.ts             MOD   Consume ProblemHunts + AdjacentWorlds as planner inputs
  scanner.ts                   MOD   Branch on TECH_SCOUT_TWO_PASS flag for one vs two pass

src/lib/ai/
  models.ts                    MOD   Add model role: tech_scout_refine

src/__tests__/ (mirrors above)
  lib/types/problem-hunt.test.ts               NEW
  lib/types/adjacent-world.test.ts             NEW
  lib/types/two-pass-state.test.ts             NEW
  pipeline/prompts/tech-scout-skill-remix.test.ts  NEW
  pipeline/prompts/tech-scout-adjacent.test.ts     NEW
  pipeline/prompts/tech-scout-refine.test.ts       NEW
  pipeline/scanners/tech-scout/skill-remix.test.ts NEW
  pipeline/scanners/tech-scout/adjacent-worlds.test.ts NEW
  pipeline/scanners/tech-scout/first-pass-summary.test.ts NEW
  pipeline/scanners/tech-scout/refine-planner.test.ts NEW
  pipeline/scanners/tech-scout/two-pass-orchestrator.test.ts NEW
```

**Why this split:** `scanner.ts` is already 377 lines (of 500 budget). Adding pass-2 logic inline would push it past the cap. Each new module has one LLM call or one pure transform, and can be unit-tested in isolation from the scanner.

---

## Chunk 1: Skill Remix Translator

Turns founder skills into problem-hunts. Instead of searching for literal `"data science"`, the planner searches for `"manual reporting automation"`, `"spreadsheet reconciliation"`, etc. — problems those skills can actually solve.

### Task 1.1: ProblemHunt schema

**Files:**
- Create: `src/lib/types/problem-hunt.ts`
- Test: `src/__tests__/lib/types/problem-hunt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/lib/types/problem-hunt.test.ts
import { describe, it, expect } from 'vitest';
import { PROBLEM_HUNT_SCHEMA, PROBLEM_HUNTS_SCHEMA } from '../../../lib/types/problem-hunt';

describe('PROBLEM_HUNT_SCHEMA', () => {
  it('parses a valid hunt with skill_source, problem, example_search_phrases', () => {
    const parsed = PROBLEM_HUNT_SCHEMA.parse({
      skill_source: 'Python',
      problem: 'manual spreadsheet reconciliation in small accounting firms',
      example_search_phrases: ['spreadsheet reconciliation bugs', 'accountant automation'],
    });
    expect(parsed.problem).toContain('reconciliation');
  });

  it('rejects a hunt missing example_search_phrases', () => {
    expect(() =>
      PROBLEM_HUNT_SCHEMA.parse({ skill_source: 'Python', problem: 'x' }),
    ).toThrow();
  });

  it('rejects an empty example_search_phrases array', () => {
    expect(() =>
      PROBLEM_HUNT_SCHEMA.parse({
        skill_source: 'Python',
        problem: 'x',
        example_search_phrases: [],
      }),
    ).toThrow();
  });
});

describe('PROBLEM_HUNTS_SCHEMA (list)', () => {
  it('requires between 3 and 10 hunts', () => {
    const three = Array.from({ length: 3 }, (_, i) => ({
      skill_source: 'Python',
      problem: `problem ${i}`,
      example_search_phrases: ['a', 'b'],
    }));
    expect(() => PROBLEM_HUNTS_SCHEMA.parse(three)).not.toThrow();
    expect(() => PROBLEM_HUNTS_SCHEMA.parse(three.slice(0, 2))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/__tests__/lib/types/problem-hunt.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the schema**

```typescript
// src/lib/types/problem-hunt.ts
import { z } from 'zod';

/**
 * One functional-decomposition hunt derived from a founder skill. The
 * idea is that a "skill" like "Python" is not a search target by itself;
 * what matters is the CLASS OF PROBLEMS that skill can solve. Each hunt
 * names one such problem plus short search-ready phrases adapters can
 * use directly. Downstream the planner slices these into per-source
 * keyword lists.
 */
export const PROBLEM_HUNT_SCHEMA = z.object({
  skill_source: z.string().min(1),
  problem: z.string().min(5),
  example_search_phrases: z.array(z.string().min(1)).min(1).max(6),
});
export type ProblemHunt = z.infer<typeof PROBLEM_HUNT_SCHEMA>;

/** 3-10 problem hunts per founder. */
export const PROBLEM_HUNTS_SCHEMA = z.array(PROBLEM_HUNT_SCHEMA).min(3).max(10);
export type ProblemHunts = z.infer<typeof PROBLEM_HUNTS_SCHEMA>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/__tests__/lib/types/problem-hunt.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/problem-hunt.ts src/__tests__/lib/types/problem-hunt.test.ts
git commit -m "feat(types): add ProblemHunt schema for skill-remix planner"
```

### Task 1.2: Skill Remix prompt

**Files:**
- Create: `src/pipeline/prompts/tech-scout-skill-remix.ts`
- Test: `src/__tests__/pipeline/prompts/tech-scout-skill-remix.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/pipeline/prompts/tech-scout-skill-remix.test.ts
import { describe, it, expect } from 'vitest';
import {
  SKILL_REMIX_RESPONSE_SCHEMA,
  buildSkillRemixSystemPrompt,
  buildSkillRemixUserPrompt,
} from '../../../pipeline/prompts/tech-scout-skill-remix';
import type { FounderProfile } from '../../../lib/types/founder-profile';

function minProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  return {
    skills: stated(['python', 'nursing']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'healthcare', years: 10 }]),
    insider_knowledge: stated('clinical documentation workflow'),
    anti_targets: stated([]),
    network: stated(''),
    audience: stated(''),
    proprietary_access: stated(''),
    rare_combinations: stated(''),
    recurring_frustration: stated(''),
    four_week_mvp: stated(''),
    previous_attempts: stated(''),
    customer_affinity: stated(''),
    time_to_revenue: stated('no_preference'),
    customer_type_preference: stated('no_preference'),
    trigger: stated(''),
    legal_constraints: stated(''),
    divergence_level: stated('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'abc',
  };
}

describe('SKILL_REMIX_RESPONSE_SCHEMA', () => {
  it('parses a valid response with 3 hunts', () => {
    const parsed = SKILL_REMIX_RESPONSE_SCHEMA.parse({
      hunts: [
        { skill_source: 'Python', problem: 'manual charting', example_search_phrases: ['automated clinical note'] },
        { skill_source: 'Python', problem: 'scheduling bugs', example_search_phrases: ['shift scheduling optimization'] },
        { skill_source: 'nursing', problem: 'handoff errors', example_search_phrases: ['clinical handoff safety'] },
      ],
    });
    expect(parsed.hunts).toHaveLength(3);
  });

  it('rejects a response with fewer than 3 hunts', () => {
    expect(() => SKILL_REMIX_RESPONSE_SCHEMA.parse({ hunts: [] })).toThrow();
  });
});

describe('buildSkillRemixSystemPrompt', () => {
  it('instructs the LLM to translate skills into problems, not keywords', () => {
    const p = buildSkillRemixSystemPrompt();
    expect(p.toLowerCase()).toContain('problem');
    expect(p.toLowerCase()).toContain('skill');
    expect(p.toLowerCase()).toContain('functional decomposition');
  });

  it('embeds a scenario marker when one is provided (for MSW routing)', () => {
    expect(buildSkillRemixSystemPrompt('remix-alice')).toContain('[[SCENARIO:remix-alice]]');
  });
});

describe('buildSkillRemixUserPrompt', () => {
  it('serializes the founder skills and domain into the prompt', () => {
    const u = buildSkillRemixUserPrompt(minProfile());
    expect(u).toContain('python');
    expect(u).toContain('healthcare');
    expect(u).toContain('clinical documentation workflow');
  });
});
```

- [ ] **Step 2: Verify it fails** — Run and expect module-not-found.

- [ ] **Step 3: Implement the prompt module**

```typescript
// src/pipeline/prompts/tech-scout-skill-remix.ts
import { z } from 'zod';
import { PROBLEM_HUNTS_SCHEMA } from '../../lib/types/problem-hunt';
import type { FounderProfile } from '../../lib/types/founder-profile';

/** LLM response: wrapped `hunts` array because generateObject needs a root object. */
export const SKILL_REMIX_RESPONSE_SCHEMA = z.object({
  hunts: PROBLEM_HUNTS_SCHEMA,
});
export type SkillRemixResponse = z.infer<typeof SKILL_REMIX_RESPONSE_SCHEMA>;

/**
 * System prompt instructing the LLM to perform functional decomposition
 * on founder skills: "Python" is not a search target, "manual
 * reconciliation in small accounting firms" is. Each problem must be
 * specific enough that a search engine can find real complaints about it.
 */
export function buildSkillRemixSystemPrompt(scenario?: string): string {
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  return `${marker}You are a problem-hunt generator for a Tech Scout agent. Apply FUNCTIONAL DECOMPOSITION to the founder's skills and domain: for each skill, identify 1-2 concrete CLASSES OF PROBLEMS that skill can solve, phrased specifically enough that search engines can find real discussions of them.

PRINCIPLES:
- A skill (e.g. "Python", "nursing") is NEVER a problem. It is a capability.
- A problem is a concrete pain: "manual charting steals 90 minutes per nurse per shift".
- Prefer problems with a clear audience ("small accounting firms", "rural home-health agencies") over abstract ones ("data work is hard").
- Ground problems in the founder's domain and insider knowledge wherever possible.
- Return 3-10 hunts total. Each hunt must include 1-6 example_search_phrases that could be run verbatim against HN, arXiv, or GitHub.

Output must match the provided JSON schema exactly.`;
}

/** Serializes the founder profile fields that inform skill-remix. */
export function buildSkillRemixUserPrompt(profile: FounderProfile): string {
  const skills = profile.skills.value.join(', ') || '(none stated)';
  const domains = profile.domain.value.map((d) => d.area).join(', ') || '(none stated)';
  const insider = profile.insider_knowledge.value || '(none)';
  const notes = profile.additional_context_raw || '(none)';
  return `Founder skills: ${skills}
Founder domain(s): ${domains}
Insider knowledge: ${insider}
Additional context: ${notes}

Produce the problem hunts as a JSON object matching the schema.`;
}
```

- [ ] **Step 4: Run test to verify passes** — 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/prompts/tech-scout-skill-remix.ts src/__tests__/pipeline/prompts/tech-scout-skill-remix.test.ts
git commit -m "feat(prompts): add skill-remix prompt for functional decomposition of founder skills"
```

### Task 1.3: Skill Remix module (LLM call)

**Files:**
- Create: `src/pipeline/scanners/tech-scout/skill-remix.ts`
- Test: `src/__tests__/pipeline/scanners/tech-scout/skill-remix.test.ts`
- Modify: `src/lib/ai/models.ts` (add `tech_scout_skill_remix` role — or reuse `tech_scout`)

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/pipeline/scanners/tech-scout/skill-remix.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { generateProblemHunts } from '../../../../pipeline/scanners/tech-scout/skill-remix';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
// import minProfile helper shared from skill-remix prompt test

describe('generateProblemHunts', () => {
  afterEach(() => resetOpenAIMock());

  it('returns ok with the LLM-produced hunts on success', async () => {
    setOpenAIResponse('remix-ok', {
      content: JSON.stringify({
        hunts: [
          { skill_source: 'Python', problem: 'p1', example_search_phrases: ['s1'] },
          { skill_source: 'Python', problem: 'p2', example_search_phrases: ['s2'] },
          { skill_source: 'nursing', problem: 'p3', example_search_phrases: ['s3'] },
        ],
      }),
    });
    const result = await generateProblemHunts(minProfile(), { scenario: 'remix-ok' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
  });

  it('returns err when schema validation fails', async () => {
    // Default MSW fallback returns ideas:[] which doesn't match the hunts schema.
    const result = await generateProblemHunts(minProfile(), { scenario: 'remix-bogus' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['llm_failed', 'schema_invalid']).toContain(result.error.kind);
  });
});
```

- [ ] **Step 2: Verify failure** — module not found.

- [ ] **Step 3: Implement the module**

```typescript
// src/pipeline/scanners/tech-scout/skill-remix.ts
import { generateObject } from 'ai';
import { ok, err, type Result } from '../../../lib/utils/result';
import { models } from '../../../lib/ai/models';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { ProblemHunts } from '../../../lib/types/problem-hunt';
import {
  SKILL_REMIX_RESPONSE_SCHEMA,
  buildSkillRemixSystemPrompt,
  buildSkillRemixUserPrompt,
} from '../../prompts/tech-scout-skill-remix';

export type RemixError =
  | { kind: 'llm_failed'; message: string }
  | { kind: 'schema_invalid'; message: string };

/**
 * Translate the founder profile into problem hunts via one LLM call.
 * Never throws; returns err on any failure so the scanner can fall back
 * to the directive keywords if remix is unavailable.
 */
export async function generateProblemHunts(
  profile: FounderProfile,
  options: { scenario?: string } = {},
): Promise<Result<ProblemHunts, RemixError>> {
  try {
    const { object } = await generateObject({
      model: models.tech_scout,
      schema: SKILL_REMIX_RESPONSE_SCHEMA,
      system: buildSkillRemixSystemPrompt(options.scenario),
      prompt: buildSkillRemixUserPrompt(profile),
    });
    return ok(object.hunts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = /schema|validation/i.test(msg) ? 'schema_invalid' : 'llm_failed';
    return err({ kind, message: msg });
  }
}
```

- [ ] **Step 4: Verify passes** — 2/2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/scanners/tech-scout/skill-remix.ts src/__tests__/pipeline/scanners/tech-scout/skill-remix.test.ts
git commit -m "feat(tech-scout): add skill-remix LLM module (founder → problem hunts)"
```

### Task 1.4: Integrate problem hunts into query-planner

Update `planQueries` to accept optional `problem_hunts` and pass them to the expansion LLM as additional context. The existing per-source keyword output is unchanged; the new context just makes the output smarter.

**Files:**
- Modify: `src/pipeline/prompts/tech-scout-expansion.ts` (new optional param in user prompt)
- Modify: `src/pipeline/scanners/tech-scout/query-planner.ts` (thread hunts through)
- Test: append to `src/__tests__/pipeline/prompts/tech-scout-expansion.test.ts`

- [ ] **Step 1: Write the failing test (prompt-level)**

```typescript
// append to src/__tests__/pipeline/prompts/tech-scout-expansion.test.ts
describe('buildExpansionUserPrompt — with problem hunts', () => {
  it('serializes problem_hunts into the prompt when provided', () => {
    const out = buildExpansionUserPrompt(directive, profile, {
      problem_hunts: [
        { skill_source: 'Python', problem: 'manual charting', example_search_phrases: ['clinical note nlp'] },
      ],
    });
    expect(out).toContain('Problem hunts:');
    expect(out).toContain('manual charting');
    expect(out).toContain('clinical note nlp');
  });

  it('omits the Problem hunts section when no hunts are provided', () => {
    const out = buildExpansionUserPrompt(directive, profile);
    expect(out).not.toContain('Problem hunts:');
  });
});
```

- [ ] **Step 2: Verify failure** — "undefined property 'problem_hunts'".

- [ ] **Step 3: Implement in tech-scout-expansion.ts**

```typescript
// tech-scout-expansion.ts — updated signature
export function buildExpansionUserPrompt(
  directive: ScannerDirectives['tech_scout'],
  profile: FounderProfile,
  extra?: { problem_hunts?: ProblemHunts },
): string {
  // ...existing lines...
  const huntsBlock = extra?.problem_hunts?.length
    ? `\nProblem hunts (prefer phrases here over directive keywords for specificity):\n${extra.problem_hunts
        .map(
          (h) =>
            `- [${h.skill_source}] ${h.problem} → ${h.example_search_phrases.join('; ')}`,
        )
        .join('\n')}\n`
    : '';
  return `Directive keywords: ${directive.keywords.join(', ')}
Directive exclude (NEVER include in expanded_keywords): ${excludeList}
Directive notes: ${directive.notes || '(none)'}
Directive timeframe: ${directive.timeframe}

Founder skills: ${skills}
Founder domain(s): ${domains || '(none stated)'}
${huntsBlock}
Produce the expanded query plan as a JSON object matching the schema.`;
}
```

Also add a sentence to `buildExpansionSystemPrompt` under a new section "PROBLEM HUNTS" instructing the LLM to treat hunts as higher-priority inputs than bare directive keywords.

- [ ] **Step 4: Verify prompt tests pass (2/2 new).**

- [ ] **Step 5: Thread hunts through `planQueries`**

```typescript
// query-planner.ts — add optional remix input
export type PlannerOptions = {
  clock?: () => Date;
  scenario?: string;
  problem_hunts?: ProblemHunts;  // NEW
};

// inside planQueries:
const { object } = await generateObject({
  model: models.tech_scout,
  schema: EXPANSION_RESPONSE_SCHEMA,
  system: buildExpansionSystemPrompt(options.scenario),
  prompt: buildExpansionUserPrompt(directive, profile, {
    problem_hunts: options.problem_hunts,
  }),
});
```

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/prompts/tech-scout-expansion.ts src/pipeline/scanners/tech-scout/query-planner.ts src/__tests__/pipeline/prompts/tech-scout-expansion.test.ts
git commit -m "feat(tech-scout): thread problem hunts through the expansion planner"
```

### Task 1.5: Wire skill-remix into the scanner (behind a flag)

**Files:**
- Modify: `src/pipeline/scanners/tech-scout/scanner.ts`
- Test: append to `src/__tests__/pipeline/scanners/tech-scout/scanner-signal-quality.test.ts` (or a new file if preferred)

- [ ] **Step 1: Write the failing integration test**

Test that, with `deps.features?.skill_remix === true`, the scanner calls `generateProblemHunts` and threads the result into the expansion planner. Mock both LLM calls via MSW scenarios.

- [ ] **Step 2-4: Implement in `runTechScout`**

```typescript
// scanner.ts — resolvePlan gains a problem-hunts step
async function resolvePlan(directive, profile, deps, warnings) {
  let problem_hunts: ProblemHunts | undefined;
  if (deps.features?.skill_remix) {
    const remix = await generateProblemHunts(profile, {
      scenario: deps.scenarios?.skill_remix,
    });
    if (remix.ok) problem_hunts = remix.value;
    else warnings.push(`skill_remix_fallback: ${remix.error.kind}`);
  }
  const result = await llmPlanQueries(directive, profile, {
    clock: deps.clock,
    scenario: deps.scenarios?.expansion,
    problem_hunts,
  });
  // ... existing fallback branch unchanged
}
```

Add `features?: { skill_remix?: boolean; ... }` and `scenarios.skill_remix?: string` to `ScannerDeps` in `src/pipeline/scanners/types.ts`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tech-scout): wire skill-remix behind ScannerDeps.features.skill_remix flag"
```

---

## Chunk 2: Adjacent World Mapper

Generate structurally adjacent industries for the founder's domain, with each adjacency tagged by the structural trait shared with the source domain. Without the structural-trait guard, the LLM will drift (same failure mode as bug 3).

### Task 2.1: AdjacentWorld schema

**Files:**
- Create: `src/lib/types/adjacent-world.ts`
- Test: `src/__tests__/lib/types/adjacent-world.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('ADJACENT_WORLD_SCHEMA', () => {
  it('parses a valid world with shared_traits and example queries', () => {
    const parsed = ADJACENT_WORLD_SCHEMA.parse({
      source_domain: 'nursing',
      adjacent_domain: 'aviation',
      shared_traits: ['safety-critical checklists', 'fatigue management'],
      example_search_phrases: ['aviation checklist digitization'],
    });
    expect(parsed.shared_traits).toHaveLength(2);
  });

  it('rejects a world with zero shared_traits (prevents random adjacency)', () => {
    expect(() =>
      ADJACENT_WORLD_SCHEMA.parse({
        source_domain: 'nursing',
        adjacent_domain: 'aviation',
        shared_traits: [],
        example_search_phrases: ['x'],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement**

```typescript
// src/lib/types/adjacent-world.ts
import { z } from 'zod';

/**
 * One adjacent world for analogical transfer. The key constraint is
 * `shared_traits`: at least one concrete structural trait the adjacent
 * domain shares with the founder's source domain. This is the guard that
 * prevents the LLM from drifting to random industries (see tech-scout
 * expansion drift of 2026-04-12 for the precedent).
 */
export const ADJACENT_WORLD_SCHEMA = z.object({
  source_domain: z.string().min(1),
  adjacent_domain: z.string().min(1),
  shared_traits: z.array(z.string().min(1)).min(1).max(5),
  example_search_phrases: z.array(z.string().min(1)).min(1).max(5),
});
export type AdjacentWorld = z.infer<typeof ADJACENT_WORLD_SCHEMA>;

export const ADJACENT_WORLDS_SCHEMA = z.array(ADJACENT_WORLD_SCHEMA).min(2).max(6);
export type AdjacentWorlds = z.infer<typeof ADJACENT_WORLDS_SCHEMA>;
```

- [ ] **Step 4: Verify passes.**

- [ ] **Step 5: Commit.**

### Task 2.2: Adjacent-world prompt

**Files:**
- Create: `src/pipeline/prompts/tech-scout-adjacent.ts`
- Test: `src/__tests__/pipeline/prompts/tech-scout-adjacent.test.ts`

Pattern mirrors Task 1.2. Key prompt rules to encode:

1. **Every adjacency MUST cite at least one structural trait** the adjacent world shares with the source domain. No trait → drop the world.
2. **No random jumps.** "Aviation" is adjacent to "nursing" via *safety-critical checklists + fatigue management*. "Film industry" is not adjacent unless you can name a trait.
3. **Prefer low-overlap worlds** — different labels, same structure. "Hospital" and "clinic" share too much; the point is to find worlds a human wouldn't try.
4. **Output 2-6 worlds.** Fewer than 2 means the LLM couldn't find solid adjacencies — that's fine.

- [ ] Red → green → refactor per the TDD rhythm.
- [ ] Commit: `feat(prompts): add adjacent-world prompt with structural-trait guard`

### Task 2.3: Adjacent-world LLM module

**Files:**
- Create: `src/pipeline/scanners/tech-scout/adjacent-worlds.ts`
- Test: `src/__tests__/pipeline/scanners/tech-scout/adjacent-worlds.test.ts`

Mirrors Task 1.3: one `generateObject` call, `Result<AdjacentWorlds, AdjacencyError>`, fallback to empty list on failure (scanner continues).

- [ ] Tests: happy path, schema-invalid fallback, prompt contains shared_traits requirement.
- [ ] Implement with the same structure as `skill-remix.ts`.
- [ ] Commit.

### Task 2.4: Thread adjacent worlds through query-planner

Same pattern as Task 1.4: extend `buildExpansionUserPrompt` signature with `extra?.adjacent_worlds`, add a system-prompt section telling the LLM "Generate at least 2 keywords per adjacent world", thread through `PlannerOptions`.

The system prompt should encourage **one keyword per shared_trait**: if the nurse ↔ aviation world shares "safety-critical checklists", emit `"aviation checklist digitization"` in `hn_keywords` and `"safety-critical checklist NLP"` in `arxiv_keywords`.

- [ ] TDD cycle, then commit.

### Task 2.5: Wire adjacent-worlds into the scanner

Mirror Task 1.5. New feature flag `deps.features?.adjacent_worlds`. Parallel with skill_remix in `resolvePlan` (they're independent LLM calls):

```typescript
const [remix, worlds] = await Promise.all([
  deps.features?.skill_remix ? generateProblemHunts(...) : Promise.resolve(null),
  deps.features?.adjacent_worlds ? generateAdjacentWorlds(...) : Promise.resolve(null),
]);
```

- [ ] Integration test: run with both flags on, verify the expansion prompt receives both pieces of context.
- [ ] Commit: `feat(tech-scout): run skill-remix and adjacent-worlds in parallel via ScannerDeps.features`

---

## Chunk 3: Two-Pass Loop

Pass 1 runs the existing planner+adapters+enricher+post-process pipeline. Between passes, the first-pass summarizer produces a structured report of what was found. A new LLM call reads that summary and emits a refined `ExpandedQueryPlan` that double-downs on sparse-but-real directions and abandons dead ends. Pass 2 runs with that refined plan. Finally the two passes are merged.

### Task 3.1: FirstPassSummary schema

**Files:**
- Create: `src/lib/types/two-pass-state.ts`
- Test: `src/__tests__/lib/types/two-pass-state.test.ts`

The summary captures:
- `queries_run`: per-source query label + result count
- `dense_directions`: labels that returned ≥ `density_threshold` signals
- `sparse_directions`: labels that returned 1-2 signals (gap opportunities)
- `empty_queries`: labels that returned zero — **the absence-as-signal channel**
- `top_signal_summary`: top 5 enriched titles + relevance/recency scores per source
- `exhausted_terms`: keywords the pass-2 planner should NOT reuse

```typescript
export const FIRST_PASS_SUMMARY_SCHEMA = z.object({
  queries_run: z.array(z.object({
    source: z.string(),
    label: z.string(),
    result_count: z.number().int().min(0),
  })),
  dense_directions: z.array(z.string()),
  sparse_directions: z.array(z.string()),
  empty_queries: z.array(z.string()),
  top_signal_summary: z.array(z.object({
    source: z.string(),
    title: z.string(),
    relevance: z.number(),
    recency: z.number(),
  })).max(15),
  exhausted_terms: z.array(z.string()),
});
```

- [ ] TDD cycle: tests for each field required, reject missing fields.
- [ ] Commit.

### Task 3.2: First-pass summarizer (pure)

**Files:**
- Create: `src/pipeline/scanners/tech-scout/first-pass-summary.ts`
- Test: `src/__tests__/pipeline/scanners/tech-scout/first-pass-summary.test.ts`

Pure function, no LLM. Reads `AdapterOutcome[]`, `prefilter` result, and `enrichment.signals`, produces a `FirstPassSummary`.

Key logic:
- `empty_queries` = union of every SourceReport's `queries_with_zero_results`
- `dense_directions` = SourceReport labels with `signals_count >= 5`
- `sparse_directions` = labels with `signals_count >= 1 && < 5`
- `top_signal_summary` = top 5 enriched signals by composite score, per source
- `exhausted_terms` = all keywords that appeared in queries with `signals_count >= 10` (saturated — no point re-searching)

- [ ] **TDD cycle:**
  - Tests for each branch: dense/sparse/empty classification
  - Test for `top_signal_summary` ordering and per-source cap
  - Regression test using fixture data matching the 2026-04-12 production run
- [ ] Commit: `feat(tech-scout): add first-pass summarizer for two-pass refinement`

### Task 3.3: Refinement prompt

**Files:**
- Create: `src/pipeline/prompts/tech-scout-refine.ts`
- Test: `src/__tests__/pipeline/prompts/tech-scout-refine.test.ts`

The refinement LLM consumes a `FirstPassSummary` + the original founder context and emits a NEW `ExpandedQueryPlan` scoped for pass 2. Key rules in the system prompt:

1. **Do NOT reuse any query in `exhausted_terms`** — they already saturated.
2. **Double-down on `sparse_directions`** — these are gap opportunities. Generate 2-3 variants per sparse label.
3. **Respect `empty_queries` as absence signals** — if a direction was empty, the keyword was wrong OR the gap is real. Generate ONE rephrasing for each empty query in case it was a wording issue.
4. **Prefer keywords referencing high-relevance top-signals** — if pass 1 found a 9/10 relevance paper on "clinical NLP", pass 2 should search related angles.
5. Same per-source divergence + acronym-preservation rules as pass 1.

Reuse `EXPANSION_RESPONSE_SCHEMA` for the response — pass 2 output is the same shape as pass 1.

- [ ] TDD cycle, commit.

### Task 3.4: Refinement planner module

**Files:**
- Create: `src/pipeline/scanners/tech-scout/refine-planner.ts`
- Test: `src/__tests__/pipeline/scanners/tech-scout/refine-planner.test.ts`

One LLM call, same shape as `query-planner.ts`:
- Input: `FirstPassSummary`, `FounderProfile`, `ScannerDirectives['tech_scout']`
- Output: `Result<ExpandedQueryPlan, PlannerError>`
- Apply `enforceAcronymPreservation` and `demoteGenericKeywords` on the response (extract both from query-planner.ts into a shared helper if they're still inline after Task 1.4; DRY is required by CLAUDE.md).

- [ ] **TDD cycle**, including a test that the refine planner respects `exhausted_terms` (refuses to reuse them even if the LLM does).
- [ ] Commit.

### Task 3.5: Two-pass orchestrator

**Files:**
- Create: `src/pipeline/scanners/tech-scout/two-pass-orchestrator.ts`
- Test: `src/__tests__/pipeline/scanners/tech-scout/two-pass-orchestrator.test.ts`

This module is where the flow is assembled. Responsibilities:

1. Run pass 1: plan → adapters → prefilter → enrich
2. Summarize pass 1 via `summarizeFirstPass`
3. If summary has fewer than `SUMMARY_INTERESTING_THRESHOLD` dense/sparse directions, **skip pass 2** — nothing to refine
4. Otherwise, call `refinePlan(summary, profile, directive)` → new `ExpandedQueryPlan`
5. Run pass 2: same adapters → prefilter → enrich, but using the refined plan
6. Merge: dedupe signals across passes by URL, interleave by source, apply quality floor, top-N
7. Return a `ScannerReport` that includes BOTH passes' expansion plans and a `two_pass_meta` field with the summary

**Do NOT put this logic in `scanner.ts`.** The orchestrator owns it. `scanner.ts` decides whether to call `runOnePass` or `runTwoPass` based on `deps.features?.two_pass`.

- [ ] **Tests:**
  - Two-pass happy path (mocks both LLM expansion calls + enrichment)
  - Skip-pass-2 when pass 1 has no refinement signal
  - Pass-2 LLM failure → degrade gracefully to pass-1-only result, warning attached
  - Dedup across passes when the same URL appears in both
  - Quality floor + timeframe filter still enforced after merge
  - Regression: feed it the 2026-04-12 fixture and assert pass 2 refines toward `sparse_directions`
- [ ] Commit.

### Task 3.6: Scanner integration

**Files:**
- Modify: `src/pipeline/scanners/tech-scout/scanner.ts`
- Modify: `src/pipeline/scanners/types.ts` (add `features.two_pass`)

- [ ] **Step 1: Failing test**

```typescript
it('runs two-pass when deps.features.two_pass === true', async () => {
  // Assert the scanner calls into the orchestrator, not runOnePass.
});

it('runs single-pass when deps.features.two_pass is undefined', async () => {
  // Default behavior: unchanged from v1.
});
```

- [ ] **Step 2: Implementation**

Extract the existing runTechScout body into `runSinglePass(directive, profile, narrativeProse, deps)`. Add a top-level branch:

```typescript
export const runTechScout: Scanner = async (directive, profile, narrativeProse, deps) => {
  if (deps.features?.two_pass) {
    return runTwoPass(directive, profile, narrativeProse, deps);
  }
  return runSinglePass(directive, profile, narrativeProse, deps);
};
```

This keeps `scanner.ts` under its line budget by moving the heavy lifting into the orchestrator module.

- [ ] **Step 3: Verify all existing scanner tests still pass** (when we fix the pre-existing schema-drift breakage separately).
- [ ] Commit: `feat(tech-scout): branch between one-pass and two-pass via features.two_pass flag`

### Task 3.7: End-to-end smoke test for two-pass

**Files:**
- Create: `src/__tests__/e2e/tech-scout-two-pass-smoke.test.ts`

- [ ] One test that runs the full frame → tech_scout(two_pass=true) pipeline with all LLM calls mocked, and asserts:
  - Both expansion calls happened (use MSW scenario counters)
  - Final signals contain URLs from both passes
  - The ScannerReport has both expansion_plan fields populated
  - Warnings include any intentional fallbacks
- [ ] Commit.

---

## Integration & Rollout

### Task 4.1: Debug UI surfacing

**Files:**
- Modify: `src/components/debug/scanner-report-view.tsx`

When `two_pass_meta` is present on the report, render:
- A collapsible section showing pass 1 vs pass 2 expansion plans side-by-side
- The first-pass summary (dense/sparse/empty lists)
- Per-pass signal counts

- [ ] Test with the existing scanner-report-view test file.
- [ ] Commit.

### Task 4.2: Feature flag wiring in /debug/frame page

**Files:**
- Modify: `src/app/debug/frame/page.tsx` (or wherever tech-scout is triggered)
- Modify: the API route that posts to the scanner

Add three checkboxes: `skill_remix`, `adjacent_worlds`, `two_pass`. Default all to OFF so existing behavior is unchanged.

- [ ] Test: simulate toggling each flag and verify the backend receives it.
- [ ] Commit.

### Task 4.3: Manual verification on the 2026-04-12 fixture

- [ ] Run the scanner with all three flags OFF → confirm signals match current v1 behavior.
- [ ] Run with `skill_remix=true` only → verify queries reference problem-hunt phrases (e.g. `"manual reconciliation"` not `"data science"`).
- [ ] Run with `adjacent_worlds=true` only → verify at least one adjacency query is emitted and carries its structural trait in the label.
- [ ] Run with `two_pass=true` (with both others on) → verify the report shows two expansion plans and pass 2 references sparse directions from pass 1.
- [ ] Document the before/after signal quality in a short comment on this plan file.

### Task 4.4: Docs update

**Files:**
- Modify: `docs/architecture.md` — add a short note that tech-scout now has a two-pass variant behind a feature flag.
- Modify: `docs/tech-scout-sources.md` — add skill-remix / adjacent-world modules to the pipeline diagram.

- [ ] Commit.

---

## Review & Acceptance

Before marking this plan complete:

- [ ] All new unit tests pass.
- [ ] No new regressions in the pre-existing failing tests (record the count at start: 15 files, 67 tests failing due to v1→v2 schema drift).
- [ ] `npx tsc --noEmit` clean for every file touched.
- [ ] Running the 2026-04-12 fixture with `two_pass=true` produces:
  - Zero 2023-2024 arXiv papers (timeframe + quality floor from the bug-fix pass)
  - At least 5 signals referencing problem-hunt phrases or adjacent-world queries
  - Pass-2 expansion plan visibly different from pass-1 (no identical keywords)
  - Aggregate cost under $0.25 per run (two expansion calls + two enrichment calls + skill-remix + adjacent-worlds ≈ 6 LLM calls)

If acceptance fails on cost: reduce pass-2 enrichment `topN` or gate pass 2 behind "pass 1 found <5 high-relevance signals" so refinement only kicks in when actually needed.

---

## Notes / Out of Scope

- **The 67 pre-existing failing tests from the v1→v2 schema migration are NOT part of this plan.** They should be repaired in a separate commit before this plan starts, so the green baseline is reliable.
- **Reddit / Quora / patent-database scanners** are deliberately out of scope — this plan only improves the existing three adapters. The same three modules (skill-remix, adjacent-worlds, refine) will transfer cleanly to new scanners once those exist.
- **Profile-specificity guard** (the safety net we discussed for hallucination drift) is already implemented via `enforceAcronymPreservation` for the MCP case. If a broader version is needed (for multi-word domain tokens), file it as a follow-up — it is not required for this plan.
- **Empty-query tracker as a full absence-as-signal feature** partially lives in `first-pass-summary.ts` via `empty_queries`, but a standalone cross-run tracker ("this keyword was empty last 3 runs, stop trying") is a future upgrade.
