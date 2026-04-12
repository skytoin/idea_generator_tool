import { describe, it, expect } from 'vitest';
import { classifyError } from '../../../../pipeline/scanners/tech-scout/classify-error';
import { TimeoutError } from '../../../../lib/utils/with-timeout';
import { GithubDeniedError } from '../../../../pipeline/scanners/tech-scout/adapters/github';

describe('classifyError', () => {
  it('classifies TimeoutError as timeout', () => {
    expect(classifyError(new TimeoutError(60_000))).toBe('timeout');
  });

  it('classifies GithubDeniedError as denied', () => {
    expect(classifyError(new GithubDeniedError(403))).toBe('denied');
  });

  it('classifies unknown github error (e.g. 422) as failed', () => {
    expect(classifyError(new Error('github 422'))).toBe('failed');
  });

  it('classifies "rate limit" message as denied', () => {
    expect(classifyError(new Error('rate limit hit, try again later'))).toBe(
      'denied',
    );
  });

  it('classifies "429" message as denied', () => {
    expect(classifyError(new Error('429 too many requests'))).toBe('denied');
  });

  it('classifies non-Error strings as failed', () => {
    expect(classifyError('weird string')).toBe('failed');
  });

  it('classifies undefined as failed', () => {
    expect(classifyError(undefined)).toBe('failed');
  });

  it('classifies empty object as failed', () => {
    expect(classifyError({})).toBe('failed');
  });

  it('classifies AbortError (from withTimeout abort) as timeout', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(classifyError(err)).toBe('timeout');
  });

  it('classifies "denied" message text as denied', () => {
    expect(classifyError(new Error('access denied by upstream'))).toBe(
      'denied',
    );
  });

  it('classifies a plain Error with unrelated message as failed', () => {
    expect(classifyError(new Error('network reset'))).toBe('failed');
  });
});

describe('classifyError — additional edge cases', () => {
  it('classifies "429: too many requests" as denied', () => {
    expect(classifyError(new Error('429: too many requests'))).toBe('denied');
  });

  it('classifies plain number 42 as failed', () => {
    expect(classifyError(42)).toBe('failed');
  });

  it('classifies null as failed', () => {
    expect(classifyError(null)).toBe('failed');
  });

  it('classifies a non-rate-limit Error subclass as failed', () => {
    class MyNetworkError extends Error {
      constructor() {
        super('connection reset by peer');
        this.name = 'MyNetworkError';
      }
    }
    expect(classifyError(new MyNetworkError())).toBe('failed');
  });

  it('classifies an Error subclass whose message matches rate-limit as denied', () => {
    class UpstreamError extends Error {
      constructor() {
        super('upstream 429 retry later');
        this.name = 'UpstreamError';
      }
    }
    expect(classifyError(new UpstreamError())).toBe('denied');
  });

  it('classifies "rate_limit exceeded" with underscore as denied', () => {
    // The classifier matches /rate[_ -]?limit/ so it accepts
    // "rate limit", "rate_limit", "rate-limit", and "ratelimit".
    expect(classifyError(new Error('rate_limit exceeded'))).toBe('denied');
  });

  it('classifies "rate-limit exceeded" with hyphen as denied', () => {
    expect(classifyError(new Error('rate-limit exceeded'))).toBe('denied');
  });

  it('classifies "ratelimit exceeded" with no separator as denied', () => {
    expect(classifyError(new Error('ratelimit exceeded'))).toBe('denied');
  });

  it('classifies "RATE LIMIT" uppercase as denied via toLowerCase()', () => {
    expect(classifyError(new Error('RATE LIMIT HIT'))).toBe('denied');
  });

  it('classifies boolean true as failed', () => {
    expect(classifyError(true)).toBe('failed');
  });

  it('classifies Symbol as failed', () => {
    expect(classifyError(Symbol('weird'))).toBe('failed');
  });
});
