import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';

// The Vercel AI SDK validates presence of provider API keys BEFORE making
// HTTP calls, so tests need a dummy key to allow MSW to intercept the request.
// Never use this key for real network calls — MSW intercepts everything.
process.env.OPENAI_API_KEY ??= 'test-key-msw-intercepted';
process.env.ANTHROPIC_API_KEY ??= 'test-key-msw-intercepted';
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= 'test-key-msw-intercepted';
process.env.DEEPSEEK_API_KEY ??= 'test-key-msw-intercepted';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
