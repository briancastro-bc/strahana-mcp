/**
 * Port: turns SQL text into the parser's AST (node-sql-parser, PostgreSQL grammar, in the MVP).
 * The AST is opaque to the application; the domain walks it with an allow-list.
 */
export interface SqlParser {
  /**
   * Returns the AST of the statement(s). Throws when the text does not parse; the thrown message
   * is only used to locate the problem and is never shown verbatim.
   */
  parse(sql: string): unknown;
}
