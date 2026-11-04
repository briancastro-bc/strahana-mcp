import { analyzeSql } from './sql-analyzer.js';
import { resolveReferences, type CatalogView } from './reference-resolver.js';
import type { SqlParser } from './sql-parser.js';

export interface ValidationInput {
  /** The statement exactly as the LLM sent it. It is the text that gets executed. */
  readonly sql: string;
  readonly parser: SqlParser;
  readonly catalog: CatalogView;
  /** Physical names of the entities of the verified `context_id`. */
  readonly contextEntities: ReadonlySet<string>;
  readonly environment: string;
}

export interface ValidatedSql {
  /** The original text, unchanged: the executor appends LIMIT/OFFSET to this exact string. */
  readonly sql: string;
  /** Physical entities used by the statement. */
  readonly tables: readonly string[];
  readonly hasOrderBy: boolean;
}

/**
 * Steps 5 of the flow (POV 6.2 and 6.3, rules 2 to 7): text pre-check, parse, policy walk, then
 * resolution of tables and columns against the context and the catalog. Throws `SqlRejection`
 * with the code of the violated rule. It never returns SQL regenerated from the AST.
 */
export function validateSql(input: ValidationInput): ValidatedSql {
  const analysis = analyzeSql(input.sql, input.parser);
  const tables = resolveReferences({
    analysis,
    catalog: input.catalog,
    contextEntities: input.contextEntities,
    environment: input.environment,
  });
  return { sql: input.sql, tables, hasOrderBy: analysis.hasOrderBy };
}
