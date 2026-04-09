import { z } from 'zod';
import { generateText } from 'ai';
import { models } from '../../../../lib/ai/models';
import { getQuestionById } from '../../../../pipeline/frame/questions';
import { buildFieldHelpPrompt } from '../../../../pipeline/prompts/frame-field-help';
import { RateLimiter } from '../../../../lib/utils/rate-limit';

/**
 * Request body schema for the field-help assist. `scenario` is test-only
 * and passed through to the MSW mock; production clients should omit it.
 */
const REQUEST_SCHEMA = z.object({
  questionId: z.string().min(1),
  userMessage: z.string().min(1).max(1000),
  currentInput: z.record(z.string(), z.unknown()),
  sessionId: z.string().min(1).max(100),
  scenario: z.string().optional(),
});

type FieldHelpRequest = z.infer<typeof REQUEST_SCHEMA>;

/** Shared per-session limiter: 10 requests per 10-minute window. */
const limiter = new RateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 10 });

/** Parse the body, returning undefined on parse failure. */
async function parseJsonBody(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Validate a parsed body against REQUEST_SCHEMA; on failure return a 400 Response. */
function validateBody(
  body: unknown,
): { ok: true; parsed: FieldHelpRequest } | { ok: false; response: Response } {
  const parsed = REQUEST_SCHEMA.safeParse(body);
  if (parsed.success) return { ok: true, parsed: parsed.data };
  return {
    ok: false,
    response: Response.json(
      { error: 'invalid_input', issues: parsed.error.flatten() },
      { status: 400 },
    ),
  };
}

/**
 * Check the rate limit for the session, returning a 429 Response if the
 * caller has exceeded the quota or undefined if they're still within it.
 */
function checkLimit(sessionId: string): Response | undefined {
  const decision = limiter.check(sessionId);
  if (decision.allowed) return undefined;
  return Response.json(
    { error: 'rate_limited', retry_after_ms: decision.retryAfterMs },
    { status: 429 },
  );
}

/** Call the LLM with the field-help prompt pair, surfacing errors as 500. */
async function callLLM(system: string, user: string): Promise<Response> {
  try {
    const { text } = await generateText({
      model: models.frame,
      system,
      prompt: user,
    });
    return Response.json({ message: text }, { status: 200 });
  } catch (e) {
    console.error('[frame/field-help] llm_failed', e instanceof Error ? e.message : String(e));
    return Response.json({ error: 'llm_failed' }, { status: 500 });
  }
}

/**
 * POST /api/frame/field-help — chat assist for filling a single Frame field.
 * Expects { questionId, userMessage, currentInput, sessionId }; returns
 * { message } on success, a typed error object on failure, or 429 when
 * the sessionId has used its quota within the current window.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await parseJsonBody(request);
  if (raw === undefined) {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const validation = validateBody(raw);
  if (!validation.ok) return validation.response;
  const { questionId, userMessage, currentInput, sessionId, scenario } = validation.parsed;
  const question = getQuestionById(questionId);
  if (!question) {
    return Response.json({ error: 'unknown_field' }, { status: 400 });
  }
  const limited = checkLimit(sessionId);
  if (limited) return limited;
  const { system, user } = buildFieldHelpPrompt(question, userMessage, currentInput, scenario);
  return callLLM(system, user);
}

/**
 * Test-only: wipe the rate limiter state between tests so per-session
 * quotas do not leak across describe/it blocks.
 */
export function __resetFieldHelpForTest(): void {
  limiter.reset();
}
