import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ERROR_CODES,
  SanitizedError,
  errors,
  formatForClient,
  toSanitizedError,
} from '../../../src/platform/errors/sanitized-error.js';

test('SanitizedError exposes only code and a one-line message', () => {
  const err = new SanitizedError('DB_ERROR', 'first line\n  second   line\r\nthird');
  assert.equal(err.code, 'DB_ERROR');
  assert.equal(err.message, 'first line second line third');
  assert.deepEqual(err.toJSON(), { code: 'DB_ERROR', message: 'first line second line third' });
});

test('messages are capped so a single error cannot flood the client', () => {
  const err = new SanitizedError('DB_ERROR', 'x'.repeat(1000));
  assert.ok(err.message.length <= 300);
});

test('factories produce the POV 4.4 messages', () => {
  assert.equal(errors.authRequired().code, 'AUTH_REQUIRED');
  assert.equal(errors.authRequired().message, 'Missing or invalid API key.');
  assert.equal(
    errors.envRequired(['DEV-SALES', 'QAS-SALES']).message,
    'environment required: DEV-SALES, QAS-SALES',
  );
  assert.equal(errors.envForbidden('QAS-SALES').message, 'No access to environment QAS-SALES.');
});

test('every factory result is a single line with a known code', () => {
  const samples = [
    errors.authRequired(),
    errors.envRequired(['A', 'B']),
    errors.envForbidden('A'),
    errors.notImplemented('hana_query', 3),
    errors.configInvalid('environments.A.groups: must not be empty'),
    errors.internal(),
  ];
  for (const err of samples) {
    assert.ok(ERROR_CODES.includes(err.code));
    assert.ok(!err.message.includes('\n'));
  }
});

test('toSanitizedError never leaks the message of unknown errors', () => {
  const secret = new Error('connect failed password=hunter2 host=db.internal');
  const out = toSanitizedError(secret);
  assert.equal(out.code, 'INTERNAL_ERROR');
  assert.ok(!out.message.includes('hunter2'));
  const known = errors.authRequired();
  assert.equal(toSanitizedError(known), known);
});

test('formatForClient renders CODE: message on one line', () => {
  assert.equal(
    formatForClient(errors.authRequired()),
    'AUTH_REQUIRED: Missing or invalid API key.',
  );
});
