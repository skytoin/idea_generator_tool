import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whitelist of fixtures the dev endpoint is willing to serve. Keeps the
 * handler from mapping arbitrary `name` values onto filesystem paths.
 */
const ALLOWED = new Set([
  'alice-minimum',
  'bob-medium',
  'carol-full',
  'dave-nonenglish',
  'eve-adversarial',
]);

type Ctx = { params: Promise<{ name: string }> };

/**
 * GET /fixtures/[name] — returns a Frame test fixture JSON so the
 * /debug/frame page can offer a "load fixture" dropdown in dev. Refuses
 * all requests when NODE_ENV === 'production' because test fixtures
 * should not be served in a live app.
 */
export async function GET(_request: Request, context: Ctx): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return new Response('not found', { status: 404 });
  }
  const { name } = await context.params;
  if (!ALLOWED.has(name)) {
    return new Response('not found', { status: 404 });
  }
  try {
    const path = join(
      process.cwd(),
      'src',
      '__tests__',
      'pipeline',
      'frame',
      'fixtures',
      `${name}.json`,
    );
    const raw = readFileSync(path, 'utf-8');
    return new Response(raw, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
