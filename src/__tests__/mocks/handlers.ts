import { http, HttpResponse } from 'msw';
import { extractScenarioFromBody, getOpenAIResponse } from './openai-mock';

/** Mock Anthropic API response */
export const anthropicHandler = http.post(
  'https://api.anthropic.com/v1/messages',
  () =>
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

export const handlers = [
  anthropicHandler,
  openaiChatHandler,
  openaiResponsesHandler,
  googleHandler,
  deepseekHandler,
];
