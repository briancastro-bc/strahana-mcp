import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { start } from '../../../src/bootstrap.js';
import { verifyContextId } from '../../../src/hana/catalog/application/verify-context-id.js';
import { HmacContextIdCodec } from '../../../src/hana/catalog/infrastructure/hmac-context-id-codec.js';
import { issueApiKey } from '../../../src/platform/auth/api-key.js';
import { createInMemoryCredentialProvider } from '../../../src/platform/config/credential-provider.js';
import { connectClient, silentLogger } from '../../helpers.js';
import { parseContext } from '../catalog/context-text.js';

/** Boots the real composition root (config, catalog, HTTP, auth) with synthetic credentials. */
async function boot() {
  const signingKey = randomBytes(32);
  const analyst = issueApiKey({ user: 'jdoe', groups: ['STRAHANA_DEV_SALES'] });
  const outsider = issueApiKey({ user: 'eve', groups: ['SOME_OTHER_GROUP'] });
  const lines: string[] = [];
  const credentials = createInMemoryCredentialProvider([
    {
      name: 'strahana-dev-sales',
      credentials: { host: 'db.invalid', port: '443', user: 'RO', password: 'synthetic-pw' },
    },
    {
      name: 'strahana-secrets',
      tags: ['strahana-secrets'],
      credentials: {
        signingKey: signingKey.toString('base64'),
        apiKeys: [analyst.entry, outsider.entry],
      },
    },
  ]);
  const app = await start(
    { mode: 'http', configPath: 'strahana.config.example.json', envFile: 'unused', port: 0 },
    { credentials, logger: silentLogger(lines), host: '127.0.0.1' },
  );
  return {
    app,
    lines,
    signingKey,
    analyst,
    outsider,
    url: new URL(`http://127.0.0.1:${app.port ?? 0}`),
  };
}

test('hana_context over MCP HTTP: valid key gets a compact context and a verifiable context_id', async () => {
  const server = await boot();
  try {
    const client = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const result = await client.callTool({
      name: 'hana_context',
      arguments: { question: '¿Cuántos pedidos hay por cliente y país?' },
    });
    assert.ok(!result.isError);
    assert.equal(result['structuredContent'], undefined);
    const content = result.content as { type: string; text: string }[];
    assert.equal(content.length, 1);
    const [block] = content;
    assert.ok(block);
    assert.equal(block.type, 'text');
    const parsed = parseContext(block.text);
    assert.equal(parsed.environment, 'DEV-SALES');
    assert.ok(parsed.entities.has('COM_ACME_SALES_ORDERS'));
    assert.ok(parsed.entities.has('COM_ACME_SALES_CUSTOMERS'));
    assert.ok(parsed.joins.includes('join COM_ACME_SALES_CUSTOMERS ON CUSTOMER_ID=ID'));

    // The id is bound to the user, so phase 3 can verify it with the configured key.
    const codec = new HmacContextIdCodec({ key: server.signingKey });
    const claims = verifyContextId(codec, parsed.contextId, {
      userId: 'jdoe',
      catalogVersionOf: () => codec.open(parsed.contextId)?.catalogVersion,
    });
    assert.deepEqual(claims.entities, [...parsed.entities.keys()]);
    assert.throws(() =>
      verifyContextId(codec, parsed.contextId, {
        userId: 'eve',
        catalogVersionOf: () => claims.catalogVersion,
      }),
    );

    // Progressive disclosure keeps the single-block, no-structuredContent contract.
    const detail = await client.callTool({
      name: 'hana_context',
      arguments: { question: 'detalle de pedidos', entities: ['COM_ACME_SALES_ORDERS'] },
    });
    assert.ok(!detail.isError);
    assert.equal(
      parseContext((detail.content as { text: string }[])[0]?.text ?? '').entities.size,
      1,
    );
    await client.close();

    const logs = server.lines.join('');
    assert.ok(!logs.includes(server.analyst.key));
    assert.ok(!logs.includes('synthetic-pw'));
    assert.ok(!logs.includes('pedidos por cliente'));
    assert.ok(logs.includes('"event":"context"'));
  } finally {
    await server.app.close();
  }
});

test('hana_context rejects a missing/invalid key, an unauthorized user and a disallowed environment', async () => {
  const server = await boot();
  try {
    await assert.rejects(connectClient(server.url, { authorization: 'Bearer stk_not-a-real-key' }));
    await assert.rejects(connectClient(server.url, {}));

    const outsider = await connectClient(server.url, {
      authorization: `Bearer ${server.outsider.key}`,
    });
    const denied = await outsider.callTool({
      name: 'hana_context',
      arguments: { question: 'pedidos por cliente' },
    });
    assert.equal(denied.isError, true);
    assert.match((denied.content as { text: string }[])[0]?.text ?? '', /^ENV_FORBIDDEN: /);
    await outsider.close();

    const analyst = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const other = await analyst.callTool({
      name: 'hana_context',
      arguments: { question: 'pedidos por cliente', environment: 'QAS-SALES' },
    });
    assert.equal(other.isError, true);
    assert.equal(
      (other.content as { text: string }[])[0]?.text,
      'ENV_FORBIDDEN: No access to environment QAS-SALES.',
    );
    const sql = await analyst.callTool({
      name: 'hana_context',
      arguments: { question: 'SELECT * FROM COM_ACME_SALES_ORDERS' },
    });
    assert.match((sql.content as { text: string }[])[0]?.text ?? '', /^QUESTION_IS_SQL: /);
    await analyst.close();
  } finally {
    await server.app.close();
  }
});

test('startup fails closed when the environment catalog is invalid or missing', async () => {
  const credentials = createInMemoryCredentialProvider([
    { name: 'strahana-dev-sales', credentials: { host: 'h', port: '1', user: 'u', password: 'p' } },
    {
      name: 'strahana-secrets',
      tags: ['strahana-secrets'],
      credentials: {
        signingKey: randomBytes(32).toString('base64'),
        apiKeys: [issueApiKey({ user: 'jdoe', groups: ['G'] }).entry],
      },
    },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'strahana-'));
  writeFileSync(join(dir, 'bad.catalog.yaml'), 'domain: x\nversion: 1\nlabel: X\nentities: []\n');
  const config = {
    environments: {
      'DEV-SALES': {
        kind: 'hana',
        service: 'strahana-dev-sales',
        schema: 'S',
        catalog: join(dir, 'bad.catalog.yaml'),
        groups: ['G'],
      },
    },
  };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  await assert.rejects(
    start(
      { mode: 'http', configPath: join(dir, 'config.json'), envFile: 'unused', port: 0 },
      { credentials, logger: silentLogger() },
    ),
    /Invalid configuration: catalog .*bad\.catalog\.yaml: entities/,
  );
});
