import { authorizeEnvironment } from '../../access/application/authorize-environment.js';
import { enforceRateLimit, type RateLimiter } from '../../access/application/rate-limiter.js';
import type { EnvironmentGrants } from '../../access/domain/environment-access.js';
import type { ContextIdCodec } from '../../catalog/application/ports.js';
import { verifyContextId } from '../../catalog/application/verify-context-id.js';
import type { Principal } from '../../../platform/auth/principal.js';
import { systemClock, type Clock } from '../../../platform/clock.js';
import {
  SanitizedError,
  errors,
  toSanitizedError,
} from '../../../platform/errors/sanitized-error.js';
import type { AuditSink } from '../../../platform/logging/logger.js';
import { sha256Hex } from '../../../platform/security/hmac.js';
import type { CatalogView } from '../domain/reference-resolver.js';
import { ResponseTooSmallError, formatResult } from '../domain/result-formatter.js';
import { appendPaging } from '../domain/sql-paging.js';
import type { SqlParser } from '../domain/sql-parser.js';
import { SqlRejection } from '../domain/sql-rejection.js';
import { validateSql } from '../domain/sql-validator.js';
import type { SqlExecutor } from './ports.js';

export interface QueryEnvironment extends EnvironmentGrants {
  readonly limits: {
    readonly pageSize: number;
    readonly maxRows: number;
    readonly timeoutSeconds: number;
    readonly maxResponseBytes: number;
    readonly rateLimitPerMinute: number;
  };
}

/** Structural view of a loaded catalog: the query context never imports the catalog's domain. */
export interface QueryCatalog {
  readonly version: string;
  readonly entities: readonly {
    readonly name: string;
    readonly columns: readonly { readonly name: string }[];
  }[];
}

export type QueryCatalogLookup = (environment: string) => { readonly catalog: QueryCatalog };

export interface RunQueryDeps {
  environments: Readonly<Record<string, QueryEnvironment>>;
  catalogs: QueryCatalogLookup;
  codec: ContextIdCodec;
  parser: SqlParser;
  executor: SqlExecutor;
  rateLimiter: RateLimiter;
  audit: AuditSink;
  clock?: Clock;
}

export interface QueryRequest {
  principal: Principal;
  sql: string;
  contextId: string;
  limit?: number | undefined;
  offset?: number | undefined;
}

function catalogViewOf(catalog: QueryCatalog): CatalogView {
  const byName = new Map(
    catalog.entities.map((entity) => [
      entity.name,
      { name: entity.name, columns: entity.columns.map((column) => column.name) },
    ]),
  );
  return {
    entity: (name) => byName.get(name),
    entityNames: () => [...byName.keys()],
  };
}

const NO_ORDER_NOTE = 'no ORDER BY, page order is not guaranteed';

/**
 * `hana_query` use case (flow steps 2, 5, 6 and 7): verifies the context, authorizes the
 * environment it was issued for, applies the rate limit, validates the SQL, executes the original
 * text with server-controlled paging and formats the compact result. Every call, successful or
 * not, writes one audit record with the user, environment, SQL hash, rows, duration, outcome and
 * bytes (never SQL text or values). Throws `SanitizedError`.
 */
export function createRunQuery(deps: RunQueryDeps) {
  const clock = deps.clock ?? systemClock;
  return async (request: QueryRequest): Promise<string> => {
    const started = clock.now().getTime();
    const sqlHash = sha256Hex(request.sql);
    let environment = '-';
    let rows = 0;
    let bytes = 0;
    let outcome = 'ok';
    try {
      const claims = verifyContextId(deps.codec, request.contextId, {
        userId: request.principal.userId,
        catalogVersionOf: (name) => {
          try {
            return deps.catalogs(name).catalog.version;
          } catch {
            return undefined;
          }
        },
      });
      environment = authorizeEnvironment(request.principal, claims.environment, deps.environments);
      const config = deps.environments[environment];
      if (config === undefined) throw errors.internal();
      enforceRateLimit(
        deps.rateLimiter,
        request.principal.userId,
        config.limits.rateLimitPerMinute,
      );

      const limit = request.limit ?? config.limits.pageSize;
      const offset = request.offset ?? 0;
      if (limit > config.limits.maxRows) {
        throw new SanitizedError(
          'SQL_FORBIDDEN',
          `limit ${limit} exceeds maxRows ${config.limits.maxRows}. Use a smaller limit and page with offset.`,
        );
      }

      let validated;
      try {
        validated = validateSql({
          sql: request.sql,
          parser: deps.parser,
          catalog: catalogViewOf(deps.catalogs(environment).catalog),
          contextEntities: new Set(claims.entities),
          environment,
        });
      } catch (error) {
        if (error instanceof SqlRejection) throw new SanitizedError(error.code, error.message);
        throw error;
      }

      // One extra row reveals whether another page exists.
      const result = await deps.executor.execute({
        environment,
        sql: appendPaging(validated.sql, limit + 1, offset),
        timeoutSeconds: config.limits.timeoutSeconds,
      });
      const paging = offset > 0 || result.rows.length > limit;
      let formatted;
      try {
        formatted = formatResult(result, {
          offset,
          limit,
          maxResponseBytes: config.limits.maxResponseBytes,
          extraNotes: paging && !validated.hasOrderBy ? [NO_ORDER_NOTE] : [],
        });
      } catch (error) {
        if (error instanceof ResponseTooSmallError) {
          throw new SanitizedError(
            'SQL_FORBIDDEN',
            `A single row exceeds the response limit of ${error.maxResponseBytes} bytes. Select fewer or shorter columns.`,
          );
        }
        throw error;
      }
      rows = formatted.rows;
      bytes = formatted.bytes;
      return formatted.text;
    } catch (error) {
      const sanitized = toSanitizedError(error);
      outcome = sanitized.code;
      throw sanitized;
    } finally {
      deps.audit.audit({
        user: request.principal.userId,
        env: environment,
        sqlHash,
        rows,
        durationMs: clock.now().getTime() - started,
        outcome,
        bytes,
      });
    }
  };
}

export type RunQuery = ReturnType<typeof createRunQuery>;
