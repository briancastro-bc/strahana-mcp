import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapDriverError } from '../../../../src/hana/query/infrastructure/hana-error-mapping.js';
import { errors } from '../../../../src/platform/errors/sanitized-error.js';

const options = { timeoutSeconds: 30 };

test('known codes map to fixed texts; the driver message is never used', () => {
  const error = mapDriverError(Object.assign(new Error('secret value 42'), { code: 260 }), options);
  assert.equal(error.code, 'DB_ERROR');
  assert.equal(error.message, 'Database error 260: invalid column name.');
});

test('timeouts: driver code, local timer', () => {
  assert.equal(
    mapDriverError(Object.assign(new Error('x'), { code: 139 }), options).code,
    'DB_TIMEOUT',
  );
  assert.equal(
    mapDriverError(new Error('x'), { ...options, timedOutLocally: true }).message,
    'Query exceeded 30s. Narrow the filters or aggregate.',
  );
});

test('connection and authentication failures are generic', () => {
  for (const code of [10, 18, -10709]) {
    const error = mapDriverError(
      Object.assign(new Error('auth failed for user STRAHANA_RO at host'), { code }),
      options,
    );
    assert.equal(error.message, 'Database unavailable. Retry later or contact an administrator.');
  }
});

test('unknown codes expose only the number; no code exposes nothing', () => {
  assert.equal(
    mapDriverError(Object.assign(new Error('x'), { code: 99999 }), options).message,
    'Database error 99999. Simplify the query or retry later.',
  );
  assert.equal(
    mapDriverError('boom', options).message,
    'Database error. Simplify the query or retry later.',
  );
  assert.equal(mapDriverError(null, options).code, 'DB_ERROR');
});

test('sanitized errors pass through untouched', () => {
  const original = errors.dbTimeout(5);
  assert.equal(mapDriverError(original, options), original);
});
