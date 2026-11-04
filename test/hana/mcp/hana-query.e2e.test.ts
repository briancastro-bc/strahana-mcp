import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { start } from '../../../src/bootstrap.js';
import type { ExecuteRequest, SqlExecutor } from '../../../src/hana/query/application/ports.js';
import type { ResultTable } from '../../../src/hana/query/domain/result-formatter.js';
import { issueApiKey } from '../../../src/platform/auth/api-key.js';
import { createInMemoryCredentialProvider } from '../../../src/platform/config/credential-provider.js';
import { errors } from '../../../src/platform/errors/sanitized-error.js';
import { sha256Hex } from '../../../src/platform/security/hmac.js';
import { connectClient, silentLogger } from '../../helpers.js';
import { parseContext } from '../catalog/context-text.js';

const ORDERS = 'COM_ACME_SALES_ORDERS';
const CUSTOMERS = 'COM_ACME_SALES_CUSTOMERS';

/** In-memory database stand-in: 120 synthetic orders, sliced by the LIMIT/OFFSET suffix. */
class FakeDatabase implements SqlExecutor {
  readonly calls: ExecuteRequest[] = [];
  failWith: Error | undefined;
  readonly rows = Array.from({ length: 120 }, (_, i) => [
    `SO-${String(i).padStart(5, '0')}`,
    `Customer ${i % 17}`,
    (1000 + i * 12.5).toFixed(2),
    'EUR',
  ]);

  execute(request: ExecuteRequest): Promise<ResultTable> {
    this.calls.push(request);
    if (this.failWith) return Promise.reject(this.failWith);
    const match = / LIMIT (\d+) OFFSET (\d+)$/.exec(request.sql);
    assert.ok(match, 'paging suffix expected');
    const limit = Number(match[1]);
    const offset = Number(match[2]);
    return Promise.resolve({
      columns: ['ORDERNUMBER', 'NAME', 'TOTALAMOUNT', 'CURRENCY_CODE'],
      rows: this.rows.slice(offset, offset + limit),
    });
  }
}

interface BootOptions {
  maxResponseBytes?: number;
}

async function boot(options: BootOptions = {}) {
  const signingKey = randomBytes(32);
  const analyst = issueApiKey({ user: 'jdoe', groups: ['STRAHANA_DEV_SALES'] });
  const outsider = issueApiKey({ user: 'eve', groups: ['SOME_OTHER_GROUP'] });
  const lines: string[] = [];
  const database = new FakeDatabase();
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
  let configPath = 'strahana.config.example.json';
  if (options.maxResponseBytes !== undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'strahana-q-'));
    configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          'DEV-SALES': {
            kind: 'hana',
            service: 'strahana-dev-sales',
            schema: 'SALES_HDI_DB_1',
            catalog: 'catalog/sales.catalog.yaml',
            groups: ['STRAHANA_DEV_SALES'],
            limits: { maxResponseBytes: options.maxResponseBytes },
          },
        },
      }),
    );
  }
  const app = await start(
    { mode: 'http', configPath, envFile: 'unused', port: 0 },
    { credentials, logger: silentLogger(lines), host: '127.0.0.1', executor: database },
  );
  return {
    app,
    lines,
    database,
    analyst,
    outsider,
    url: new URL(`http://127.0.0.1:${app.port ?? 0}`),
  };
}

async function text(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  assert.equal(content.length, 1);
  assert.equal(content[0]?.type, 'text');
  assert.equal(result['structuredContent'], undefined, 'no structuredContent (POV 4.3)');
  return { isError: result.isError === true, text: content[0].text };
}

async function contextId(client: Client, args: Record<string, unknown> = {}): Promise<string> {
  const context = await text(client, 'hana_context', { question: 'pedidos por cliente', ...args });
  assert.equal(context.isError, false);
  return parseContext(context.text).contextId;
}

const QUERY = `SELECT o.ORDERNUMBER, c.NAME, o.TOTALAMOUNT, o.CURRENCY_CODE FROM ${ORDERS} o JOIN ${CUSTOMERS} c ON c.ID = o.CUSTOMER_ID ORDER BY o.ORDERNUMBER`;

test('hana_context -> hana_query over MCP HTTP: compact TSV, server paging, no structuredContent', async () => {
  const server = await boot();
  try {
    const client = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const id = await contextId(client);
    const result = await text(client, 'hana_query', { sql: QUERY, context_id: id, limit: 3 });
    assert.equal(result.isError, false);
    assert.deepEqual(result.text.split('\n'), [
      'rows=3 more=yes next_offset=3',
      'ORDERNUMBER\tNAME\tTOTALAMOUNT\tCURRENCY_CODE',
      'SO-00000\tCustomer 0\t1000.00\tEUR',
      'SO-00001\tCustomer 1\t1012.50\tEUR',
      'SO-00002\tCustomer 2\t1025.00\tEUR',
    ]);
    assert.equal(server.database.calls[0]?.sql, `${QUERY} LIMIT 4 OFFSET 0`);
    assert.equal(server.database.calls[0].environment, 'DEV-SALES');
    await client.close();
  } finally {
    await server.app.close();
  }
});

test('pagination over MCP: repeat the call with next_offset until more=no', async () => {
  const server = await boot();
  try {
    const client = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const id = await contextId(client);
    let offset = 0;
    let rows = 0;
    const seen = new Set<string>();
    for (let guard = 0; guard < 10; guard++) {
      const page = await text(client, 'hana_query', {
        sql: QUERY,
        context_id: id,
        limit: 50,
        offset,
      });
      assert.equal(page.isError, false);
      const lines = page.text.split('\n');
      const status = /^rows=(\d+) more=(yes|no)(?: next_offset=(\d+))?$/.exec(lines[0] ?? '');
      assert.ok(status, lines[0]);
      rows += Number(status[1]);
      for (const line of lines.slice(2)) seen.add(line.split('\t')[0] ?? '');
      if (status[2] === 'no') break;
      offset = Number(status[3]);
    }
    assert.equal(rows, 120);
    assert.equal(seen.size, 120, 'no row repeated or skipped across pages');
    await client.close();
  } finally {
    await server.app.close();
  }
});

test('invalid context_id, forbidden SQL and tables outside the context are rejected before the database', async () => {
  const server = await boot();
  try {
    const client = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const id = await contextId(client, { entities: [CUSTOMERS] });

    const invalid = await text(client, 'hana_query', { sql: QUERY, context_id: 'nope' });
    assert.equal(invalid.isError, true);
    assert.equal(
      invalid.text,
      'CONTEXT_INVALID: context_id expired or invalid. Call hana_context again.',
    );

    const forbidden = [
      [
        `SELECT * FROM ${CUSTOMERS}`,
        /^SQL_FORBIDDEN: SELECT \* is not allowed; list the columns\.$/,
      ],
      [`DELETE FROM ${CUSTOMERS}`, /^SQL_NOT_SELECT: /],
      [`SELECT NAME FROM ${CUSTOMERS}; DROP TABLE ${CUSTOMERS}`, /^SQL_FORBIDDEN: /],
      [`SELECT TOP 5 NAME FROM ${CUSTOMERS}`, /^SQL_PARSE: Unsupported SQL near .*limit parameter/],
      [`SELECT NAMEE FROM ${CUSTOMERS}`, /^SQL_UNKNOWN_COLUMN: .*Did you mean NAME\?/],
      [
        `SELECT ID FROM ${ORDERS}`,
        new RegExp(
          `^SQL_ENTITY_NOT_IN_CONTEXT: ${ORDERS} is not in this context\\. Call hana_context with entities:\\["${ORDERS}"\\]\\.$`,
        ),
      ],
      [
        `SELECT ID FROM COM_ACME_HR_SALARIES`,
        /^SQL_ENTITY_UNAVAILABLE: COM_ACME_HR_SALARIES is not available in the catalog of DEV-SALES\.$/,
      ],
    ] as const;
    for (const [sql, expected] of forbidden) {
      const result = await text(client, 'hana_query', { sql, context_id: id });
      assert.equal(result.isError, true, sql);
      assert.match(result.text, expected, sql);
    }
    assert.equal(server.database.calls.length, 0, 'nothing reached the database');
    await client.close();
  } finally {
    await server.app.close();
  }
});

test('context_id of another user is invalid; a user without access is rejected', async () => {
  const server = await boot();
  try {
    const analyst = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const id = await contextId(analyst);
    const outsider = await connectClient(server.url, {
      authorization: `Bearer ${server.outsider.key}`,
    });
    const stolen = await text(outsider, 'hana_query', { sql: QUERY, context_id: id });
    assert.match(stolen.text, /^CONTEXT_INVALID: /);
    await assert.rejects(connectClient(server.url, { authorization: 'Bearer stk_nope' }));
    await analyst.close();
    await outsider.close();
  } finally {
    await server.app.close();
  }
});

test('database failures reach the client sanitized and are audited without values', async () => {
  const server = await boot();
  try {
    const client = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const id = await contextId(client);
    server.database.failWith = errors.dbTimeout(30);
    const timeout = await text(client, 'hana_query', { sql: QUERY, context_id: id });
    assert.equal(timeout.text, 'DB_TIMEOUT: Query exceeded 30s. Narrow the filters or aggregate.');
    server.database.failWith = new Error('ECONNRESET to 10.9.8.7 password=synthetic-pw');
    const internal = await text(client, 'hana_query', { sql: QUERY, context_id: id });
    assert.match(internal.text, /^INTERNAL_ERROR: /);
    assert.ok(!internal.text.includes('10.9.8.7'));
    await client.close();

    const audits = server.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record['event'] === 'audit');
    assert.equal(audits.length, 2);
    assert.equal(audits[0]?.['sqlHash'], sha256Hex(QUERY));
    assert.equal(audits[0]['user'], 'jdoe');
    assert.equal(audits[0]['env'], 'DEV-SALES');
    assert.equal(audits[0]['outcome'], 'DB_TIMEOUT');
    assert.equal(audits[1]?.['outcome'], 'INTERNAL_ERROR');
    const logs = server.lines.join('');
    assert.ok(!logs.includes('ORDERNUMBER'), 'no SQL text in logs');
    assert.ok(!logs.includes('synthetic-pw') && !logs.includes(server.analyst.key));
  } finally {
    await server.app.close();
  }
});

test('successful call audit: hash, rows, bytes, duration; never SQL text or row values', async () => {
  const server = await boot();
  try {
    const client = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const id = await contextId(client);
    const result = await text(client, 'hana_query', { sql: QUERY, context_id: id, limit: 5 });
    await client.close();
    const audit = server.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record['event'] === 'audit');
    assert.ok(audit);
    assert.equal(audit['rows'], 5);
    assert.equal(audit['bytes'], Buffer.byteLength(result.text));
    assert.equal(audit['outcome'], 'ok');
    assert.equal(typeof audit['durationMs'], 'number');
    const logs = server.lines.join('');
    assert.ok(!logs.includes('Customer 1') && !logs.includes('SO-0000'));
    assert.ok(!logs.includes(QUERY));
  } finally {
    await server.app.close();
  }
});

test('maxResponseBytes caps the page over MCP and next_offset resumes after the last shown row', async () => {
  const server = await boot({ maxResponseBytes: 1024 });
  try {
    const client = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const id = await contextId(client);
    const page = await text(client, 'hana_query', { sql: QUERY, context_id: id, limit: 100 });
    assert.equal(page.isError, false);
    assert.ok(Buffer.byteLength(page.text) <= 1024, `bytes=${Buffer.byteLength(page.text)}`);
    const lines = page.text.split('\n');
    const status = /^rows=(\d+) more=yes next_offset=(\d+)$/.exec(lines[0] ?? '');
    assert.ok(status);
    assert.equal(status[1], status[2]);
    assert.ok(Number(status[1]) < 100);
    assert.match(lines.at(-1) ?? '', /^notes: response capped at 1024 bytes/);
    await client.close();
  } finally {
    await server.app.close();
  }
});

test('token budget: a typical 50-row page stays within 1500 tokens (bytes / 4, POV 10.4)', async () => {
  const server = await boot();
  try {
    const client = await connectClient(server.url, {
      authorization: `Bearer ${server.analyst.key}`,
    });
    const id = await contextId(client);
    const page = await text(client, 'hana_query', { sql: QUERY, context_id: id });
    assert.equal(page.text.split('\n')[0], 'rows=50 more=yes next_offset=50');
    const tokens = Math.ceil(Buffer.byteLength(page.text) / 4);
    assert.ok(tokens <= 1500, `typical page is ~${tokens} tokens (budget 1500)`);
    await client.close();
  } finally {
    await server.app.close();
  }
});
