import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../../lib/utils/rate-limit';

/**
 * Build a controllable clock: the returned tuple contains the clock function
 * and a mutator that advances virtual time for deterministic tests.
 */
function makeClock(start = 0): [() => number, (deltaMs: number) => void] {
  let now = start;
  const clock = () => now;
  const advance = (deltaMs: number) => {
    now += deltaMs;
  };
  return [clock, advance];
}

describe('RateLimiter', () => {
  it('allows the first request with remaining = maxRequests - 1', () => {
    const [clock] = makeClock();
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3, clock });
    const decision = limiter.check('alice');
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.remaining).toBe(2);
  });

  it('allows exactly maxRequests before rejecting the next', () => {
    const [clock] = makeClock();
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3, clock });
    expect(limiter.check('alice').allowed).toBe(true);
    expect(limiter.check('alice').allowed).toBe(true);
    expect(limiter.check('alice').allowed).toBe(true);
    const fourth = limiter.check('alice');
    expect(fourth.allowed).toBe(false);
    if (fourth.allowed) return;
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('allows further requests after the window elapses', () => {
    const [clock, advance] = makeClock();
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2, clock });
    limiter.check('alice');
    limiter.check('alice');
    expect(limiter.check('alice').allowed).toBe(false);
    advance(1001);
    const decision = limiter.check('alice');
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    // After pruning the 2 prior requests, one new one is recorded -> 1 remaining.
    expect(decision.remaining).toBe(1);
  });

  it('tracks keys independently', () => {
    const [clock] = makeClock();
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2, clock });
    limiter.check('alice');
    limiter.check('alice');
    expect(limiter.check('alice').allowed).toBe(false);
    // bob has not used the limit yet
    expect(limiter.check('bob').allowed).toBe(true);
    expect(limiter.check('bob').allowed).toBe(true);
    expect(limiter.check('bob').allowed).toBe(false);
  });

  it('rejected decision exposes retryAfterMs computed from the oldest request', () => {
    const [clock, advance] = makeClock();
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1, clock });
    limiter.check('alice'); // recorded at t=0
    advance(200); // now t=200
    const decision = limiter.check('alice');
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    // oldest timestamp = 0, windowMs = 1000, now = 200 -> retryAfterMs = 800
    expect(decision.retryAfterMs).toBe(800);
  });

  it('reset() clears all entries', () => {
    const [clock] = makeClock();
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1, clock });
    limiter.check('alice');
    expect(limiter.check('alice').allowed).toBe(false);
    limiter.reset();
    expect(limiter.check('alice').allowed).toBe(true);
  });

  it('is fully deterministic with an injected clock', () => {
    const [clock, advance] = makeClock();
    const limiter = new RateLimiter({ windowMs: 500, maxRequests: 2, clock });
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(false);
    advance(499);
    expect(limiter.check('k').allowed).toBe(false);
    advance(2);
    expect(limiter.check('k').allowed).toBe(true);
  });
});
