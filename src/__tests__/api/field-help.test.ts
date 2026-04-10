import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  POST,
  __resetFieldHelpForTest,
} from '../../app/api/frame/field-help/route';
import { setOpenAIResponse, resetOpenAIMock } from '../mocks/openai-mock';

/** Build a field-help request with the standard content-type and scenario header. */
function buildRequest(body: unknown, scenario?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (scenario) headers['x-test-scenario'] = scenario;
  return new Request('http://test/api/frame/field-help', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/frame/field-help', () => {
  beforeEach(() => {
    __resetFieldHelpForTest();
  });
  afterEach(() => {
    resetOpenAIMock();
    __resetFieldHelpForTest();
  });

  it('returns 200 with message and typed suggested_value on happy path', async () => {
    setOpenAIResponse('field-help-ok', {
      content: JSON.stringify({
        message: 'Try listing Python data pipelines and Django APIs.',
        suggested_value: ['Python data pipelines', 'Django APIs'],
      }),
    });
    const req = buildRequest(
      {
        questionId: 'Q1',
        userMessage: 'I have no idea what skills to list',
        currentInput: { mode: 'explore' },
        sessionId: 'sess-1',
        scenario: 'field-help-ok',
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain('Python data pipelines');
    expect(data.suggested_value).toEqual(['Python data pipelines', 'Django APIs']);
  });

  it('allows suggested_value to be null when the question is conceptual', async () => {
    setOpenAIResponse('field-help-null', {
      content: JSON.stringify({
        message: 'This field is where you list skills you can apply yourself.',
        suggested_value: null,
      }),
    });
    const req = buildRequest({
      questionId: 'Q1',
      userMessage: 'What does this field mean?',
      currentInput: {},
      sessionId: 'sess-null',
      scenario: 'field-help-null',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.suggested_value).toBeNull();
  });

  it('returns 400 for an unknown questionId', async () => {
    const req = buildRequest({
      questionId: 'NOPE',
      userMessage: 'help',
      currentInput: {},
      sessionId: 'sess-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('unknown_field');
  });

  it('returns 400 when sessionId is missing', async () => {
    const req = buildRequest({
      questionId: 'Q1',
      userMessage: 'help',
      currentInput: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_input');
  });

  it('returns 400 when userMessage exceeds 1000 chars', async () => {
    const req = buildRequest({
      questionId: 'Q1',
      userMessage: 'x'.repeat(1001),
      currentInput: {},
      sessionId: 'sess-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_input');
  });

  it('returns 429 on the 11th request from the same session', async () => {
    setOpenAIResponse('rl-ok', {
      content: JSON.stringify({ message: 'ok', suggested_value: null }),
    });
    const body = {
      questionId: 'Q1',
      userMessage: 'help',
      currentInput: {},
      sessionId: 'rl-session',
      scenario: 'rl-ok',
    };
    for (let i = 0; i < 10; i++) {
      const ok = await POST(buildRequest(body));
      expect(ok.status).toBe(200);
    }
    const rejected = await POST(buildRequest(body));
    expect(rejected.status).toBe(429);
    const data = await rejected.json();
    expect(data.error).toBe('rate_limited');
    expect(data.retry_after_ms).toBeGreaterThan(0);
  });

  it('returns 400 invalid_json for non-JSON body', async () => {
    const req = new Request('http://test/api/frame/field-help', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_json');
  });
});
