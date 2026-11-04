/** Validation failures of `hana_query` (POV 4.4, 6.3). `CONTEXT_INVALID` is decided elsewhere. */
export type SqlRejectionCode =
  | 'SQL_PARSE'
  | 'SQL_NOT_SELECT'
  | 'SQL_ENTITY_NOT_IN_CONTEXT'
  | 'SQL_ENTITY_UNAVAILABLE'
  | 'SQL_UNKNOWN_COLUMN'
  | 'SQL_AMBIGUOUS_COLUMN'
  | 'SQL_FORBIDDEN';

/**
 * A rejected SQL. The message is one line with the cause and the fix. It may quote identifiers
 * of the statement (never literals), so the LLM can correct it in one attempt.
 */
export class SqlRejection extends Error {
  readonly code: SqlRejectionCode;

  constructor(code: SqlRejectionCode, message: string) {
    // One line, always: identifiers echoed from the statement may contain line breaks.
    super(message.replace(/\s+/g, ' ').trim());
    this.name = 'SqlRejection';
    this.code = code;
  }
}

export const reject = {
  parse: (detail: string): SqlRejection => new SqlRejection('SQL_PARSE', detail),
  notSelect: (detail = 'Only SELECT statements are allowed.'): SqlRejection =>
    new SqlRejection('SQL_NOT_SELECT', detail),
  forbidden: (detail: string): SqlRejection => new SqlRejection('SQL_FORBIDDEN', detail),
};
