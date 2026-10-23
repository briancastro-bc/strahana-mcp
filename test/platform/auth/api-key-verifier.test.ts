import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashApiKey, issueApiKey } from '../../../src/platform/auth/api-key.js';
import { ApiKeyVerifier } from '../../../src/platform/auth/api-key-verifier.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';

const alice = issueApiKey({ user: 'alice', groups: ['G_DEV', 'G_QAS'] });
const bob = issueApiKey({ user: 'bob', groups: ['G_DEV'] });
const verifier = new ApiKeyVerifier([alice.entry, bob.entry]);

async function rejected(headers: Record<string, string | string[] | undefined>) {
  await assert.rejects(verifier.verify(headers), (err: unknown) => {
    assert.ok(err instanceof SanitizedError);
    assert.equal(err.code, 'AUTH_REQUIRED');
    return true;
  });
}

test('accepts a valid key as Bearer and yields the principal', async () => {
  const principal = await verifier.verify({ authorization: `Bearer ${alice.key}` });
  assert.deepEqual(principal, { userId: 'alice', groups: ['G_DEV', 'G_QAS'] });
});

test('accepts a valid key in X-API-Key', async () => {
  const principal = await verifier.verify({ 'x-api-key': bob.key });
  assert.equal(principal.userId, 'bob');
});

test('the Bearer scheme is case-insensitive', async () => {
  assert.equal((await verifier.verify({ authorization: `bearer ${bob.key}` })).userId, 'bob');
});

test('rejects missing credentials', async () => {
  await rejected({});
  await rejected({ authorization: '' });
  await rejected({ 'x-api-key': '' });
});

test('rejects unknown, malformed, wrong-scheme and oversized keys', async () => {
  await rejected({ authorization: `Bearer ${issueApiKey({ user: 'x', groups: [] }).key}` });
  await rejected({ authorization: 'Bearer stk_short' });
  await rejected({ authorization: `Basic ${alice.key}` });
  await rejected({ authorization: alice.key });
  await rejected({ 'x-api-key': 'a'.repeat(5000) });
  await rejected({ 'x-api-key': [alice.key, bob.key] });
});

test('a revoked key (entry removed) stops working', async () => {
  const afterRevocation = new ApiKeyVerifier([bob.entry]);
  await assert.rejects(afterRevocation.verify({ 'x-api-key': alice.key }));
  assert.equal((await afterRevocation.verify({ 'x-api-key': bob.key })).userId, 'bob');
});

test('a verifier with no keys rejects everything', async () => {
  await assert.rejects(new ApiKeyVerifier([]).verify({ 'x-api-key': alice.key }));
});

test('hashes in the entries are never exposed through errors', async () => {
  try {
    await verifier.verify({ 'x-api-key': 'stk_nope' });
    assert.fail('should reject');
  } catch (err) {
    assert.ok(!(err as Error).message.includes(hashApiKey(alice.key)));
  }
});
