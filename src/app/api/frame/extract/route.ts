import { FRAME_INPUT_SCHEMA, type FrameInput } from '../../../../lib/types/frame-input';
import { runFrame, type FrameDeps, type FrameError } from '../../../../pipeline/steps/00-frame';
import { InMemoryKVStore } from '../../../../lib/utils/kv-store';

/**
 * Module-scoped KV singleton so successive requests in the same dev
 * process share persistence. Tests reset this via __resetKVForTest.
 */
const kv = new InMemoryKVStore();

type Scenarios = NonNullable<FrameDeps['scenarios']>;

/**
 * Parse the body of a request as JSON, returning undefined on failure.
 * Returning undefined lets the caller respond with a 400 invalid_json.
 */
async function parseJsonBody(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * Remove `additional_context_raw` from any object before it hits a log.
 * The user pastes free-form text into that field which may contain PII,
 * so we never surface it in error payloads or server logs.
 */
function redactContext(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const { additional_context_raw: _raw, ...rest } = obj as Record<string, unknown>;
  void _raw;
  return rest;
}

/** Decode the x-test-scenarios header into a FrameDeps scenarios map. */
function readTestScenarios(request: Request): Scenarios | undefined {
  const header = request.headers.get('x-test-scenarios');
  if (!header) return undefined;
  try {
    return JSON.parse(header) as Scenarios;
  } catch {
    return undefined;
  }
}

/**
 * Validate a parsed body against the FrameInput schema. Returns either
 * the parsed input or a 400 Response ready to return to the caller.
 */
function validateFrameInput(body: unknown): { ok: true; input: FrameInput } | { ok: false; response: Response } {
  const parsed = FRAME_INPUT_SCHEMA.safeParse(body);
  if (parsed.success) return { ok: true, input: parsed.data };
  return {
    ok: false,
    response: Response.json(
      { error: 'invalid_input', issues: parsed.error.flatten() },
      { status: 400 },
    ),
  };
}

/** Log a redacted error payload without leaking raw user context. */
function logFrameError(frameError: FrameError, body: unknown): void {
  console.error('[frame/extract]', frameError.kind, 'input=', redactContext(body));
}

/**
 * Convert a FrameError into a 500 Response. We only surface the kind
 * and a generic message — never the internal error stack.
 */
function errorResponse(frameError: FrameError): Response {
  return Response.json(
    { error: frameError.kind, message: 'frame pipeline failed' },
    { status: 500 },
  );
}

/**
 * POST /api/frame/extract — run the Frame layer on a FrameInput body and
 * return the resulting FrameOutput. Recognized test-only headers:
 *   x-test-scenarios  JSON like {extract, narrative, directives} routed to
 *                      the MSW mock. Production clients never send this.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await parseJsonBody(request);
  if (body === undefined) {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const validation = validateFrameInput(body);
  if (!validation.ok) return validation.response;
  const deps: FrameDeps = {
    clock: () => new Date(),
    kv,
    scenarios: readTestScenarios(request),
  };
  const result = await runFrame(validation.input, deps);
  if (!result.ok) {
    logFrameError(result.error, body);
    return errorResponse(result.error);
  }
  return Response.json(result.value, { status: 200 });
}

/**
 * Test-only: clear the module-scoped KV singleton between tests.
 * Never invoked from production code paths.
 */
export function __resetKVForTest(): void {
  kv.clear();
}
