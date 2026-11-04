import type { RunQuery } from '../query/application/run-query.js';
import type { QueryToolHandler } from './tool-catalog.js';

/**
 * Input adapter of `hana_query`: authentication is done by the transport; the use case runs the
 * guards, the validation, the execution and the audit record (user, environment, SQL hash, rows,
 * duration, outcome, bytes), so this only maps the tool input to the request.
 */
export function createQueryHandler(runQuery: RunQuery): QueryToolHandler {
  return (input, { principal }) =>
    runQuery({
      principal,
      sql: input.sql,
      contextId: input.context_id,
      limit: input.limit,
      offset: input.offset,
    });
}
