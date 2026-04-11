import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from '../../../lib/utils/with-timeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves when inner promise resolves before timeout', async () => {
    const inner = Promise.resolve('done');
    const result = await withTimeout(inner, 1000);
    expect(result).toBe('done');
  });

  it('rejects with TimeoutError when inner exceeds timeout', async () => {
    vi.useFakeTimers();
    const inner = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 5000);
    });
    const raced = withTimeout(inner, 1000);
    vi.advanceTimersByTime(1001);
    await expect(raced).rejects.toBeInstanceOf(TimeoutError);
  });

  it('TimeoutError.name is TimeoutError and instanceof works', async () => {
    vi.useFakeTimers();
    const inner = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 5000);
    });
    const raced = withTimeout(inner, 100);
    vi.advanceTimersByTime(101);
    try {
      await raced;
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TimeoutError);
      expect((e as Error).name).toBe('TimeoutError');
    }
  });

  it('aborts AbortController when timeout fires', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const inner = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 5000);
    });
    const raced = withTimeout(inner, 100, controller);
    vi.advanceTimersByTime(101);
    await expect(raced).rejects.toBeInstanceOf(TimeoutError);
    expect(controller.signal.aborted).toBe(true);
  });

  it('resolving with undefined still works', async () => {
    const inner = Promise.resolve(undefined);
    const result = await withTimeout(inner, 1000);
    expect(result).toBeUndefined();
  });

  it('TimeoutError has timeoutMs property set to configured value', async () => {
    vi.useFakeTimers();
    const inner = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 5000);
    });
    const raced = withTimeout(inner, 250);
    vi.advanceTimersByTime(251);
    try {
      await raced;
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TimeoutError);
      expect((e as TimeoutError).timeoutMs).toBe(250);
    }
  });
});
