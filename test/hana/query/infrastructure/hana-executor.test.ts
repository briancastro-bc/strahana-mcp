import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HanaSqlExecutor,
  READ_ONLY_STATEMENT,
  connectionOptions,
  type HanaConnectionLike,
  type HanaDriver,
  type HanaEnvironmentConnection,
  type HanaPoolLike,
  type HanaStatementLike,
} from '../../../../src/hana/query/infrastructure/hana-executor.js';
import { SanitizedError } from '../../../../src/platform/errors/sanitized-error.js';

const ENV: HanaEnvironmentConnection = {
  connection: {
    host: 'db.example.invalid',
    port: '443',
    user: 'STRAHANA_RO',
    password: 'synthetic-secret-pw',
    encrypt: true,
    sslValidateCertificate: true,
  },
  schema: 'SALES_HDI_DB_1',
  limits: { timeoutSeconds: 7, poolSize: 3 },
};

interface Script {
  readOnlyError?: Error;
  prepareError?: Error;
  execError?: Error;
  hang?: boolean;
  rows?: unknown;
  columns?: string[];
}

function fakeDriver(script: Script = {}) {
  const log: string[] = [];
  const created: { connection: Record<string, unknown>; pool: Record<string, unknown> }[] = [];
  const statement: HanaStatementLike = {
    getColumnInfo: () => (script.columns ?? ['A', 'B']).map((columnName) => ({ columnName })),
    setTimeout: (seconds) => log.push(`stmt.setTimeout(${seconds})`),
    exec: (options, done) => {
      log.push(`stmt.exec(${JSON.stringify(options)})`);
      if (script.hang) return;
      if (script.execError) done(script.execError);
      else done(null, script.rows ?? [['x', 1]]);
    },
    drop: () => log.push('stmt.drop'),
  };
  const connection: HanaConnectionLike = {
    setAutoCommit: (flag) => log.push(`setAutoCommit(${flag})`),
    exec: (sql, done) => {
      log.push(`exec(${sql})`);
      done(script.readOnlyError ?? null);
    },
    prepare: (sql, done) => {
      log.push(`prepare(${sql})`);
      if (script.prepareError) done(script.prepareError);
      else done(null, statement);
    },
    rollback: (done) => {
      log.push('rollback');
      done?.(null);
    },
    disconnect: (done) => {
      log.push('disconnect');
      done?.(null);
    },
    abort: () => log.push('abort'),
  };
  const pool: HanaPoolLike = {
    getConnection: (done) => {
      log.push('getConnection');
      done(null, connection);
    },
    clear: (done) => {
      log.push('pool.clear');
      done?.(null);
    },
  };
  const driver: HanaDriver = {
    createPool: (conn, poolOptions) => {
      created.push({ connection: conn, pool: poolOptions });
      return pool;
    },
  };
  return { driver, log, created };
}

function executor(script?: Script, graceSeconds?: number) {
  const fake = fakeDriver(script);
  const instance = new HanaSqlExecutor({
    environments: { 'DEV-SALES': ENV },
    driver: () => fake.driver,
    ...(graceSeconds === undefined ? {} : { graceSeconds }),
  });
  return { ...fake, instance };
}

const REQUEST = {
  environment: 'DEV-SALES',
  sql: 'SELECT A, B FROM T ORDER BY A LIMIT 51 OFFSET 0',
  timeoutSeconds: 7,
};

async function failure(promise: Promise<unknown>): Promise<SanitizedError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SanitizedError);
    return error;
  }
  throw new assert.AssertionError({ message: 'expected a rejection' });
}

test('runs the statement in a read-only, rolled-back transaction and returns columns and rows', async () => {
  const { instance, log } = executor({
    rows: [
      ['x', 1],
      ['y', 2],
    ],
    columns: ['A', 'B'],
  });
  const result = await instance.execute(REQUEST);
  assert.deepEqual(result, {
    columns: ['A', 'B'],
    rows: [
      ['x', 1],
      ['y', 2],
    ],
  });
  assert.deepEqual(log, [
    'getConnection',
    'setAutoCommit(false)',
    `exec(${READ_ONLY_STATEMENT})`,
    `prepare(${REQUEST.sql})`,
    'stmt.setTimeout(7)',
    'stmt.exec({"rowsAsArray":true})',
    'stmt.drop',
    'rollback',
    'disconnect',
  ]);
});

test('the read-only statement is SET TRANSACTION READ ONLY and runs before the query', async () => {
  assert.equal(READ_ONLY_STATEMENT, 'SET TRANSACTION READ ONLY');
  const { instance, log } = executor();
  await instance.execute(REQUEST);
  assert.ok(
    log.indexOf(`exec(${READ_ONLY_STATEMENT})`) < log.findIndex((l) => l.startsWith('prepare(')),
  );
});

test('fail closed: if the session cannot be made read-only the statement is never sent', async () => {
  const { instance, log } = executor({
    readOnlyError: Object.assign(new Error('boom'), { code: 257 }),
  });
  const error = await failure(instance.execute(REQUEST));
  assert.equal(error.code, 'DB_ERROR');
  assert.ok(!log.some((entry) => entry.startsWith('prepare(')));
  assert.deepEqual(
    log.slice(-2),
    ['rollback', 'disconnect'],
    'the connection still goes back to the pool',
  );
});

test('the executed text is exactly the one received (no rewriting)', async () => {
  const { instance, log } = executor();
  const sql = "SELECT A FROM T WHERE B = 'it''s' ORDER BY A LIMIT 2 OFFSET 0";
  await instance.execute({ ...REQUEST, sql });
  assert.ok(log.includes(`prepare(${sql})`));
});

test('pool: one lazy pool per environment, sized from config, schema fixed, TLS on', async () => {
  const { instance, created } = executor();
  assert.equal(created.length, 0, 'nothing is created before the first query');
  await instance.execute(REQUEST);
  await instance.execute(REQUEST);
  assert.equal(created.length, 1);
  const [only] = created;
  assert.ok(only);
  assert.equal(only.connection['serverNode'], 'db.example.invalid:443');
  assert.equal(only.connection['uid'], 'STRAHANA_RO');
  assert.equal(only.connection['currentSchema'], 'SALES_HDI_DB_1');
  assert.equal(only.connection['encrypt'], true);
  assert.equal(only.connection['sslValidateCertificate'], true);
  assert.equal(only.pool['maxConnectedOrPooled'], 3);
});

test('connection options derive only from the environment (password only in the options object)', () => {
  const options = connectionOptions(ENV, 5);
  assert.equal(options['pwd'], 'synthetic-secret-pw');
  assert.equal(options['communicationTimeout'], 12_000);
  assert.deepEqual(Object.keys(options).sort(), [
    'communicationTimeout',
    'connectTimeout',
    'currentSchema',
    'encrypt',
    'pwd',
    'serverNode',
    'sslValidateCertificate',
    'uid',
  ]);
});

test('driver errors are mapped to sanitized errors: no driver message, SQL or credential leaks', async () => {
  const leaky = Object.assign(
    new Error(
      `invalid number: 'TOP-SECRET-VALUE' at db.example.invalid user STRAHANA_RO pw synthetic-secret-pw`,
    ),
    { code: 339 },
  );
  const { instance } = executor({ execError: leaky });
  const error = await failure(instance.execute(REQUEST));
  assert.equal(error.code, 'DB_ERROR');
  assert.equal(
    error.message,
    'Database error 339: invalid number or date conversion. Check CAST and literal formats.',
  );
  for (const secret of [
    'TOP-SECRET-VALUE',
    'db.example.invalid',
    'STRAHANA_RO',
    'synthetic-secret-pw',
    'SELECT A',
  ]) {
    assert.ok(!error.message.includes(secret));
  }
});

test('prepare errors and unknown errors are sanitized too, and the connection is released', async () => {
  const { instance, log } = executor({
    prepareError: Object.assign(new Error('Could not find table SECRET.T'), { code: 259 }),
  });
  const error = await failure(instance.execute(REQUEST));
  assert.equal(error.message, 'Database error 259: invalid table name.');
  assert.deepEqual(log.slice(-2), ['rollback', 'disconnect']);
  const plain = executor({ execError: new Error('weird host=10.1.2.3') });
  const unknown = await failure(plain.instance.execute(REQUEST));
  assert.equal(unknown.message, 'Database error. Simplify the query or retry later.');
});

test('a statement that never answers is cut by the local timer: DB_TIMEOUT and the connection is aborted', async () => {
  const { instance, log } = executor({ hang: true }, 0);
  const error = await failure(instance.execute({ ...REQUEST, timeoutSeconds: 0.05 }));
  assert.equal(error.code, 'DB_TIMEOUT');
  assert.ok(log.includes('abort'));
  assert.ok(!log.includes('disconnect'), 'an aborted connection is not handed back as healthy');
});

test('unknown environment is an internal error, not a database call', async () => {
  const { instance, created } = executor();
  const error = await failure(instance.execute({ ...REQUEST, environment: 'NOPE' }));
  assert.equal(error.code, 'INTERNAL_ERROR');
  assert.equal(created.length, 0);
});

test('a non-row result is rejected', async () => {
  const { instance } = executor({ rows: 5 });
  assert.equal((await failure(instance.execute(REQUEST))).code, 'DB_ERROR');
});

test('close clears the pools', async () => {
  const { instance, log } = executor();
  await instance.execute(REQUEST);
  await instance.close();
  assert.ok(log.includes('pool.clear'));
});
