import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { start, parseCliArgs } from '../src/bootstrap.js';
import { issueApiKey } from '../src/platform/auth/api-key.js';
import { createInMemoryCredentialProvider } from '../src/platform/config/credential-provider.js';
import { SanitizedError } from '../src/platform/errors/sanitized-error.js';
import { connectClient, silentLogger } from './helpers.js';

test('parseCliArgs defaults to http, the shipped config files and PORT', () => {
  assert.deepEqual(parseCliArgs([], { PORT: '9090' }), {
    mode: 'http',
    configPath: 'strahana.config.json',
    envFile: 'default-env.json',
    port: 9090,
  });
  assert.equal(parseCliArgs(['--transport', 'stdio'], {}).mode, 'stdio');
  assert.equal(parseCliArgs(['--port', '0'], {}).port, 0);
});

test('parseCliArgs rejects unknown transports, options and ports', () => {
  for (const argv of [['--transport', 'ws'], ['--nope'], ['--port', 'abc'], ['--port', '70000']]) {
    assert.throws(() => parseCliArgs(argv, {}), SanitizedError);
  }
});

test('start (http) boots from config + credentials and serves the two tools to a valid key', async () => {
  const issued = issueApiKey({ user: 'jdoe', groups: ['STRAHANA_DEV_SALES'] });
  const credentials = createInMemoryCredentialProvider([
    {
      name: 'strahana-dev-sales',
      credentials: { host: 'db.invalid', port: '443', user: 'RO', password: 'synthetic' },
    },
    {
      name: 'strahana-secrets',
      tags: ['strahana-secrets'],
      credentials: { signingKey: randomBytes(32).toString('base64'), apiKeys: [issued.entry] },
    },
  ]);
  const app = await start(
    { mode: 'http', configPath: 'strahana.config.example.json', envFile: 'unused', port: 0 },
    { credentials, logger: silentLogger(), host: '127.0.0.1' },
  );
  try {
    assert.ok(app.port && app.port > 0);
    const url = new URL(`http://127.0.0.1:${app.port}`);
    const client = await connectClient(url, { authorization: `Bearer ${issued.key}` });
    assert.equal((await client.listTools()).tools.length, 2);
    await client.close();
  } finally {
    await app.close();
  }
});

test('start fails fast with a sanitized error when secrets are missing', async () => {
  await assert.rejects(
    start(
      { mode: 'http', configPath: 'strahana.config.example.json', envFile: 'unused', port: 0 },
      { credentials: createInMemoryCredentialProvider([]), logger: silentLogger() },
    ),
    (err: unknown) => err instanceof SanitizedError && err.code === 'CONFIG_INVALID',
  );
});
