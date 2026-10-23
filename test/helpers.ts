import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ApiKeyVerifier } from '../src/platform/auth/api-key-verifier.js';
import { issueApiKey } from '../src/platform/auth/api-key.js';
import { createLogger, type Logger } from '../src/platform/logging/logger.js';
import { createHttpApp, listen } from '../src/platform/mcp/http-app.js';
import { createMcpServer } from '../src/platform/mcp/create-mcp-server.js';
import type { ToolDefinition } from '../src/platform/mcp/tool-definition.js';
import { hanaTools } from '../src/hana/mcp/tool-catalog.js';

export function silentLogger(lines: string[] = []): Logger {
  return createLogger({ write: (line) => lines.push(line) });
}

export const serverInfo = { name: 'strahana', version: '0.0.0-test' };

export interface TestHttpServer {
  url: URL;
  key: string;
  logLines: string[];
  close: () => Promise<void>;
}

export async function startTestServer(
  tools: readonly ToolDefinition[] = hanaTools,
): Promise<TestHttpServer> {
  const logLines: string[] = [];
  const logger = silentLogger(logLines);
  const issued = issueApiKey({ user: 'jdoe', groups: ['G_DEV'] });
  const app = createHttpApp({
    verifier: new ApiKeyVerifier([issued.entry]),
    buildServer: (principal) => createMcpServer({ tools, principal, logger, serverInfo }),
    logger,
  });
  const server: Server = await listen(app, 0, '127.0.0.1');
  const { port } = server.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}`),
    key: issued.key,
    logLines,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export async function connectClient(url: URL, headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', url), { requestInit: { headers } }),
  );
  return client;
}
