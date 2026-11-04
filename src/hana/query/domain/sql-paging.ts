/**
 * Appends the server-controlled `LIMIT`/`OFFSET` to a validated statement. The validated text
 * has no LIMIT, OFFSET, comments or semicolons, so a plain suffix is always well formed and the
 * original text is never regenerated (POV 6.1 point 4).
 */
export function appendPaging(validatedSql: string, limit: number, offset: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be >= 1');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('offset must be >= 0');
  return `${validatedSql} LIMIT ${limit} OFFSET ${offset}`;
}
