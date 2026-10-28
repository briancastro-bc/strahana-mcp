import { systemClock, type Clock } from '../../../platform/clock.js';
import type { RateLimitDecision, RateLimiter } from '../application/rate-limiter.js';

const WINDOW_MS = 60_000;

/**
 * Sliding-window limiter kept in process memory (POV 14: one instance; shared state is P-007).
 * Keys with no calls left in the window are dropped, so memory follows the active users.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly calls = new Map<string, number[]>();

  constructor(private readonly clock: Clock = systemClock) {}

  consume(key: string, limitPerMinute: number): RateLimitDecision {
    const now = this.clock.now().getTime();
    this.prune(now);
    const window = this.calls.get(key) ?? [];
    const oldest = window[0];
    if (window.length >= limitPerMinute && oldest !== undefined) {
      return { allowed: false, retryAfterSeconds: Math.ceil((oldest + WINDOW_MS - now) / 1000) };
    }
    window.push(now);
    this.calls.set(key, window);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    for (const [key, window] of this.calls) {
      const fresh = window.filter((at) => at + WINDOW_MS > now);
      if (fresh.length === 0) this.calls.delete(key);
      else if (fresh.length !== window.length) this.calls.set(key, fresh);
    }
  }
}
