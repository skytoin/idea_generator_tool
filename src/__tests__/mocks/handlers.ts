import { http, HttpResponse } from 'msw';

/** Mock Anthropic API response */
export const anthropicHandler = http.post(
  'https://api.anthropic.com/v1/messages',
  () => HttpResponse.json({
    content: [{ type: 'text', text: '{"ideas": []}' }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
  })
);

/** Mock OpenAI API response */
export const openaiHandler = http.post(
  'https://api.openai.com/v1/chat/completions',
  () => HttpResponse.json({
    choices: [{ message: { content: '{"ideas": []}' } }],
    model: 'gpt-4o',
  })
);

/** Mock Google Gemini API response */
export const googleHandler = http.post(
  'https://generativelanguage.googleapis.com/*',
  () => HttpResponse.json({
    candidates: [{ content: { parts: [{ text: '{"ideas": []}' }] } }],
  })
);

/** Mock DeepSeek API response (OpenAI-compatible) */
export const deepseekHandler = http.post(
  'https://api.deepseek.com/v1/chat/completions',
  () => HttpResponse.json({
    choices: [{ message: { content: '{"ideas": []}' } }],
    model: 'deepseek-chat',
  })
);

export const handlers = [
  anthropicHandler,
  openaiHandler,
  googleHandler,
  deepseekHandler,
];