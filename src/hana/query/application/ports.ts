import type { ResultTable } from '../domain/result-formatter.js';

export interface ExecuteRequest {
  readonly environment: string;
  /** The validated original text plus the server-generated LIMIT/OFFSET. */
  readonly sql: string;
  readonly timeoutSeconds: number;
}

/**
 * Port: runs one validated read-only statement in the environment's database and returns its
 * columns and rows. Implementations throw `SanitizedError` (`DB_TIMEOUT`, `DB_ERROR`) and never
 * put credentials, hosts, SQL text or row values in an error.
 */
export interface SqlExecutor {
  execute(request: ExecuteRequest): Promise<ResultTable>;
}
