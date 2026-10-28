import type { Column } from './catalog.js';

/** Compact type codes of POV 4.2: `s36`, `d15.2`, `i`, `bi`, `dt`, `ts`, `b`. */
export function columnTypeCode(column: Column): string {
  switch (column.type) {
    case 'string':
      return column.length === undefined ? 's' : `s${column.length}`;
    case 'decimal':
      return column.precision === undefined ? 'd' : `d${column.precision}.${column.scale ?? 0}`;
    case 'integer':
      return 'i';
    case 'bigint':
      return 'bi';
    case 'date':
      return 'dt';
    case 'timestamp':
      return 'ts';
    case 'boolean':
      return 'b';
  }
}
