/** A cell as the executor port returns it. */
export type CellValue = string | number | bigint | boolean | Date | Uint8Array | null | undefined;

export interface ResultTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly CellValue[])[];
}

export interface FormatOptions {
  /** Offset of the first row of this page. */
  readonly offset: number;
  /** Rows requested for this page. */
  readonly limit: number;
  readonly maxResponseBytes: number;
  /** Extra notes decided by the caller (for example "no ORDER BY"). */
  readonly extraNotes?: readonly string[];
}

export interface FormattedResult {
  readonly text: string;
  /** Rows included in the text. */
  readonly rows: number;
  readonly more: boolean;
  readonly bytes: number;
}

/** Longer texts are cut with an ellipsis (POV 4.3). */
export const MAX_CELL_CHARS = 120;

export class ResponseTooSmallError extends Error {
  constructor(readonly maxResponseBytes: number) {
    super('A single row does not fit the response limit.');
    this.name = 'ResponseTooSmallError';
  }
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  return String(value);
}

/** Tabs, line breaks and backslashes inside values are escaped so one row stays one line. */
export function escapeCell(text: string): string {
  return text.replace(/[\\\t\n\r]/g, (ch) => {
    switch (ch) {
      case '\t':
        return '\\t';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      default:
        return '\\\\';
    }
  });
}

function truncate(text: string): { text: string; cut: boolean } {
  if (text.length <= MAX_CELL_CHARS) return { text, cut: false };
  let end = MAX_CELL_CHARS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--; // do not split a surrogate pair
  return { text: `${text.slice(0, end)}…`, cut: true };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function statusLine(rows: number, more: boolean, nextOffset: number): string {
  return more ? `rows=${rows} more=yes next_offset=${nextOffset}` : `rows=${rows} more=no`;
}

/**
 * Step 7 (POV 4.3, 10.4): `rows=N more=… next_offset=…`, a TSV with a header, and a `notes:` line
 * only when the server applied something. `table.rows` may hold one row more than `limit`, which
 * is how the executor reveals that another page exists. No total counts. The result never
 * exceeds `maxResponseBytes`; if even one row does not fit, `ResponseTooSmallError` is thrown.
 */
export function formatResult(table: ResultTable, options: FormatOptions): FormattedResult {
  const page = table.rows.slice(0, options.limit);
  const hasNextPage = table.rows.length > options.limit;

  // Columns that are empty in the whole page are omitted and reported.
  const keep: number[] = [];
  const omitted: string[] = [];
  table.columns.forEach((name, index) => {
    const empty = page.every((row) => cellText(row[index]) === '');
    if (empty && page.length > 0) omitted.push(name);
    else keep.push(index);
  });
  if (keep.length === 0) {
    // Every column is empty: keep them all so the page still shows its shape.
    keep.push(...table.columns.keys());
    omitted.length = 0;
  }

  const header = keep.map((index) => escapeCell(table.columns[index] ?? '')).join('\t');
  const cut: number[][] = []; // per row: indexes of kept columns that were truncated
  const lines = page.map((row) => {
    const truncated: number[] = [];
    const cells = keep.map((index) => {
      const result = truncate(cellText(row[index]));
      if (result.cut) truncated.push(index);
      return escapeCell(result.text);
    });
    cut.push(truncated);
    return cells.join('\t');
  });

  const build = (count: number): string => {
    const more = hasNextPage || count < page.length;
    const notes: string[] = [];
    const cutByColumn = new Map<number, number>();
    for (const row of cut.slice(0, count)) {
      for (const index of row) cutByColumn.set(index, (cutByColumn.get(index) ?? 0) + 1);
    }
    for (const [index, rows] of [...cutByColumn].sort((a, b) => a[0] - b[0])) {
      notes.push(
        `${escapeCell(table.columns[index] ?? '')} truncated to ${MAX_CELL_CHARS} chars in ${plural(rows, 'row')}`,
      );
    }
    if (omitted.length > 0)
      notes.push(`empty columns omitted: ${omitted.map(escapeCell).join(', ')}`);
    if (count < page.length) notes.push(`response capped at ${options.maxResponseBytes} bytes`);
    notes.push(...(options.extraNotes ?? []));
    const out = [statusLine(count, more, options.offset + count), header, ...lines.slice(0, count)];
    if (notes.length > 0) out.push(`notes: ${notes.join('; ')}`);
    return out.join('\n');
  };

  // Largest prefix whose rows fit, estimated from the row sizes, then confirmed with the notes.
  const fixed = Buffer.byteLength(header) + 128;
  let count = page.length;
  let used = fixed;
  for (let i = 0; i < lines.length; i++) {
    used += Buffer.byteLength(lines[i] ?? '') + 1;
    if (used > options.maxResponseBytes) {
      count = i;
      break;
    }
  }
  for (; count >= 0; count--) {
    const text = build(count);
    const bytes = Buffer.byteLength(text);
    if (bytes <= options.maxResponseBytes) {
      if (count === 0 && page.length > 0) throw new ResponseTooSmallError(options.maxResponseBytes);
      return { text, rows: count, more: hasNextPage || count < page.length, bytes };
    }
  }
  throw new ResponseTooSmallError(options.maxResponseBytes);
}
