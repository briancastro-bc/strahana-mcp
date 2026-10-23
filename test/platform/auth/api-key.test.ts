import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_KEY_PREFIX, hashApiKey, issueApiKey } from '../../../src/platform/auth/api-key.js';
import { KEY_HASH_PATTERN } from '../../../src/platform/config/schema.js';

test('issued keys use the stk_ prefix and 32 random bytes in base64url', () => {
  const { key } = issueApiKey({ user: 'jdoe', groups: ['G'] });
  assert.ok(key.startsWith(API_KEY_PREFIX));
  assert.match(key, /^stk_[A-Za-z0-9_-]{43}$/);
});

test('keys are unique per issue', () => {
  const a = issueApiKey({ user: 'a', groups: [] });
  const b = issueApiKey({ user: 'a', groups: [] });
  assert.notEqual(a.key, b.key);
});

test('the stored entry holds only the hash, never the plaintext key', () => {
  const { key, entry } = issueApiKey({ user: 'jdoe', groups: ['G1', 'G2'] });
  assert.equal(entry.user, 'jdoe');
  assert.deepEqual(entry.groups, ['G1', 'G2']);
  assert.match(entry.keyHash, KEY_HASH_PATTERN);
  assert.equal(entry.keyHash, hashApiKey(key));
  assert.ok(!JSON.stringify(entry).includes(key));
});
