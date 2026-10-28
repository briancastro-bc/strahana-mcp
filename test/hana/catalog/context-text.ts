/** Test helper: reads back the compact context format (POV 4.2) rendered by hana_context. */
export interface ParsedContext {
  contextId: string;
  environment: string;
  ttl: string;
  entities: Map<string, string[]>;
  joins: string[];
  rulesLine: string;
}

export function parseContext(text: string): ParsedContext {
  const lines = text.split('\n');
  const header = /^ctx=(\S+) env=(\S+) ttl=(\S+)$/.exec(lines[0] ?? '');
  if (header === null) throw new Error(`bad header: ${lines[0] ?? ''}`);
  const entities = new Map<string, string[]>();
  const joins: string[] = [];
  let current: string[] | undefined;
  for (const line of lines.slice(1)) {
    if (line.startsWith('rules:')) continue;
    if (line.startsWith('  join ')) joins.push(line.trim());
    else if (line.startsWith('  rule: ')) continue;
    else if (line.startsWith('  ')) {
      for (const cell of line.trim().split(' · ')) {
        if (!cell.startsWith('+')) current?.push(cell.split(' ')[0] ?? '');
      }
    } else {
      current = [];
      entities.set(line.split(' ')[0] ?? '', current);
    }
  }
  return {
    contextId: header[1] ?? '',
    environment: header[2] ?? '',
    ttl: header[3] ?? '',
    entities,
    joins,
    rulesLine: lines.at(-1) ?? '',
  };
}

/** Same approximation as POV 10.5: tokens ~= bytes / 4. */
export function approxTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text) / 4);
}
