/** Retry async function with exponential backoff */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: { maxAttempts?: number; baseDelay?: number } = {},
  ): Promise<T> {
    const { maxAttempts = 3, baseDelay = 1000 } = options;
  
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  
    throw new Error('Unreachable');
  }