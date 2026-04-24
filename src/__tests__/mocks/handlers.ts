import { http, HttpResponse } from 'msw';
import { extractScenarioFromBody, getOpenAIResponse } from './openai-mock';
import {
  getHnResponse,
  getArxivResponse,
  getGithubResponse,
  getRedditResponse,
  getHuggingfaceResponse,
} from './scanner-mocks';

/** Mock Anthropic API response */
export const anthropicHandler = http.post('https://api.anthropic.com/v1/messages', () =>
  HttpResponse.json({
    content: [{ type: 'text', text: '{"ideas": []}' }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
  }),
);

/** Build a chat/completions-shaped JSON body for a content string. */
function chatCompletionsBody(content: string, model: string, usage?: unknown) {
  return {
    id: 'chatcmpl-test',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    model,
    usage,
  };
}

/** Build a /v1/responses-shaped JSON body for a content string. */
function responsesBody(content: string, model: string, usage?: unknown) {
  return {
    id: 'resp-test',
    created_at: 0,
    model,
    output: [
      {
        type: 'message',
        role: 'assistant',
        id: 'msg-test',
        content: [{ type: 'output_text', text: content, annotations: [] }],
      },
    ],
    usage,
  };
}

/** Resolve the content string from a scenario lookup or fall back to a stub. */
async function resolveContentForRequest(
  request: Request,
): Promise<{ content: string; model: string; usage?: unknown }> {
  let body: unknown = undefined;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const scenario = extractScenarioFromBody(body);
  if (scenario) {
    const registered = getOpenAIResponse(scenario);
    if (registered) {
      return {
        content: registered.content,
        model: registered.model ?? 'gpt-4o',
        usage: registered.usage,
      };
    }
  }
  return { content: '{"ideas": []}', model: 'gpt-4o' };
}

/** Mock OpenAI chat/completions endpoint with scenario routing */
export const openaiChatHandler = http.post(
  'https://api.openai.com/v1/chat/completions',
  async ({ request }) => {
    const { content, model, usage } = await resolveContentForRequest(request);
    return HttpResponse.json(chatCompletionsBody(content, model, usage));
  },
);

/** Mock OpenAI responses endpoint (Vercel AI SDK v6 structured output path) */
export const openaiResponsesHandler = http.post(
  'https://api.openai.com/v1/responses',
  async ({ request }) => {
    const { content, model, usage } = await resolveContentForRequest(request);
    return HttpResponse.json(responsesBody(content, model, usage));
  },
);

/** Mock Google Gemini API response */
export const googleHandler = http.post(
  'https://generativelanguage.googleapis.com/*',
  () =>
    HttpResponse.json({
      candidates: [{ content: { parts: [{ text: '{"ideas": []}' }] } }],
    }),
);

/** Mock DeepSeek API response (OpenAI-compatible) */
export const deepseekHandler = http.post(
  'https://api.deepseek.com/v1/chat/completions',
  () =>
    HttpResponse.json({
      choices: [{ message: { content: '{"ideas": []}' } }],
      model: 'deepseek-chat',
    }),
);

/** Empty HN Algolia payload used when no scenario matches. */
const EMPTY_HN_PAYLOAD = {
  hits: [],
  nbHits: 0,
  page: 0,
  nbPages: 0,
  hitsPerPage: 20,
  query: '',
  params: '',
};

/** Empty arxiv Atom feed used when no scenario matches. */
const EMPTY_ARXIV_FEED =
  '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';

/**
 * Mock HN Algolia search endpoint with scenario routing. Tests set a
 * body via setHnResponse(scenario, body) and pass the scenario name in
 * the `x-test-scenario` header; anything else gets an empty payload.
 */
export const hnAlgoliaHandler = http.get(
  'https://hn.algolia.com/api/v1/search',
  ({ request }) => {
    const scenario = request.headers.get('x-test-scenario');
    if (scenario) {
      const body = getHnResponse(scenario);
      if (body !== undefined) return HttpResponse.json(body);
    }
    return HttpResponse.json(EMPTY_HN_PAYLOAD);
  },
);

/**
 * Mock arxiv Atom feed endpoint with scenario routing. Returns the
 * registered XML string verbatim with atom+xml content type; falls
 * back to an empty feed when no scenario is registered.
 */
export const arxivHandler = http.get(
  'http://export.arxiv.org/api/query',
  ({ request }) => {
    const scenario = request.headers.get('x-test-scenario');
    if (scenario) {
      const xml = getArxivResponse(scenario);
      if (xml !== undefined) {
        return new HttpResponse(xml, {
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
    }
    return new HttpResponse(EMPTY_ARXIV_FEED, {
      headers: { 'content-type': 'application/atom+xml' },
    });
  },
);

/**
 * Mock GitHub repository search endpoint with scenario routing.
 * A body of `{ __denied: <code> }` returns that HTTP status so tests
 * can exercise rate-limit and forbidden paths without a real API.
 */
export const githubSearchHandler = http.get(
  'https://api.github.com/search/repositories',
  ({ request }) => {
    const scenario = request.headers.get('x-test-scenario');
    if (scenario) {
      const body = getGithubResponse(scenario);
      if (body && typeof body === 'object' && '__denied' in body) {
        const denied = (body as { __denied: number }).__denied;
        return new HttpResponse(JSON.stringify({ message: 'rate limited' }), {
          status: denied,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (body !== undefined) return HttpResponse.json(body);
    }
    return HttpResponse.json({
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
  },
);

/** Empty Reddit Listing payload used when no scenario matches. */
const EMPTY_REDDIT_PAYLOAD = {
  kind: 'Listing',
  data: { after: null, before: null, children: [] },
};

/**
 * Mock Reddit subreddit search endpoint with scenario routing. The
 * `:sub` path param matches any subreddit (case preserved) so tests
 * don't have to register one handler per sub. A body of
 * `{ __denied: <code> }` returns that HTTP status so tests can
 * exercise the 401/403/429 paths without a real API. When no
 * scenario is registered the handler returns an empty Listing so
 * unrelated tests that incidentally hit the adapter still return a
 * clean shape.
 */
/**
 * Build the shared scenario-routing response logic used by both the
 * per-sub and cross-sub Reddit handlers. Pulled out so the two
 * endpoints stay in lockstep — adding a new fixture or denial
 * shape only has to be edited in one place.
 */
function buildRedditScenarioResponse(request: Request): Response {
  const scenario = request.headers.get('x-test-scenario');
  if (scenario) {
    const body = getRedditResponse(scenario);
    if (body && typeof body === 'object' && '__denied' in body) {
      const denied = (body as { __denied: number }).__denied;
      return new HttpResponse(JSON.stringify({ message: 'denied' }), {
        status: denied,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (body !== undefined) return HttpResponse.json(body);
  }
  return HttpResponse.json(EMPTY_REDDIT_PAYLOAD);
}

export const redditSearchHandler = http.get(
  'https://www.reddit.com/r/:sub/search.json',
  ({ request }) => buildRedditScenarioResponse(request),
);

/**
 * Mock Reddit's site-wide cross-sub search endpoint. Used by the
 * Tier-1 cross-sub pain query that OR's `subreddit:` clauses into
 * the `q=` param rather than restricting per-URL. Shares the same
 * scenario routing as the per-sub handler so tests can register
 * one fixture and reuse it across both endpoints when needed.
 */
export const redditCrossSubSearchHandler = http.get(
  'https://www.reddit.com/search.json',
  ({ request }) => buildRedditScenarioResponse(request),
);

/**
 * Build the shared scenario-routing response for the Hugging Face
 * handlers. All three HF surfaces (models, spaces, daily_papers)
 * share one scenario registry — tests register an array body
 * specific to whatever surface they're exercising. Pass
 * `{ __denied: <code> }` to simulate a 401/403/429 path.
 */
function buildHuggingfaceScenarioResponse(request: Request): Response {
  const scenario = request.headers.get('x-test-scenario');
  if (scenario) {
    const body = getHuggingfaceResponse(scenario);
    if (body && typeof body === 'object' && '__denied' in body) {
      const denied = (body as { __denied: number }).__denied;
      return new HttpResponse(JSON.stringify({ error: 'denied' }), {
        status: denied,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (body !== undefined) return HttpResponse.json(body);
  }
  // No scenario registered → empty array (consistent with HF behavior
  // when a search returns no results).
  return HttpResponse.json([]);
}

export const huggingfaceModelsHandler = http.get(
  'https://huggingface.co/api/models',
  ({ request }) => buildHuggingfaceScenarioResponse(request),
);

export const huggingfaceSpacesHandler = http.get(
  'https://huggingface.co/api/spaces',
  ({ request }) => buildHuggingfaceScenarioResponse(request),
);

export const huggingfaceDailyPapersHandler = http.get(
  'https://huggingface.co/api/daily_papers',
  ({ request }) => buildHuggingfaceScenarioResponse(request),
);

export const handlers = [
  anthropicHandler,
  openaiChatHandler,
  openaiResponsesHandler,
  googleHandler,
  deepseekHandler,
  hnAlgoliaHandler,
  arxivHandler,
  githubSearchHandler,
  redditSearchHandler,
  redditCrossSubSearchHandler,
  huggingfaceModelsHandler,
  huggingfaceSpacesHandler,
  huggingfaceDailyPapersHandler,
];
