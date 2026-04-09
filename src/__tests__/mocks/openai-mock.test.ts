import { describe, it, expect, afterEach } from 'vitest';
import {
  setOpenAIResponse,
  getOpenAIResponse,
  resetOpenAIMock,
  extractScenarioFromBody,
} from './openai-mock';

describe('openai-mock registry', () => {
  afterEach(() => {
    resetOpenAIMock();
  });

  it('setOpenAIResponse stores and getOpenAIResponse retrieves', () => {
    setOpenAIResponse('test-scenario', { content: 'hello world' });
    const response = getOpenAIResponse('test-scenario');
    expect(response).toBeDefined();
    expect(response?.content).toBe('hello world');
  });

  it('resetOpenAIMock clears the registry', () => {
    setOpenAIResponse('to-clear', { content: 'gone' });
    resetOpenAIMock();
    expect(getOpenAIResponse('to-clear')).toBeUndefined();
  });

  it('getOpenAIResponse returns undefined for unknown scenario', () => {
    expect(getOpenAIResponse('never-set')).toBeUndefined();
  });

  it('stores optional model and usage fields', () => {
    setOpenAIResponse('full', {
      content: 'x',
      model: 'gpt-4o',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const response = getOpenAIResponse('full');
    expect(response?.model).toBe('gpt-4o');
    expect(response?.usage?.total_tokens).toBe(3);
  });
});

describe('extractScenarioFromBody', () => {
  it('finds [[SCENARIO:foo-bar]] in a system message content', () => {
    const body = {
      messages: [
        { role: 'system', content: 'You are a helper. [[SCENARIO:foo-bar]] Be concise.' },
        { role: 'user', content: 'hi' },
      ],
    };
    expect(extractScenarioFromBody(body)).toBe('foo-bar');
  });

  it('finds [[SCENARIO:name]] in a user message content', () => {
    const body = {
      messages: [
        { role: 'system', content: 'You are a helper.' },
        { role: 'user', content: 'context [[SCENARIO:user-side]] end' },
      ],
    };
    expect(extractScenarioFromBody(body)).toBe('user-side');
  });

  it('returns undefined when no marker present', () => {
    const body = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'nothing to see' },
      ],
    };
    expect(extractScenarioFromBody(body)).toBeUndefined();
  });

  it('handles messages with content as an array of parts', () => {
    const body = {
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'Be smart.' },
            { type: 'text', text: '[[SCENARIO:parts-case]] extra' },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    };
    expect(extractScenarioFromBody(body)).toBe('parts-case');
  });

  it('handles bodies with an input field (OpenAI responses API format)', () => {
    const body = {
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: '[[SCENARIO:responses-api]] hi' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Do a thing' }],
        },
      ],
    };
    expect(extractScenarioFromBody(body)).toBe('responses-api');
  });

  it('handles input field with plain string content', () => {
    const body = {
      input: [
        { role: 'system', content: 'plain string [[SCENARIO:plain-str]] ok' },
        { role: 'user', content: 'hi' },
      ],
    };
    expect(extractScenarioFromBody(body)).toBe('plain-str');
  });

  it('returns undefined for null/undefined/non-object inputs', () => {
    expect(extractScenarioFromBody(null)).toBeUndefined();
    expect(extractScenarioFromBody(undefined)).toBeUndefined();
    expect(extractScenarioFromBody('not-an-object')).toBeUndefined();
    expect(extractScenarioFromBody({})).toBeUndefined();
  });

  it('returns first match when multiple markers are present', () => {
    const body = {
      messages: [
        { role: 'system', content: '[[SCENARIO:first]]' },
        { role: 'user', content: '[[SCENARIO:second]]' },
      ],
    };
    expect(extractScenarioFromBody(body)).toBe('first');
  });
});
