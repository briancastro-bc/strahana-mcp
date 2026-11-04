import { SanitizedError, errors } from '../../../platform/errors/sanitized-error.js';

/**
 * HANA error codes that are safe to describe. The driver message is never forwarded: it can
 * quote values, object names, hosts or user names. Only the numeric code and a fixed text
 * written here reach the client.
 */
const KNOWN_CODES: Readonly<Record<number, string>> = {
  257: 'SQL syntax error. Simplify the statement.',
  258: 'insufficient privilege on an object. Ask for it to be added to the catalog role.',
  259: 'invalid table name.',
  260: 'invalid column name.',
  264: 'invalid datatype in an expression. Check CAST targets.',
  266: 'inconsistent datatypes. Compare values of the same type or use CAST.',
  274: 'value too large for its type.',
  301: 'unique constraint violated.',
  303: 'invalid use of a function or aggregate. Check GROUP BY and function arguments.',
  304: 'division by zero. Guard the divisor with NULLIF.',
  314: 'numeric overflow. Cast to a wider type.',
  339: 'invalid number or date conversion. Check CAST and literal formats.',
  2048: 'column store error. Retry with simpler filters.',
  129: 'transaction rolled back by an internal error. Retry.',
  131: 'transaction rolled back by lock wait timeout. Retry.',
  133: 'transaction rolled back by a deadlock. Retry.',
};

/** Connection and authentication failures: the cause is for administrators, not for the LLM. */
const UNAVAILABLE_CODES: ReadonlySet<number> = new Set([10, 18, -10709, -10108, -10104]);

const TIMEOUT_CODES: ReadonlySet<number> = new Set([139, 612]);

function codeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' && Number.isInteger(code) ? code : undefined;
}

export interface MapOptions {
  timeoutSeconds: number;
  /** The adapter's own timer fired before the driver answered. */
  timedOutLocally?: boolean;
}

/** Turns anything the driver throws into a `SanitizedError` without leaking its message. */
export function mapDriverError(error: unknown, options: MapOptions): SanitizedError {
  if (error instanceof SanitizedError) return error;
  if (options.timedOutLocally === true) return errors.dbTimeout(options.timeoutSeconds);
  const code = codeOf(error);
  if (code !== undefined && TIMEOUT_CODES.has(code))
    return errors.dbTimeout(options.timeoutSeconds);
  if (code !== undefined && UNAVAILABLE_CODES.has(code)) {
    return errors.dbError('Database unavailable. Retry later or contact an administrator.');
  }
  const known = code === undefined ? undefined : KNOWN_CODES[code];
  if (code !== undefined && known !== undefined) {
    return errors.dbError(`Database error ${code}: ${known}`);
  }
  return errors.dbError(
    code === undefined
      ? 'Database error. Simplify the query or retry later.'
      : `Database error ${code}. Simplify the query or retry later.`,
  );
}
