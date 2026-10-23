import { z } from 'zod';
import type { ToolDefinition } from './tool-definition.js';

interface JsonProperty {
  type?: string;
  items?: { type?: string };
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
}

interface JsonObjectSchema {
  properties?: Record<string, JsonProperty>;
  required?: string[];
}

function typeOf(property: JsonProperty): string {
  return property.type === 'array'
    ? `${property.items?.type ?? 'any'}[]`
    : (property.type ?? 'any');
}

function constraintsOf(property: JsonProperty): string {
  const parts: string[] = [];
  if (property.minLength !== undefined) parts.push(`min length ${property.minLength}`);
  if (property.maxLength !== undefined) parts.push(`max length ${property.maxLength}`);
  if (property.minimum !== undefined) parts.push(`min ${property.minimum}`);
  if (property.maximum !== undefined && property.maximum !== Number.MAX_SAFE_INTEGER)
    parts.push(`max ${property.maximum}`);
  if (property.maxItems !== undefined) parts.push(`max items ${property.maxItems}`);
  return parts.length > 0 ? parts.join(', ') : '-';
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|');
}

/**
 * Renders docs/tools.md from the tool catalog. Pure and deterministic: a drift test compares the
 * committed file with this output.
 */
export function renderToolsDoc(tools: readonly ToolDefinition[]): string {
  const lines: string[] = [
    '# Herramientas MCP',
    '',
    '> Archivo generado con `pnpm docs:tools` a partir del catálogo de herramientas',
    '> (`src/hana/mcp/tool-catalog.ts`). No editar a mano: una prueba de deriva falla si no coincide.',
    '',
    'Todas las herramientas son de solo lectura (`readOnlyHint: true`). Las descripciones están en',
    'inglés a propósito: son el texto que recibe el LLM en cada turno.',
    '',
  ];
  for (const tool of tools) {
    const schema = z.toJSONSchema(z.object(tool.inputShape)) as JsonObjectSchema;
    const required = new Set(schema.required ?? []);
    lines.push(
      `## \`${tool.name}\``,
      '',
      `**Descripción:** ${escapeCell(tool.description)}`,
      '',
      '| Parámetro | Tipo | Obligatorio | Restricciones |',
      '|-----------|------|-------------|---------------|',
    );
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      lines.push(
        `| \`${name}\` | ${typeOf(property)} | ${required.has(name) ? 'sí' : 'no'} | ${constraintsOf(property)} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
