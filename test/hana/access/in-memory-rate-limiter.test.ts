import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enforceRateLimit } from '../../../src/hana/access/application/rate-limiter.js';
import { InMemoryRateLimiter } from '../../../src/hana/access/infrastructure/in-memory-rate-limiter.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';

function setup() {
  const time = { ms: Date.UTC(2026, 0, 1) };
  const limiter = new InMemoryRateLimiter({ now: () => new Date(time.ms) });
  return { time, limiter };
}

test('allows the budget, then reports the wait until the oldest call leaves the window', () => {
  const { time, limiter } = setup();
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(limiter.consume('jdoe', 3), { allowed: true, retryAfterSeconds: 0 });
    time.ms += 5_000;
  }
  // t = 15s: first call was at 0s, so it frees up at 60s.
  assert.deepEqual(limiter.consume('jdoe', 3), { allowed: false, retryAfterSeconds: 45 });
  time.ms += 45_000;
  assert.equal(limiter.consume('jdoe', 3).allowed, true);
});

test('budgets are per user and rejected calls do not consume budget', () => {
  const { limiter } = setup();
  assert.equal(limiter.consume('a', 1).allowed, true);
  assert.equal(limiter.consume('a', 1).allowed, false);
  assert.equal(limiter.consume('a', 1).allowed, false);
  assert.equal(limiter.consume('b', 1).allowed, true);
});

test('enforceRateLimit throws RATE_LIMITED with the documented message', () => {
  const { time, limiter } = setup();
  enforceRateLimit(limiter, 'jdoe', 1);
  time.ms += 40_000;
  assert.throws(
    () => enforceRateLimit(limiter, 'jdoe', 1),
    (error: unknown) =>
      error instanceof SanitizedError &&
      error.code === 'RATE_LIMITED' &&
      error.message === 'Too many requests. Retry in 20s.',
  );
});
