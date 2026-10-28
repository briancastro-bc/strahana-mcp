import type { Column } from './catalog.js';
import type { ContextEntity, ContextSelection } from './context-selection.js';
import { columnTypeCode } from './type-code.js';

/** Fixed rules line of POV 4.2. It is paid once per context, not per turn. */
export const CONTEXT_RULES_LINE =
  'rules: SELECT only; list columns (no *); no LIMIT/TOP (use limit); prefer GROUP BY';

const SEPARATOR = ' · ';

export interface ContextHeader {
  contextId: string;
  environment: string;
  ttlMinutes: number;
}

function quote(text: string): string {
  return `"${text.replaceAll('"', "'")}"`;
}

function renderColumn(column: Column): string {
  const parts = [column.name, columnTypeCode(column)];
  if (column.key) parts.push('PK');
  // A label that repeats the physical name carries no information: skip its tokens.
  if (column.label.toLowerCase() !== column.name.toLowerCase()) parts.push(quote(column.label));
  return parts.join(' ');
}

function renderEntity({ entity, columns, hiddenColumns, joins }: ContextEntity): string[] {
  const cells = columns.map(renderColumn);
  if (hiddenColumns > 0) cells.push(`+${hiddenColumns} cols`);
  const lines = [`${entity.name} ${quote(entity.label)}`, `  ${cells.join(SEPARATOR)}`];
  for (const join of joins) {
    const on = join.on.map((pair) => `${pair.from}=${pair.to}`).join(' AND ');
    lines.push(`  join ${join.entity} ON ${on}`);
  }
  for (const rule of entity.rules) lines.push(`  rule: ${rule}`);
  return lines;
}

/** Renders the exact compact format of POV 4.2. Synonyms are never part of it. */
export function renderContext(selection: ContextSelection, header: ContextHeader): string {
  const lines = [`ctx=${header.contextId} env=${header.environment} ttl=${header.ttlMinutes}m`];
  for (const entity of selection.entities) lines.push(...renderEntity(entity));
  lines.push(CONTEXT_RULES_LINE);
  return lines.join('\n');
}
