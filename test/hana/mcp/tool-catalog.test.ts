import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { hanaTools } from '../../../src/hana/mcp/tool-catalog.js';
import { createMcpServer } from '../../../src/platform/mcp/create-mcp-server.js';
import { renderToolsDoc } from '../../../src/platform/mcp/tools-doc.js';
import { serverInfo, silentLogger } from '../../helpers.js';

async function listTools() {
  const server = createMcpServer({
    tools: hanaTools,
    principal: { userId: 'local', groups: [] },
    logger: silentLogger(),
    serverInfo,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

test('catalog has exactly the two hana_ tools, in order', () => {
  assert.deepEqual(
    hanaTools.map((t) => t.name),
    ['hana_context', 'hana_query'],
  );
  for (const tool of hanaTools) {
    assert.ok(tool.name.startsWith('hana_'));
    assert.ok(!tool.description.includes('\n'));
  }
});

test('tools/list matches the POV 4.1 input schemas', async () => {
  const tools = await listTools();
  const schemaOf = (name: string) => {
    const schema = tools.find((t) => t.name === name)?.inputSchema;
    assert.ok(schema);
    const props = schema.properties as Record<string, Record<string, unknown> | undefined>;
    return {
      required: schema.required,
      prop: (key: string) => {
        const found = props[key];
        assert.ok(found, `missing property ${key}`);
        return found;
      },
    };
  };
  const context = schemaOf('hana_context');
  assert.deepEqual(context.required, ['question']);
  assert.equal(context.prop('question')['minLength'], 3);
  assert.equal(context.prop('question')['maxLength'], 300);
  assert.equal(context.prop('entities')['maxItems'], 5);
  const query = schemaOf('hana_query');
  assert.deepEqual(query.required, ['sql', 'context_id']);
  assert.equal(query.prop('sql')['maxLength'], 4000);
  assert.equal(query.prop('limit')['minimum'], 1);
  assert.equal(query.prop('offset')['minimum'], 0);
});

test('token budget: both definitions together stay within 300 tokens', async () => {
  // Approximation documented in POV 10.5: tokens ~= bytes / 4 of the serialized definitions.
  const tools = await listTools();
  const bytes = Buffer.byteLength(JSON.stringify(tools));
  const approxTokens = Math.ceil(bytes / 4);
  assert.ok(approxTokens <= 300, `tools/list is ~${approxTokens} tokens (budget 300)`);
});

test('docs/tools.md is in sync with the catalog (run pnpm docs:tools to refresh)', () => {
  assert.equal(readFileSync('docs/tools.md', 'utf8'), renderToolsDoc(hanaTools));
});
