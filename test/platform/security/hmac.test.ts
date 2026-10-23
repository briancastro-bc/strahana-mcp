import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  hmacSign,
  hmacVerify,
  openPayload,
  parseSigningKey,
  safeEqual,
  sealPayload,
  sha256Hex,
} from '../../../src/platform/security/hmac.js';

const key = parseSigningKey(randomBytes(32).toString('base64'));

test('parseSigningKey accepts 32+ random bytes in base64', () => {
  assert.equal(parseSigningKey(randomBytes(48).toString('base64')).length, 48);
});

test('parseSigningKey rejects short keys and placeholders without echoing them', () => {
  for (const bad of ['', 'c2hvcnQ=', '<32+ random bytes, base64>']) {
    assert.throws(
      () => parseSigningKey(bad),
      (err: Error) => {
        assert.match(err.message, /signingKey/);
        assert.ok(bad === '' || !err.message.includes(bad));
        return true;
      },
    );
  }
});

test('the same key and data always produce the same signature (stable across restarts)', () => {
  assert.equal(hmacSign(key, 'data'), hmacSign(key, 'data'));
  assert.notEqual(hmacSign(key, 'data'), hmacSign(key, 'other'));
});

test('hmacVerify accepts the right signature and rejects tampering', () => {
  const sig = hmacSign(key, 'data');
  assert.equal(hmacVerify(key, 'data', sig), true);
  assert.equal(hmacVerify(key, 'data2', sig), false);
  assert.equal(hmacVerify(key, 'data', `${sig}x`), false);
  assert.equal(hmacVerify(key, 'data', ''), false);
  assert.equal(hmacVerify(parseSigningKey(randomBytes(32).toString('base64')), 'data', sig), false);
});

test('sealPayload/openPayload round-trip and reject tampered tokens', () => {
  const token = sealPayload(key, '{"e":"DEV"}');
  assert.equal(openPayload(key, token), '{"e":"DEV"}');
  const [body = '', sig = ''] = token.split('.');
  const forged = `${Buffer.from('{"e":"PRD"}').toString('base64url')}.${sig}`;
  assert.equal(openPayload(key, forged), undefined);
  assert.equal(openPayload(key, body), undefined);
  assert.equal(openPayload(key, 'a.b.c'), undefined);
});

test('safeEqual handles different lengths without throwing', () => {
  assert.equal(safeEqual(Buffer.from('ab'), Buffer.from('ab')), true);
  assert.equal(safeEqual(Buffer.from('ab'), Buffer.from('abc')), false);
});

test('sha256Hex matches the known digest', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
