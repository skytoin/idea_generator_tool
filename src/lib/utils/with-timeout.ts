/**
 * Error thrown by {@link withTimeout} when the wrapped promise does not
 * settle before the configured deadline. Carries the deadline on the
 * instance so callers can log or key retry logic on it.
 */
export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Race a promise against a timeout. When the timeout fires the returned
 * promise rejects with a {@link TimeoutError}, and if an AbortController
 * is supplied its signal is triggered so in-flight fetches can cancel
 * themselves. Cleans up the timer in both success and failure paths so
 * the event loop never holds a dangling setTimeout handle.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller?: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(new TimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
