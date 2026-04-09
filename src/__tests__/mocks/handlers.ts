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

/**
 * Build the chat/completions-shaped response for a scenario or a default.
 * The same payload is reused for both /chat/completions and /responses
 * endpoints since the Vercel AI SDK normalizes whichever it sees.
 */
async function handleOpenAIRequest(request: Request): Promise<Response> {
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
      return HttpResponse.json({
        choices: [{ message: { content: registered.content } }],
        model: registered.model ?? 'gpt-4o',
        usage: registered.usage,
      });
    }
  }
  return HttpResponse.json({
    choices: [{ message: { content: '{"ideas": []}' } }],
    model: 'gpt-4o',
  });
}

/** Mock OpenAI chat/completions endpoint with scenario routing */
export const openaiChatHandler = http.post(
  'https://api.openai.com/v1/chat/completions',
  ({ request }) => handleOpenAIRequest(request),
);

/** Mock OpenAI responses endpoint (Vercel AI SDK v6 structured output path) */
export const openaiResponsesHandler = http.post(
  'https://api.openai.com/v1/responses',
  ({ request }) => handleOpenAIRequest(request),
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
