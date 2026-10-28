import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const connection = { host: 'db.invalid', port: '443', user: 'RO', password: 'synthetic' };

function writeFixtures(environments: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'strahana-stdio-'));
  const configPath = join(dir, 'strahana.config.json');
  const envFile = join(dir, 'default-env.json');
  writeFileSync(configPath, JSON.stringify({ environments }));
  writeFileSync(
    envFile,
    JSON.stringify({
      VCAP_SERVICES: {
        'user-provided': [
          { name: 'svc-dev', credentials: connection },
          { name: 'svc-prd', credentials: connection },
          {
            name: 'strahana-secrets',
            tags: ['strahana-secrets'],
            credentials: { signingKey: randomBytes(32).toString('base64') },
          },
        ],
      },
    }),
  );
  return { configPath, envFile };
}

const env = (service: string, productive: boolean) => ({
  kind: 'hana',
  productive,
  service,
  schema: 'SYNTH',
  catalog: 'catalog/sales.catalog.yaml',
  groups: ['G'],
});

test('stdio mode serves the two tools without authentication', async () => {
  const { configPath, envFile } = writeFixtures({ DEV: env('svc-dev', false) });
  const client = new Client({ name: 't', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        'dist/src/index.js',
        '--transport',
        'stdio',
        '--config',
        configPath,
        '--env-file',
        envFile,
      ],
      stderr: 'ignore',
    }),
  );
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ['hana_context', 'hana_query'],
    );
  } finally {
    await client.close();
  }
});

test('stdio mode refuses to start when only productive environments exist', async () => {
  const { configPath, envFile } = writeFixtures({ PRD: env('svc-prd', true) });
  const client = new Client({ name: 't', version: '0' });
  await assert.rejects(
    client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          'dist/src/index.js',
          '--transport',
          'stdio',
          '--config',
          configPath,
          '--env-file',
          envFile,
        ],
        stderr: 'ignore',
      }),
    ),
  );
});
