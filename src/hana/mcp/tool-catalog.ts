import { z } from 'zod';
import { errors } from '../../platform/errors/sanitized-error.js';
import {
  defineTool,
  type ToolContext,
  type ToolDefinition,
} from '../../platform/mcp/tool-definition.js';

export const contextInputShape = {
  question: z.string().min(3).max(300),
  environment: z.string().optional(),
  entities: z.array(z.string()).max(5).optional(),
};

export type ContextToolInput = z.infer<z.ZodObject<typeof contextInputShape>>;

export type ContextToolHandler = (input: ContextToolInput, context: ToolContext) => Promise<string>;

export const queryInputShape = {
  sql: z.string().max(4000),
  context_id: z.string(),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
};

export type QueryToolInput = z.infer<z.ZodObject<typeof queryInputShape>>;

export type QueryToolHandler = (input: QueryToolInput, context: ToolContext) => Promise<string>;

export interface HanaToolHandlers {
  /** `hana_context` (phase 2). Without it the tool answers NOT_IMPLEMENTED. */
  context?: ContextToolHandler;
  /** `hana_query` (phase 3). Without it the tool answers NOT_IMPLEMENTED. */
  query?: QueryToolHandler;
}

/**
 * Single tool catalog of the HANA context (POV 4.1). The order is part of the contract:
 * `tools/list` must stay deterministic. Descriptions, schemas and docs/tools.md derive from here;
 * only the handlers are injected. A tool without its handler answers NOT_IMPLEMENTED.
 */
export function createHanaTools(handlers: HanaToolHandlers = {}): readonly ToolDefinition[] {
  return [
    defineTool({
      name: 'hana_context',
      description:
        'Get the SAP HANA tables/views and columns relevant to a business question. Call before hana_query.',
      inputShape: contextInputShape,
      handler: handlers.context ?? (() => Promise.reject(errors.notImplemented('hana_context', 2))),
    }),
    defineTool({
      name: 'hana_query',
      description:
        'Run a read-only SELECT using only objects from a hana_context result. Returns TSV.',
      inputShape: queryInputShape,
      handler: handlers.query ?? (() => Promise.reject(errors.notImplemented('hana_query', 3))),
    }),
  ];
}

/** The catalog without handlers: enough for `tools/list`, docs and drift tests. */
export const hanaTools: readonly ToolDefinition[] = createHanaTools();
