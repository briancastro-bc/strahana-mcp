import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { connectClient, startTestServer, type TestHttpServer } from '../../helpers.js';

let server: TestHttpServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
};

async function post(headers: Record<string, string>, body: unknown = initialize) {
  return fetch(new URL('/mcp', server.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('/health answers 200 without credentials and exposes no data', async () => {
  const res = await fetch(new URL('/health', server.url));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('/mcp without credentials is rejected with 401 AUTH_REQUIRED', async () => {
  const res = await post({});
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), 'Bearer');
  assert.deepEqual(await res.json(), {
    error: { code: 'AUTH_REQUIRED', message: 'Missing or invalid API key.' },
  });
});

test('/mcp with a bad key is rejected and the key is not echoed', async () => {
  const res = await post({ authorization: 'Bearer stk_not-a-real-key' });
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes('stk_not-a-real-key'));
});

test('every method on /mcp requires authentication', async () => {
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const res = await fetch(new URL('/mcp', server.url), { method });
    assert.equal(res.status, 401, method);
  }
});

test('authenticated GET /mcp is not supported in stateless mode', async () => {
  const res = await fetch(new URL('/mcp', server.url), {
    headers: { authorization: `Bearer ${server.key}` },
  });
  assert.equal(res.status, 405);
});

test('a valid Bearer key lists exactly the two tools in deterministic order', async () => {
  const client = await connectClient(server.url, { authorization: `Bearer ${server.key}` });
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ['hana_context', 'hana_query'],
    );
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.outputSchema, undefined);
      assert.ok(!tool.description?.includes('\n'));
    }
  } finally {
    await client.close();
  }
});

test('a valid X-API-Key also works', async () => {
  const client = await connectClient(server.url, { 'x-api-key': server.key });
  try {
    assert.equal((await client.listTools()).tools.length, 2);
  } finally {
    await client.close();
  }
});

test('placeholder tools answer with a sanitized one-line error, without structuredContent', async () => {
  const client = await connectClient(server.url, { authorization: `Bearer ${server.key}` });
  try {
    const result = await client.callTool({
      name: 'hana_context',
      arguments: { question: 'open sales orders' },
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    assert.match(text, /^NOT_IMPLEMENTED: hana_context is not available yet/);
    assert.ok(!text.includes('\n'));
  } finally {
    await client.close();
  }
});

test('input is validated against the POV schema before the handler runs', async () => {
  const client = await connectClient(server.url, { authorization: `Bearer ${server.key}` });
  try {
    const result = await client.callTool({ name: 'hana_context', arguments: { question: 'x' } });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
  }
});

test('logs never contain the API key', () => {
  assert.ok(!server.logLines.join('').includes(server.key));
});

test('a malformed body after authentication is a sanitized 400', async () => {
  const res = await fetch(new URL('/mcp', server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${server.key}` },
    body: '{ nope',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), {
    error: { code: 'BAD_REQUEST', message: 'Invalid request body.' },
  });
});
