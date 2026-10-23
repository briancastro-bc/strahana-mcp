import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Principal } from '../auth/principal.js';
import { formatForClient, toSanitizedError } from '../errors/sanitized-error.js';
import type { Logger } from '../logging/logger.js';
import type { ToolDefinition } from './tool-definition.js';

export interface McpServerDeps {
  tools: readonly ToolDefinition[];
  principal: Principal;
  logger: Logger;
  serverInfo: { name: string; version: string };
}

/**
 * Builds an MCP server for one authenticated principal. The tool order is the catalog order, so
 * `tools/list` is deterministic. Expected failures reach the client as one sanitized line;
 * anything unexpected is replaced by a generic message and never leaks details.
 */
export function createMcpServer({
  tools,
  principal,
  logger,
  serverInfo,
}: McpServerDeps): McpServer {
  const server = new McpServer(serverInfo);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: { readOnlyHint: true },
      },
      async (input: Record<string, unknown>) => {
        const started = Date.now();
        try {
          const text = await tool.handler(input, { principal });
          logger.info('tool call', {
            tool: tool.name,
            user: principal.userId,
            outcome: 'ok',
            durationMs: Date.now() - started,
            bytes: Buffer.byteLength(text),
          });
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          const sanitized = toSanitizedError(error);
          logger.warn('tool call failed', {
            tool: tool.name,
            user: principal.userId,
            outcome: 'error',
            code: sanitized.code,
            durationMs: Date.now() - started,
          });
          return {
            isError: true,
            content: [{ type: 'text' as const, text: formatForClient(sanitized) }],
          };
        }
      },
    );
  }
  return server;
}
