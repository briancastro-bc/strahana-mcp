import type { z } from 'zod';
import type { Principal } from '../auth/principal.js';

export interface ToolContext {
  principal: Principal;
}

/** Transport-independent description of an MCP tool. One catalog feeds the server and the docs. */
export interface ToolDefinition {
  /** Prefixed by the owning bounded context, for example `hana_query`. */
  name: string;
  /** One line, in English: it is sent to the LLM on every turn. */
  description: string;
  inputShape: z.ZodRawShape;
  /** Resolves to the text returned to the LLM. Throw SanitizedError for expected failures. */
  handler: (input: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

/** Keeps the handler typed against its own input shape while storing it erased. */
export function defineTool<Shape extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  inputShape: Shape;
  handler: (input: z.infer<z.ZodObject<Shape>>, context: ToolContext) => Promise<string>;
}): ToolDefinition {
  return definition as unknown as ToolDefinition;
}
