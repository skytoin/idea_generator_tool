# Idea Generation Pipeline

## What This Is
Multi-step AI pipeline that generates, filters, and ranks startup ideas.
TypeScript + Next.js 15 + Vercel AI SDK + Vitest.

## Architecture
8-step pipeline: Frame → Scan (parallel) → Aggregate → Generate (parallel)
→ Novelty Check → Critique → Synthesize → Rank + Diversity Audit.
See @docs/architecture.md for full diagram.

## Commands
- `npm run dev` — local dev server
- `npm test` — run Vitest
- `npm run test:watch` — watch mode
- `npm run typecheck` — tsc --noEmit
- `npm run lint` — ESLint
- `npm run format` — Prettier write
- `npm run frame:dry-run -- <fixture>` — Frame layer manual inspection

## Pipeline Progress
- **Layer 1 (Frame)**: complete. Inspect via `npm run frame:dry-run -- <fixture>` or visit `/debug/frame`.

## Code Rules — IMPORTANT
- Files MUST be under 500 lines. Split if approaching limit.
- Functions MUST be under 30 lines. Extract helpers if longer.
- Every function gets a JSDoc comment explaining what it does.
- Use Zod schemas for ALL data flowing between pipeline steps.
- Use named exports only, never default exports.
- Error handling: use Result<T, E> pattern, never throw in pipeline code.
- All async operations must have explicit error handling.

## Testing — YOU MUST follow this
- Write tests BEFORE or ALONGSIDE implementation, never after.
- Every pipeline step must have tests covering: happy path, error cases, edge cases.
- Test file mirrors source: src/pipeline/steps/04-generate.ts → src/__tests__/pipeline/steps/04-generate.test.ts
- Use MSW for mocking HTTP/API calls. NEVER mock fetch directly.
- Run `npm test` after implementing any pipeline step. Do not proceed if tests fail.

## File Naming
- kebab-case for all files: tech-scout.ts, not techScout.ts
- Types/schemas: src/lib/types/[domain].ts
- Prompts: src/pipeline/prompts/[step-name].ts

## Vercel AI SDK Usage — Multi-Model Architecture
- Providers installed: @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google, @ai-sdk/deepseek
- Use generateText() for pipeline steps, streamText() for UI streaming
- Use generateObject() with Zod schemas for structured outputs
- Model selection is per-step — different generators use different providers for diversity
- Model config lives in src/lib/ai/models.ts — NEVER hardcode model strings in step files
- Switch providers by changing the model reference, not rewriting logic

## Git
- Conventional commits: feat:, fix:, test:, refactor:, docs:
- One logical change per commit
- Never commit .env files or API keys
