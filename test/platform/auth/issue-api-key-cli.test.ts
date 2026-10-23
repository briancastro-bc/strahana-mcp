import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashApiKey } from '../../../src/platform/auth/api-key.js';
import { runIssueApiKey } from '../../../src/platform/auth/issue-api-key-cli.js';

test('prints the plaintext key once and the hash line, never both in one line', () => {
  const lines: string[] = [];
  const code = runIssueApiKey(['--user', 'jdoe', '--groups', 'G1,G2'], (l) => lines.push(l));
  assert.equal(code, 0);
  const out = lines.join('\n');
  const key = /stk_[A-Za-z0-9_-]{43}/.exec(out)?.[0];
  assert.ok(key);
  const jsonLine = lines.find((l) => l.trim().startsWith('{'));
  assert.ok(jsonLine);
  assert.deepEqual(JSON.parse(jsonLine), {
    user: 'jdoe',
    keyHash: hashApiKey(key),
    groups: ['G1', 'G2'],
  });
  assert.ok(!jsonLine.includes(key));
});

test('tolerates the literal -- that pnpm may forward', () => {
  const lines: string[] = [];
  assert.equal(
    runIssueApiKey(['--', '--user', 'jdoe', '--groups', 'G1'], (l) => lines.push(l)),
    0,
  );
});

test('fails with usage when --user is missing', () => {
  const lines: string[] = [];
  assert.equal(
    runIssueApiKey(['--groups', 'G1'], (l) => lines.push(l)),
    1,
  );
  assert.match(lines.join('\n'), /Usage/);
  assert.ok(!lines.join('\n').includes('stk_'));
});

test('fails when --groups is missing or empty', () => {
  assert.equal(
    runIssueApiKey(['--user', 'a'], () => undefined),
    1,
  );
  assert.equal(
    runIssueApiKey(['--user', 'a', '--groups', ' , '], () => undefined),
    1,
  );
});
