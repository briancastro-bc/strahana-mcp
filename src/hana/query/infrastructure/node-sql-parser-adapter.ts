import { createRequire } from 'node:module';
import type { Parser as ParserClass } from 'node-sql-parser';
import type { SqlParser } from '../domain/sql-parser.js';

// node-sql-parser is CommonJS without reliable named ESM exports: load it with require.
const require = createRequire(import.meta.url);
const { Parser } = require('node-sql-parser') as { Parser: new () => ParserClass };

/**
 * Adapter of the `SqlParser` port over `node-sql-parser` with the PostgreSQL grammar (double
 * quoted identifiers, LIMIT/OFFSET), which is the closest available to HANA (POV 6.1).
 */
export class NodeSqlParserAdapter implements SqlParser {
  private readonly parser = new Parser();

  parse(sql: string): unknown {
    return this.parser.astify(sql, { database: 'postgresql' });
  }
}
