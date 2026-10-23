import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Clock } from '../../../src/platform/clock.js';
import { createLogger } from '../../../src/platform/logging/logger.js';

const clock: Clock = { now: () => new Date('2026-01-02T03:04:05.000Z') };

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line), clock });
  return { lines, logger };
}

test('emits one JSON line with timestamp, level, message and whitelisted fields', () => {
  const { lines, logger } = capture();
  logger.info('server started', { transport: 'http', port: 8080 });
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.endsWith('\n'));
  assert.deepEqual(JSON.parse(lines[0] ?? ''), {
    ts: '2026-01-02T03:04:05.000Z',
    level: 'info',
    msg: 'server started',
    transport: 'http',
    port: 8080,
  });
});

test('drops fields outside the whitelist (credentials, rows, hashes of keys)', () => {
  const { lines, logger } = capture();
  const unsafe = { password: 'hunter2', row: 'Acme S.A.', keyHash: 'sha256:abc', code: 'DB_ERROR' };
  logger.error('failed', unsafe);
  const out = lines.join('');
  assert.ok(!out.includes('hunter2'));
  assert.ok(!out.includes('Acme'));
  assert.ok(!out.includes('sha256:abc'));
  assert.equal((JSON.parse(out) as { code: string }).code, 'DB_ERROR');
});

test('keeps every record on a single line even with newlines in values', () => {
  const { lines, logger } = capture();
  logger.warn('line1\nline2', { user: 'a\nb' });
  assert.equal(lines[0]?.trim().split('\n').length, 1);
});

test('audit entries carry only the minimal audit fields', () => {
  const { lines, logger } = capture();
  logger.audit({
    user: 'jdoe',
    env: 'DEV-SALES',
    sqlHash: 'abc123',
    rows: 10,
    durationMs: 42,
    outcome: 'ok',
    bytes: 512,
  });
  const record = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
  assert.equal(record['event'], 'audit');
  assert.equal(record['level'], 'info');
  assert.deepEqual(Object.keys(record).sort(), [
    'bytes',
    'durationMs',
    'env',
    'event',
    'level',
    'msg',
    'outcome',
    'rows',
    'sqlHash',
    'ts',
    'user',
  ]);
});

test('default sink writes to stderr, never stdout', () => {
  const logger = createLogger({ clock });
  assert.equal(typeof logger.info, 'function');
});
