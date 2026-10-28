import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyContextId } from '../../../src/hana/catalog/application/verify-context-id.js';
import { HmacContextIdCodec } from '../../../src/hana/catalog/infrastructure/hmac-context-id-codec.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';
import { sealPayload } from '../../../src/platform/security/hmac.js';

const key = Buffer.alloc(32, 9);
let nowMs = Date.UTC(2026, 0, 1);
const clock = { now: () => new Date(nowMs) };
const codec = new HmacContextIdCodec({ key, ttlSeconds: 3600, clock });
const claims = {
  userId: 'jdoe',
  environment: 'DEV-SALES',
  catalogVersion: '1.abcd1234',
  entities: ['COM_ACME_SALES_ORDERS'],
};
const expectation = {
  userId: 'jdoe',
  catalogVersionOf: (env: string) => (env === 'DEV-SALES' ? '1.abcd1234' : undefined),
};

const isInvalid = (error: unknown) =>
  error instanceof SanitizedError &&
  error.code === 'CONTEXT_INVALID' &&
  error.message === 'context_id expired or invalid. Call hana_context again.';

test('a context_id round-trips with its bindings and a 60 minute expiry', () => {
  nowMs = Date.UTC(2026, 0, 1);
  const token = codec.issue(claims);
  const opened = verifyContextId(codec, token, { ...expectation, environment: 'DEV-SALES' });
  assert.deepEqual({ ...opened, expiresAt: undefined }, { ...claims, expiresAt: undefined });
  assert.equal(opened.expiresAt, nowMs / 1000 + 3600);
});

test('the same claims sign identically across codec instances (key from config, not random)', () => {
  nowMs = Date.UTC(2026, 0, 1);
  const other = new HmacContextIdCodec({ key: Buffer.from(key), ttlSeconds: 3600, clock });
  assert.equal(other.issue(claims), codec.issue(claims));
});

test('rejects tampered, truncated, foreign-key and garbage tokens', () => {
  nowMs = Date.UTC(2026, 0, 1);
  const token = codec.issue(claims);
  const [body = '', signature = ''] = token.split('.');
  const forgedBody = Buffer.from(
    JSON.stringify({
      u: 'admin',
      e: 'DEV-SALES',
      v: '1.abcd1234',
      t: ['X'],
      x: nowMs / 1000 + 99999,
    }),
  ).toString('base64url');
  const foreign = new HmacContextIdCodec({ key: Buffer.alloc(32, 1), clock }).issue(claims);
  const unsignedShape = sealPayload(key, '"not an object"');
  for (const bad of [
    `${forgedBody}.${signature}`,
    `${body}.${signature}x`,
    body,
    '',
    'a.b.c',
    foreign,
    unsignedShape,
  ]) {
    assert.throws(() => verifyContextId(codec, bad, expectation), isInvalid, bad.slice(0, 12));
  }
});

test('rejects expired contexts at the exact expiry instant', () => {
  nowMs = Date.UTC(2026, 0, 1);
  const token = codec.issue(claims);
  nowMs += 3600 * 1000 - 1;
  assert.doesNotThrow(() => verifyContextId(codec, token, expectation));
  nowMs += 1;
  assert.throws(() => verifyContextId(codec, token, expectation), isInvalid);
});

test('rejects another user, another environment and an outdated catalog version', () => {
  nowMs = Date.UTC(2026, 0, 1);
  const token = codec.issue(claims);
  assert.throws(
    () => verifyContextId(codec, token, { ...expectation, userId: 'mallory' }),
    isInvalid,
  );
  assert.throws(
    () => verifyContextId(codec, token, { ...expectation, environment: 'QAS-SALES' }),
    isInvalid,
  );
  assert.throws(
    () => verifyContextId(codec, token, { ...expectation, catalogVersionOf: () => '2.deadbeef' }),
    isInvalid,
  );
  assert.throws(
    () => verifyContextId(codec, token, { ...expectation, catalogVersionOf: () => undefined }),
    isInvalid,
  );
});

test('the payload carries no secrets: only user, environment, catalog version, entities, expiry', () => {
  const payload = JSON.parse(
    Buffer.from(codec.issue(claims).split('.')[0] ?? '', 'base64url').toString(),
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ['e', 't', 'u', 'v', 'x']);
});
