import { errors } from '../../../platform/errors/sanitized-error.js';

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until a call would be allowed again (0 when allowed). */
  retryAfterSeconds: number;
}

/** Port: per-key call budget per minute. The MVP adapter is in memory (single instance). */
export interface RateLimiter {
  consume(key: string, limitPerMinute: number): RateLimitDecision;
}

/** Spends one call of the user's budget or throws `RATE_LIMITED` with the wait time. */
export function enforceRateLimit(
  limiter: RateLimiter,
  userId: string,
  limitPerMinute: number,
): void {
  const decision = limiter.consume(userId, limitPerMinute);
  if (!decision.allowed) throw errors.rateLimited(decision.retryAfterSeconds);
}
