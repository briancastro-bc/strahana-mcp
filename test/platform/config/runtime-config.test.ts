import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createInMemoryCredentialProvider } from '../../../src/platform/config/credential-provider.js';
import { loadRuntimeConfig, readConfigFile } from '../../../src/platform/config/runtime-config.js';
import { configSchema, type StrahanaConfig } from '../../../src/platform/config/schema.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';

const HASH = `sha256:${'a'.repeat(64)}`;

function config(overrides: Record<string, unknown> = {}): StrahanaConfig {
  return configSchema.parse({
    environments: {
      'DEV-SALES': {
        kind: 'hana',
        service: 'svc-dev',
        schema: 'SYNTH_SCHEMA',
        catalog: 'catalog/sales.catalog.yaml',
        groups: ['G_DEV'],
        ...overrides,
      },
      'PRD-SALES': {
        kind: 'hana',
        productive: true,
        service: 'svc-prd',
        schema: 'SYNTH_SCHEMA',
        catalog: 'catalog/sales.catalog.yaml',
        groups: ['G_PRD'],
      },
    },
  });
}

function provider(secrets: Record<string, unknown> = {}) {
  const conn = { host: 'db.invalid', port: '443', user: 'RO', password: 'synthetic-pw' };
  return createInMemoryCredentialProvider([
    { name: 'svc-dev', credentials: conn },
    { name: 'svc-prd', credentials: conn },
    {
      name: 'strahana-secrets',
      tags: ['strahana-secrets'],
      credentials: {
        signingKey: randomBytes(32).toString('base64'),
        apiKeys: [{ user: 'jdoe', keyHash: HASH, groups: ['G_DEV'] }],
        ...secrets,
      },
    },
  ]);
}

function failure(fn: () => unknown): SanitizedError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof SanitizedError, 'expected a SanitizedError');
    return err;
  }
  assert.fail('expected failure');
}

test('schema applies documented defaults to limits and productive', () => {
  const env = config().environments['DEV-SALES'];
  assert.ok(env);
  assert.equal(env.productive, false);
  assert.deepEqual(env.limits, {
    pageSize: 50,
    maxRows: 500,
    timeoutSeconds: 30,
    maxResponseBytes: 16384,
    rateLimitPerMinute: 30,
  });
});

test('schema rejects unknown keys, empty groups and pageSize above maxRows', () => {
  assert.throws(() => config({ surprise: true }));
  assert.throws(() => config({ groups: [] }));
  assert.throws(() => config({ limits: { pageSize: 600, maxRows: 500 } }));
  assert.throws(() => config({ kind: 'odata' }));
});

test('http mode loads every environment with its connection and the signing key', () => {
  const runtime = loadRuntimeConfig({ config: config(), credentials: provider(), mode: 'http' });
  assert.deepEqual(Object.keys(runtime.environments).sort(), ['DEV-SALES', 'PRD-SALES']);
  assert.equal(runtime.signingKey.length, 32);
  assert.equal(runtime.apiKeys.length, 1);
  assert.equal(runtime.environments['DEV-SALES']?.connection.encrypt, true);
});

test('stdio mode rejects productive environments and does not load their credentials', () => {
  const runtime = loadRuntimeConfig({ config: config(), credentials: provider(), mode: 'stdio' });
  assert.deepEqual(Object.keys(runtime.environments), ['DEV-SALES']);
  assert.deepEqual(runtime.rejectedProductive, ['PRD-SALES']);
});

test('stdio mode fails when only productive environments exist', () => {
  const only = configSchema.parse({
    environments: {
      PRD: {
        kind: 'hana',
        productive: true,
        service: 'svc-prd',
        schema: 'S',
        catalog: 'c',
        groups: ['G'],
      },
    },
  });
  const err = failure(() =>
    loadRuntimeConfig({ config: only, credentials: provider(), mode: 'stdio' }),
  );
  assert.equal(err.code, 'CONFIG_INVALID');
});

test('fails fast when a referenced service is not bound', () => {
  const err = failure(() =>
    loadRuntimeConfig({
      config: config(),
      credentials: createInMemoryCredentialProvider([]),
      mode: 'http',
    }),
  );
  assert.equal(err.code, 'CONFIG_INVALID');
});

test('fails fast on a missing connection service, naming it but not any secret', () => {
  const base = provider();
  const withoutDev = {
    ...base,
    byName: (name: string) => (name === 'svc-dev' ? undefined : base.byName(name)),
  };
  const err = failure(() =>
    loadRuntimeConfig({ config: config(), credentials: withoutDev, mode: 'http' }),
  );
  assert.match(err.message, /svc-dev/);
});

test('rejects a short signing key without echoing it', () => {
  const err = failure(() =>
    loadRuntimeConfig({
      config: config(),
      credentials: provider({ signingKey: 'c2hvcnQ=' }),
      mode: 'http',
    }),
  );
  assert.ok(!err.message.includes('c2hvcnQ='));
});

test('rejects malformed key hashes, duplicated users and empty key lists in http mode', () => {
  const bad = failure(() =>
    loadRuntimeConfig({
      config: config(),
      credentials: provider({ apiKeys: [{ user: 'u', keyHash: 'plaintext-key', groups: [] }] }),
      mode: 'http',
    }),
  );
  assert.ok(!bad.message.includes('plaintext-key'));
  assert.throws(() =>
    loadRuntimeConfig({
      config: config(),
      credentials: provider({
        apiKeys: [
          { user: 'u', keyHash: HASH, groups: [] },
          { user: 'u', keyHash: `sha256:${'b'.repeat(64)}`, groups: [] },
        ],
      }),
      mode: 'http',
    }),
  );
  assert.throws(() =>
    loadRuntimeConfig({ config: config(), credentials: provider({ apiKeys: [] }), mode: 'http' }),
  );
  assert.doesNotThrow(() =>
    loadRuntimeConfig({ config: config(), credentials: provider({ apiKeys: [] }), mode: 'stdio' }),
  );
});

test('connection credentials never appear in error messages', () => {
  const broken = createInMemoryCredentialProvider([
    { name: 'svc-dev', credentials: { host: 'db.invalid', password: 'synthetic-pw' } },
    {
      name: 'strahana-secrets',
      tags: ['strahana-secrets'],
      credentials: { signingKey: randomBytes(32).toString('base64'), apiKeys: [] },
    },
  ]);
  const err = failure(() =>
    loadRuntimeConfig({ config: config(), credentials: broken, mode: 'stdio' }),
  );
  assert.ok(!err.message.includes('synthetic-pw'));
});

test('readConfigFile validates a file and reports missing or invalid ones in one line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'strahana-cfg-'));
  const good = join(dir, 'ok.json');
  writeFileSync(good, readFileSync('strahana.config.example.json'));
  assert.ok(readConfigFile(good).environments['DEV-SALES']);

  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.equal(failure(() => readConfigFile(bad)).code, 'CONFIG_INVALID');
  assert.equal(failure(() => readConfigFile(join(dir, 'missing.json'))).code, 'CONFIG_INVALID');

  const empty = join(dir, 'empty.json');
  writeFileSync(empty, '{"environments":{}}');
  assert.equal(failure(() => readConfigFile(empty)).code, 'CONFIG_INVALID');
});

test('the shipped example config is valid', () => {
  assert.ok(readConfigFile('strahana.config.example.json'));
  assert.ok(readConfigFile('strahana.config.json'));
});
