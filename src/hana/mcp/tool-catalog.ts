import { z } from 'zod';
import { errors } from '../../platform/errors/sanitized-error.js';
import { defineTool, type ToolDefinition } from '../../platform/mcp/tool-definition.js';

/**
 * Single tool catalog of the HANA context (POV 4.1). The order is part of the contract:
 * `tools/list` must stay deterministic. Handlers are placeholders until phases 2 and 3.
 */
export const hanaTools: readonly ToolDefinition[] = [
  defineTool({
    name: 'hana_context',
    description:
      'Get the SAP HANA tables/views and columns relevant to a business question. Call before hana_query.',
    inputShape: {
      question: z.string().min(3).max(300),
      environment: z.string().optional(),
      entities: z.array(z.string()).max(5).optional(),
    },
    handler: () => Promise.reject(errors.notImplemented('hana_context', 2)),
  }),
  defineTool({
    name: 'hana_query',
    description:
      'Run a read-only SELECT using only objects from a hana_context result. Returns TSV.',
    inputShape: {
      sql: z.string().max(4000),
      context_id: z.string(),
      limit: z.number().int().min(1).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: () => Promise.reject(errors.notImplemented('hana_query', 3)),
  }),
];
