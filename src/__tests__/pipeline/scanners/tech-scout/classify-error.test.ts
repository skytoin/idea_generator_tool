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
