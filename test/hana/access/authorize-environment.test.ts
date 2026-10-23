import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeEnvironment } from '../../../src/hana/access/application/authorize-environment.js';
import { createLocalPrincipal } from '../../../src/platform/auth/principal.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';

const environments = {
  'DEV-SALES': { groups: ['G_DEV'] },
  'QAS-SALES': { groups: ['G_QAS', 'G_ALL'] },
  'DEV-HR': { groups: ['G_HR'] },
};

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof SanitizedError ? err.code : 'OTHER';
  }
  return undefined;
}

test('a single allowed environment is used when none is requested', () => {
  assert.equal(
    authorizeEnvironment({ userId: 'u', groups: ['G_DEV'] }, undefined, environments),
    'DEV-SALES',
  );
});

test('several allowed environments require an explicit one, listed in the error', () => {
  const principal = { userId: 'u', groups: ['G_DEV', 'G_ALL'] };
  try {
    authorizeEnvironment(principal, undefined, environments);
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err instanceof SanitizedError);
    assert.equal(err.code, 'ENV_REQUIRED');
    assert.equal(err.message, 'environment required: DEV-SALES, QAS-SALES');
  }
});

test('an explicit allowed environment is accepted', () => {
  const principal = { userId: 'u', groups: ['G_DEV', 'G_ALL'] };
  assert.equal(authorizeEnvironment(principal, 'QAS-SALES', environments), 'QAS-SALES');
});

test('a group without access to the environment is forbidden', () => {
  const principal = { userId: 'u', groups: ['G_DEV'] };
  assert.equal(
    code(() => authorizeEnvironment(principal, 'QAS-SALES', environments)),
    'ENV_FORBIDDEN',
  );
});

test('unknown environments look the same as forbidden ones', () => {
  const principal = { userId: 'u', groups: ['G_DEV'] };
  assert.equal(
    code(() => authorizeEnvironment(principal, 'NOPE', environments)),
    'ENV_FORBIDDEN',
  );
});

test('a principal without matching groups has no access at all', () => {
  const principal = { userId: 'u', groups: ['OTHER'] };
  assert.equal(
    code(() => authorizeEnvironment(principal, undefined, environments)),
    'ENV_FORBIDDEN',
  );
  assert.equal(
    code(() => authorizeEnvironment({ userId: 'u', groups: [] }, 'DEV-SALES', environments)),
    'ENV_FORBIDDEN',
  );
});

test('the local stdio principal spans the groups of the loaded environments', () => {
  const local = createLocalPrincipal(['G_DEV', 'G_DEV', 'G_QAS']);
  assert.equal(local.userId, 'local');
  assert.deepEqual(local.groups, ['G_DEV', 'G_QAS']);
});
