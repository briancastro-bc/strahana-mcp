import { SQL_MAX_LENGTH } from './sql-policy.js';
import { reject } from './sql-rejection.js';

export interface TextCheckResult {
  /**
   * The statement to parse and execute: the original text without its single trailing `;`
   * (and the whitespace after it). Without a trailing `;` it is the original text.
   */
  readonly statement: string;
  /** Contents of every double-quoted identifier of the statement. */
  readonly quotedIdentifiers: ReadonlySet<string>;
}

function isControl(code: number): boolean {
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
}

/**
 * Text pre-check, run before the parser (POV 6.1). The server executes the original text, so
 * anything the parser might read differently from HANA must be impossible to express:
 * comments, statement separators (one final top-level `;` is the only one tolerated and is
 * stripped), backslashes, backticks, `#` identifiers, control characters
 * and any non-ASCII character outside a quoted region (Unicode look-alikes of keywords or
 * operators). Quoted regions are string literals and double-quoted identifiers.
 */
export function checkSqlText(sql: string): TextCheckResult {
  if (sql.trim() === '') throw reject.parse('SQL is empty. Send a single SELECT statement.');
  if (sql.length > SQL_MAX_LENGTH) {
    throw reject.forbidden(`SQL has more than ${SQL_MAX_LENGTH} characters. Simplify the query.`);
  }
  const quotedIdentifiers = new Set<string>();
  let quote: "'" | '"' | undefined;
  let quoted = '';
  let end = sql.length;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql.charAt(i);
    const code = sql.charCodeAt(i);
    if (ch === '\\') throw reject.forbidden('Backslashes are not allowed in SQL.');
    if (isControl(code)) throw reject.forbidden('Control characters are not allowed in SQL.');
    if (quote !== undefined) {
      if (ch === quote) {
        if (sql.charAt(i + 1) === quote) {
          quoted += ch;
          i++;
        } else {
          if (quote === '"') quotedIdentifiers.add(quoted);
          quote = undefined;
          quoted = '';
        }
      } else {
        quoted += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ';') {
      // Only a final top-level `;` followed by nothing but whitespace is tolerated. A `;` inside
      // a quoted region never gets here: the quote state above consumed it.
      if (!/^[ \t\n\r]*$/.test(sql.slice(i + 1))) {
        throw reject.forbidden(
          'Only one statement is allowed; ";" is only accepted once, at the very end.',
        );
      }
      end = i;
      break;
    }
    if ((ch === '-' && sql.charAt(i + 1) === '-') || (ch === '/' && sql.charAt(i + 1) === '*')) {
      throw reject.forbidden('SQL comments are not allowed. Remove them.');
    }
    if (ch === '`' || ch === '#') {
      throw reject.forbidden(`Character ${ch} is not allowed outside quotes.`);
    }
    if (code > 0x7e) {
      throw reject.forbidden(
        'Non-ASCII characters are only allowed inside quotes. Use plain ASCII for keywords and names.',
      );
    }
  }
  if (quote !== undefined) throw reject.parse('Unterminated quote. Close every quote.');
  const statement = end === sql.length ? sql : sql.slice(0, end).trimEnd();
  if (statement.trim() === '') throw reject.parse('SQL is empty. Send a single SELECT statement.');
  return { statement, quotedIdentifiers };
}
