import { createRequire } from 'node:module';
import type { SqlExecutor, ExecuteRequest } from '../application/ports.js';
import type { CellValue, ResultTable } from '../domain/result-formatter.js';
import { errors } from '../../../platform/errors/sanitized-error.js';
import { mapDriverError } from './hana-error-mapping.js';

/** The slice of `@sap/hana-client` this adapter uses. Real objects satisfy it structurally. */
export interface HanaStatementLike {
  getColumnInfo(): readonly { readonly columnName: string }[];
  setTimeout(seconds: number): void;
  exec(options: object, callback: (error: Error | null, rows?: unknown) => void): void;
  drop(callback?: (error: Error | null) => void): void;
}

export interface HanaConnectionLike {
  setAutoCommit(flag: boolean): void;
  exec(sql: string, callback: (error: Error | null, result?: unknown) => void): void;
  prepare(
    sql: string,
    callback: (error: Error | null, statement?: HanaStatementLike) => void,
  ): void;
  rollback(callback?: (error: Error | null) => void): void;
  /** On a pooled connection this returns it to the pool. */
  disconnect(callback?: (error: Error | null) => void): void;
  abort?(callback?: (error: Error | null) => void): void;
}

export interface HanaPoolLike {
  getConnection(callback: (error: Error | null, connection?: HanaConnectionLike) => void): void;
  clear?(callback?: (error: Error | null) => void): void;
}

export interface HanaDriver {
  createPool(connection: Record<string, unknown>, pool: Record<string, unknown>): HanaPoolLike;
}

/** Loads the native driver on first use, so startup and tests never need it. */
export function loadHanaDriver(): HanaDriver {
  const require = createRequire(import.meta.url);
  return require('@sap/hana-client') as HanaDriver;
}

/** Connection data of one environment. `password` is a secret: it only lives in memory. */
export interface HanaEnvironmentConnection {
  readonly connection: {
    readonly host: string;
    readonly port: string | number;
    readonly user: string;
    readonly password: string;
    readonly encrypt: boolean;
    readonly sslValidateCertificate: boolean;
  };
  /** Default schema of the environment: SQL never names a schema (POV 6.2). */
  readonly schema: string;
  readonly limits: { readonly timeoutSeconds: number; readonly poolSize: number };
}

export interface HanaSqlExecutorOptions {
  environments: Readonly<Record<string, HanaEnvironmentConnection>>;
  /** Defaults to the native `@sap/hana-client`, loaded lazily. */
  driver?: () => HanaDriver;
  /** Extra seconds the adapter waits beyond the statement timeout before giving up. */
  graceSeconds?: number;
}

/** Statement that makes the session refuse writes (POV 7, layer 3). */
export const READ_ONLY_STATEMENT = 'SET TRANSACTION READ ONLY';

const CONNECT_TIMEOUT_MS = 10_000;
const POOL_IDLE_SECONDS = 300;

function call<T>(
  register: (done: (error: Error | null, value?: T) => void) => void,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    register((error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

/** Same as `call` for operations that report only success or failure. */
function callDone(register: (done: (error: Error | null) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    register((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Builds the options of `createPool`. Exported for tests: it is the only place that reads the password. */
export function connectionOptions(
  environment: HanaEnvironmentConnection,
  graceSeconds: number,
): Record<string, unknown> {
  const { connection } = environment;
  return {
    serverNode: `${connection.host}:${connection.port}`,
    uid: connection.user,
    pwd: connection.password,
    encrypt: connection.encrypt,
    sslValidateCertificate: connection.sslValidateCertificate,
    // Layer 3 of POV 7: the schema is fixed per environment, never taken from the SQL.
    currentSchema: environment.schema,
    connectTimeout: CONNECT_TIMEOUT_MS,
    communicationTimeout: (environment.limits.timeoutSeconds + graceSeconds) * 1000,
  };
}

function poolOptions(environment: HanaEnvironmentConnection): Record<string, unknown> {
  return {
    maxConnectedOrPooled: environment.limits.poolSize,
    maxPooledIdleTime: POOL_IDLE_SECONDS,
    pingCheck: true,
  };
}

/**
 * Adapter of the `SqlExecutor` port over `@sap/hana-client`, one lazy pool per environment.
 *
 * Read-only layers applied here (POV 7): the connection is the technical `STRAHANA_RO` user from
 * the environment's service (layer 1, configured outside the code); the default schema is fixed
 * with `currentSchema` (layer 3); every query runs in its own transaction that starts with
 * `SET TRANSACTION READ ONLY` with autocommit off, and the transaction is always rolled back
 * afterwards (layers 3 and 4); the statement has a server-side timeout (`Statement.setTimeout`)
 * and a local timer as a backstop. If `SET TRANSACTION READ ONLY` fails, the statement is not run.
 * Credentials, the SQL text and driver messages never leave this class: errors are mapped to
 * `SanitizedError`.
 */
export class HanaSqlExecutor implements SqlExecutor {
  private readonly pools = new Map<string, HanaPoolLike>();
  private readonly driverLoader: () => HanaDriver;
  private readonly graceSeconds: number;
  private driver: HanaDriver | undefined;

  constructor(private readonly options: HanaSqlExecutorOptions) {
    this.driverLoader = options.driver ?? loadHanaDriver;
    this.graceSeconds = options.graceSeconds ?? 5;
  }

  async execute(request: ExecuteRequest): Promise<ResultTable> {
    const environment = this.options.environments[request.environment];
    if (environment === undefined) throw errors.internal();
    // Mutated from callbacks, so it lives in an object the type checker cannot narrow.
    const state: { timedOut: boolean; connection: HanaConnectionLike | undefined } = {
      timedOut: false,
      connection: undefined,
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      const pool = this.poolFor(request.environment, environment);
      const run = async (): Promise<ResultTable> => {
        const acquired = await call<HanaConnectionLike>((done) => pool.getConnection(done));
        if (acquired === undefined) throw errors.internal();
        state.connection = acquired;
        return this.runReadOnly(acquired, request.sql, request.timeoutSeconds);
      };
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            state.timedOut = true;
            reject(errors.dbTimeout(request.timeoutSeconds));
          },
          (request.timeoutSeconds + this.graceSeconds) * 1000,
        );
      });
      return await Promise.race([run(), deadline]);
    } catch (error) {
      if (state.timedOut) this.abort(state.connection);
      throw mapDriverError(error, {
        timeoutSeconds: request.timeoutSeconds,
        timedOutLocally: state.timedOut,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (state.connection !== undefined && !state.timedOut) await this.release(state.connection);
    }
  }

  /** Closes every pool. Safe to call more than once. */
  async close(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(
      pools.map((pool) =>
        pool.clear === undefined
          ? Promise.resolve()
          : callDone((done) => pool.clear?.(done)).catch(() => undefined),
      ),
    );
  }

  private poolFor(name: string, environment: HanaEnvironmentConnection): HanaPoolLike {
    let pool = this.pools.get(name);
    if (pool === undefined) {
      this.driver ??= this.driverLoader();
      pool = this.driver.createPool(
        connectionOptions(environment, this.graceSeconds),
        poolOptions(environment),
      );
      this.pools.set(name, pool);
    }
    return pool;
  }

  private async runReadOnly(
    connection: HanaConnectionLike,
    sql: string,
    timeoutSeconds: number,
  ): Promise<ResultTable> {
    connection.setAutoCommit(false);
    // Fail closed: if the session cannot be made read-only the statement is never sent.
    await callDone((done) => connection.exec(READ_ONLY_STATEMENT, done));
    const statement = await call<HanaStatementLike>((done) => connection.prepare(sql, done));
    if (statement === undefined) throw errors.internal();
    try {
      statement.setTimeout(timeoutSeconds);
      const rows = await call<unknown>((done) => statement.exec({ rowsAsArray: true }, done));
      if (!Array.isArray(rows)) throw errors.dbError('The statement did not return rows.');
      return {
        columns: statement.getColumnInfo().map((column) => column.columnName),
        rows: rows.map((row) => (Array.isArray(row) ? (row as CellValue[]) : [])),
      };
    } finally {
      statement.drop();
    }
  }

  /** Ends the read-only transaction and returns the connection to the pool. Never throws. */
  private async release(connection: HanaConnectionLike): Promise<void> {
    await callDone((done) => connection.rollback(done)).catch(() => undefined);
    await callDone((done) => connection.disconnect(done)).catch(() => undefined);
  }

  private abort(connection: HanaConnectionLike | undefined): void {
    try {
      connection?.abort?.();
    } catch {
      // The connection is already unusable; the pool discards it.
    }
  }
}
