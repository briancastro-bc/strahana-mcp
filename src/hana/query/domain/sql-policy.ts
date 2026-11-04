/**
 * SQL policy of `hana_query` (POV 6.2). Everything not listed here is rejected: the validator
 * fails closed. Keep these lists explicit; adding an entry is a security decision.
 */

/** Maximum SQL length in characters (POV 3.2: `sql` <= 4000). */
export const SQL_MAX_LENGTH = 4000;

/** Maximum number of base tables referenced in the whole statement (subqueries included). */
export const MAX_TABLES = 4;

/** Maximum subquery nesting below the top-level SELECT. */
export const MAX_SUBQUERY_DEPTH = 2;

/**
 * Scalar functions allowed in expressions. All are pure: they compute from their arguments and
 * never read data, session state or the system catalog. Aggregates are listed separately.
 * Functions the spike flagged as policy gaps (TO_VARCHAR, LOCATE) are included on purpose.
 */
export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  // text
  'UPPER',
  'LOWER',
  'LENGTH',
  'TRIM',
  'LTRIM',
  'RTRIM',
  'SUBSTRING',
  'SUBSTR',
  'CONCAT',
  'REPLACE',
  'LEFT',
  'RIGHT',
  'LPAD',
  'RPAD',
  'LOCATE',
  'INSTR',
  // numeric
  'ROUND',
  'FLOOR',
  'CEIL',
  'ABS',
  'MOD',
  'SIGN',
  'POWER',
  'SQRT',
  // null handling
  'COALESCE',
  'NULLIF',
  'IFNULL',
  // date and time
  'ADD_DAYS',
  'ADD_MONTHS',
  'ADD_YEARS',
  'ADD_SECONDS',
  'DAYS_BETWEEN',
  'SECONDS_BETWEEN',
  'MONTHS_BETWEEN',
  'YEAR',
  'MONTH',
  'DAYOFMONTH',
  'WEEK',
  'HOUR',
  'MINUTE',
  'SECOND',
  'DAYNAME',
  'MONTHNAME',
  'LAST_DAY',
  'CURRENT_DATE',
  'CURRENT_TIMESTAMP',
  'CURRENT_UTCDATE',
  'CURRENT_UTCTIMESTAMP',
  // conversion
  'TO_DATE',
  'TO_TIMESTAMP',
  'TO_VARCHAR',
  'TO_NVARCHAR',
  'TO_INTEGER',
  'TO_BIGINT',
  'TO_DECIMAL',
  'TO_DOUBLE',
]);

export const ALLOWED_AGGREGATES: ReadonlySet<string> = new Set([
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
]);

/** Binary operators. `||` is concatenation in HANA; PostgreSQL-only operators are not listed. */
export const ALLOWED_BINARY_OPERATORS: ReadonlySet<string> = new Set([
  '=',
  '<>',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '||',
  'AND',
  'OR',
  'LIKE',
  'NOT LIKE',
  'IN',
  'NOT IN',
  'IS',
  'IS NOT',
  'BETWEEN',
  'NOT BETWEEN',
]);

export const ALLOWED_UNARY_OPERATORS: ReadonlySet<string> = new Set([
  'NOT',
  'NOT EXISTS',
  '-',
  '+',
]);

/** `INNER`, `LEFT` joins (POV 6.2). Every join needs an `ON` condition. */
export const ALLOWED_JOIN_TYPES: ReadonlySet<string> = new Set([
  'INNER JOIN',
  'JOIN',
  'LEFT JOIN',
  'LEFT OUTER JOIN',
]);

/**
 * Target types of `CAST`. HANA-only types (NVARCHAR, SECONDDATE, DAYDATE, SMALLDECIMAL, NCLOB)
 * are absent because the PostgreSQL grammar of the parser cannot read them (known limitation).
 */
export const ALLOWED_CAST_TYPES: ReadonlySet<string> = new Set([
  'VARCHAR',
  'CHAR',
  'INTEGER',
  'INT',
  'BIGINT',
  'SMALLINT',
  'TINYINT',
  'DECIMAL',
  'NUMERIC',
  'REAL',
  'DOUBLE',
  'FLOAT',
  'DATE',
  'TIME',
  'TIMESTAMP',
]);

/** Literal node types of the parser that are plain values. */
export const LITERAL_TYPES: ReadonlySet<string> = new Set([
  'number',
  'single_quote_string',
  'string',
  'bool',
  'null',
]);

/** Object name prefixes that are never reachable, whatever the catalog says. */
export const SYSTEM_OBJECT_PATTERN = /^(SYS$|SYS_|_SYS_)/i;

/** Appended to the parse errors that come from HANA-only syntax the parser cannot read. */
export const UNSUPPORTED_SYNTAX_HINT =
  'Use CAST types VARCHAR, INTEGER, BIGINT, DECIMAL(p,s), DATE, TIMESTAMP and SUBSTRING(x, start, length); NVARCHAR, SECONDDATE, DAYDATE, SMALLDECIMAL, NCLOB and SUBSTRING(x FROM..) are not supported.';
