/**
 * In-memory sliding window rate limiter. Keyed by an arbitrary string
 * (e.g. session id). Not suitable for multi-instance production — each
 * process keeps its own Map and state is lost on restart.
 */

export type RateLimitConfig = {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed within window. */
  maxRequests: number;
  /** Clock override for tests. Defaults to Date.now. */
  clock?: () => number;
};

export type RateLimitDecision =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number; retryAfterMs: number };

export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly entries: Map<string, number[]>;

  /** Create a new limiter with the given window and per-key quota. */
  constructor(config: RateLimitConfig) {
    this.config = config;
    this.entries = new Map();
  }

  /**
   * Record a request from `key` and return whether it's allowed under the
   * current sliding window. Adds the timestamp to the key's history on
   * allow; leaves history untouched on reject.
   */
  check(key: string): RateLimitDecision {
    const now = this.now();
    const kept = this.pruneKey(key, now);
    if (kept.length >= this.config.maxRequests) {
      const oldest = kept[0] ?? now;
      const resetAt = oldest + this.config.windowMs;
      return { allowed: false, remaining: 0, resetAt, retryAfterMs: resetAt - now };
    }
    kept.push(now);
    this.entries.set(key, kept);
    const resetAt = (kept[0] ?? now) + this.config.windowMs;
    return {
      allowed: true,
      remaining: this.config.maxRequests - kept.length,
      resetAt,
    };
  }

  /** Remove all entries. Intended for tests; has no effect on config. */
  reset(): void {
    this.entries.clear();
  }

  /** Return the current clock reading via the configured clock or Date.now. */
  private now(): number {
    return this.config.clock?.() ?? Date.now();
  }

  /**
   * Drop timestamps for `key` that are older than the sliding window and
   * return the remaining list (mutating the backing map in the process).
   */
  private pruneKey(key: string, now: number): number[] {
    const cutoff = now - this.config.windowMs;
    const existing = this.entries.get(key) ?? [];
    const kept = existing.filter((t) => t > cutoff);
    this.entries.set(key, kept);
    return kept;
  }
}
