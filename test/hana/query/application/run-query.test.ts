import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { InMemoryRateLimiter } from '../../../../src/hana/access/infrastructure/in-memory-rate-limiter.js';
import { HmacContextIdCodec } from '../../../../src/hana/catalog/infrastructure/hmac-context-id-codec.js';
import type { SqlExecutor, ExecuteRequest } from '../../../../src/hana/query/application/ports.js';
import {
  createRunQuery,
  type QueryCatalog,
  type QueryEnvironment,
} from '../../../../src/hana/query/application/run-query.js';
import type { ResultTable } from '../../../../src/hana/query/domain/result-formatter.js';
import { NodeSqlParserAdapter } from '../../../../src/hana/query/infrastructure/node-sql-parser-adapter.js';
import type { Clock } from '../../../../src/platform/clock.js';
import { SanitizedError, errors } from '../../../../src/platform/errors/sanitized-error.js';
import type { AuditEntry } from '../../../../src/platform/logging/logger.js';
import { sha256Hex } from '../../../../src/platform/security/hmac.js';
import { catalogView } from '../query-fixtures.js';

const O = 'COM_ACME_SALES_ORDERS';
const C = 'COM_ACME_SALES_CUSTOMERS';

const catalog: QueryCatalog = {
  version: '1:abc',
  entities: catalogView.entityNames().map((name) => ({
    name,
    columns: (catalogView.entity(name)?.columns ?? []).map((column) => ({ name: column })),
  })),
};

const limits = {
  pageSize: 3,
  maxRows: 10,
  timeoutSeconds: 30,
  maxResponseBytes: 16384,
  rateLimitPerMinute: 100,
};
const analyst = { userId: 'jdoe', groups: ['G_DEV'] };

class FakeClock implements Clock {
  constructor(private ms = Date.parse('2026-01-01T00:00:00Z')) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

class FakeExecutor implements SqlExecutor {
  readonly calls: ExecuteRequest[] = [];
  constructor(private readonly respond: (request: ExecuteRequest) => ResultTable | Error) {}
  execute(request: ExecuteRequest): Promise<ResultTable> {
    this.calls.push(request);
    const result = this.respond(request);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  }
}

/** Emulates the database: a table of 8 rows sliced by the LIMIT/OFFSET suffix of the request. */
function pagedTable(total = 8): FakeExecutor {
  const all = Array.from({ length: total }, (_, i) => [`ORD-${i}`, i * 10]);
  return new FakeExecutor((request) => {
    const match = / LIMIT (\d+) OFFSET (\d+)$/.exec(request.sql);
    assert.ok(match, 'the executor must receive the paging suffix');
    const limit = Number(match[1]);
    const offset = Number(match[2]);
    return { columns: ['ORDERNUMBER', 'TOTALAMOUNT'], rows: all.slice(offset, offset + limit) };
  });
}

function setup(
  options: {
    executor?: FakeExecutor;
    env?: Partial<QueryEnvironment['limits']>;
    groups?: string[];
  } = {},
) {
  const key = randomBytes(32);
  const clock = new FakeClock();
  const codec = new HmacContextIdCodec({ key, clock });
  const executor = options.executor ?? pagedTable();
  const audits: AuditEntry[] = [];
  const environments: Record<string, QueryEnvironment> = {
    'DEV-SALES': { groups: options.groups ?? ['G_DEV'], limits: { ...limits, ...options.env } },
    'QAS-SALES': { groups: ['G_QAS'], limits },
  };
  const run = createRunQuery({
    environments,
    catalogs: (environment) => {
      if (!(environment in environments)) throw errors.internal();
      return { catalog };
    },
    codec,
    parser: new NodeSqlParserAdapter(),
    executor,
    rateLimiter: new InMemoryRateLimiter(clock),
    audit: { audit: (entry) => audits.push(entry) },
    clock,
  });
  const issue = (
    overrides: Partial<{
      userId: string;
      environment: string;
      catalogVersion: string;
      entities: string[];
    }> = {},
  ) =>
    codec.issue({
      userId: 'jdoe',
      environment: 'DEV-SALES',
      catalogVersion: catalog.version,
      entities: [O, C],
      ...overrides,
    });
  return { run, issue, executor, audits, clock, environments };
}

async function failure(promise: Promise<unknown>): Promise<SanitizedError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SanitizedError, 'errors must be SanitizedError');
    assert.ok(!error.message.includes('\n'));
    return error;
  }
  throw new assert.AssertionError({ message: 'expected a rejection' });
}

const SQL = `SELECT ORDERNUMBER, TOTALAMOUNT FROM ${O} ORDER BY ORDERNUMBER`;

test('happy path: executes the original text plus server paging and returns compact TSV', async () => {
  const { run, issue, executor } = setup();
  const text = await run({ principal: analyst, sql: SQL, contextId: issue() });
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]?.sql, `${SQL} LIMIT 4 OFFSET 0`, 'pageSize 3 + one extra row');
  assert.equal(executor.calls[0].environment, 'DEV-SALES');
  assert.equal(executor.calls[0].timeoutSeconds, 30);
  assert.deepEqual(text.split('\n'), [
    'rows=3 more=yes next_offset=3',
    'ORDERNUMBER\tTOTALAMOUNT',
    'ORD-0\t0',
    'ORD-1\t10',
    'ORD-2\t20',
  ]);
});

test('a trailing semicolon is stripped: the database receives valid paged text without it', async () => {
  const { run, issue, executor } = setup();
  const contextId = issue();
  await run({ principal: analyst, sql: `${SQL};\n`, contextId });
  assert.equal(executor.calls[0]?.sql, `${SQL} LIMIT 4 OFFSET 0`);
  for (const sql of [`${SQL};;`, `${SQL}; SELECT 1`, `${SQL};--c`]) {
    const error = await failure(run({ principal: analyst, sql, contextId }));
    assert.equal(error.code, 'SQL_FORBIDDEN', sql);
    assert.match(error.message, /";" is only accepted once/);
  }
  assert.equal(executor.calls.length, 1, 'rejected statements never reach the database');
});

test('pagination: the LLM repeats the call with next_offset until more=no', async () => {
  const { run, issue } = setup();
  const contextId = issue();
  const pages: string[] = [];
  let offset: number | undefined;
  for (let guard = 0; guard < 10; guard++) {
    const text = await run({ principal: analyst, sql: SQL, contextId, offset });
    pages.push(text);
    const status = text.split('\n')[0] ?? '';
    const next = /next_offset=(\d+)/.exec(status)?.[1];
    if (next === undefined) {
      assert.match(status, /more=no$/);
      break;
    }
    offset = Number(next);
  }
  assert.deepEqual(
    pages.map((page) => page.split('\n')[0]),
    ['rows=3 more=yes next_offset=3', 'rows=3 more=yes next_offset=6', 'rows=2 more=no'],
  );
  assert.ok(pages[2]?.includes('ORD-7'));
});

test('explicit limit replaces the page size; limit above maxRows is rejected with the fix', async () => {
  const { run, issue, executor } = setup();
  const text = await run({ principal: analyst, sql: SQL, contextId: issue(), limit: 5 });
  assert.equal(text.split('\n')[0], 'rows=5 more=yes next_offset=5');
  assert.match(executor.calls[0]?.sql ?? '', / LIMIT 6 OFFSET 0$/);

  const error = await failure(run({ principal: analyst, sql: SQL, contextId: issue(), limit: 11 }));
  assert.equal(error.code, 'SQL_FORBIDDEN');
  assert.match(error.message, /limit 11 exceeds maxRows 10/);
  assert.equal(executor.calls.length, 1, 'rejected before reaching the database');
});

test('no ORDER BY while paging adds a note; with ORDER BY it does not', async () => {
  const { run, issue } = setup();
  const noOrder = await run({
    principal: analyst,
    sql: `SELECT ORDERNUMBER, TOTALAMOUNT FROM ${O}`,
    contextId: issue(),
  });
  assert.equal(noOrder.split('\n').at(-1), 'notes: no ORDER BY, page order is not guaranteed');
  const ordered = await run({ principal: analyst, sql: SQL, contextId: issue() });
  assert.ok(!ordered.includes('notes:'));
  const single = await run({
    principal: analyst,
    sql: `SELECT ORDERNUMBER, TOTALAMOUNT FROM ${O}`,
    contextId: issue(),
    limit: 10,
  });
  assert.ok(!single.includes('notes:'), 'one complete page needs no ordering note');
});

test('maxResponseBytes caps the page and points next_offset at the first row not shown', async () => {
  const wide = new FakeExecutor((request) => {
    const limit = Number(/ LIMIT (\d+) /.exec(request.sql)?.[1]);
    return {
      columns: ['NOTES'],
      rows: Array.from({ length: limit }, (_, i) => [`${i}-${'x'.repeat(100)}`]),
    };
  });
  const { run, issue } = setup({
    executor: wide,
    env: { maxResponseBytes: 1024, pageSize: 50, maxRows: 50 },
  });
  const text = await run({
    principal: analyst,
    sql: `SELECT NOTES FROM ${O} ORDER BY NOTES`,
    contextId: issue(),
  });
  assert.ok(Buffer.byteLength(text) <= 1024);
  const status = /^rows=(\d+) more=yes next_offset=(\d+)$/.exec(text.split('\n')[0] ?? '');
  assert.ok(status);
  assert.equal(status[1], status[2]);
  assert.ok(text.includes('response capped at 1024 bytes'));
});

test('a row that cannot fit the response limit is an actionable error, not an empty page', async () => {
  const wide = new FakeExecutor(() => ({
    columns: Array.from({ length: 40 }, (_, i) => `COLUMN_NUMBER_${i}`),
    rows: [Array.from({ length: 40 }, () => 'y'.repeat(100))],
  }));
  const { run, issue } = setup({ executor: wide, env: { maxResponseBytes: 1024 } });
  const error = await failure(
    run({ principal: analyst, sql: `SELECT NOTES FROM ${O} ORDER BY NOTES`, contextId: issue() }),
  );
  assert.equal(error.code, 'SQL_FORBIDDEN');
  assert.match(error.message, /single row exceeds the response limit of 1024 bytes/);
});

test('context_id: tampered, foreign user, other catalog version, expired and wrong environment are all CONTEXT_INVALID', async () => {
  const { run, issue, executor, clock } = setup();
  const good = issue();
  const cases: [string, string, typeof analyst][] = [
    ['garbage', 'not-a-context', analyst],
    ['empty', '', analyst],
    ['tampered', `${good.slice(0, -2)}xx`, analyst],
    ['issued for another user', issue({ userId: 'eve' }), analyst],
    ['outdated catalog version', issue({ catalogVersion: '0:old' }), analyst],
    ['unknown environment', issue({ environment: 'PRD-SALES' }), analyst],
  ];
  for (const [label, contextId, principal] of cases) {
    const error = await failure(run({ principal, sql: SQL, contextId }));
    assert.equal(error.code, 'CONTEXT_INVALID', label);
    assert.equal(error.message, 'context_id expired or invalid. Call hana_context again.');
  }
  clock.advance(61 * 60 * 1000);
  assert.equal(
    (await failure(run({ principal: analyst, sql: SQL, contextId: good }))).code,
    'CONTEXT_INVALID',
  );
  assert.equal(executor.calls.length, 0);
});

test('authorization is re-checked: a context for an environment the user lost access to is ENV_FORBIDDEN', async () => {
  const { run, issue, executor } = setup();
  const qas = issue({ environment: 'QAS-SALES' });
  const error = await failure(run({ principal: analyst, sql: SQL, contextId: qas }));
  assert.equal(error.code, 'ENV_FORBIDDEN');
  const outsider = { userId: 'jdoe', groups: ['OTHER'] };
  assert.equal(
    (await failure(run({ principal: outsider, sql: SQL, contextId: issue() }))).code,
    'ENV_FORBIDDEN',
  );
  assert.equal(executor.calls.length, 0);
});

test('rate limit applies per user and reports the wait', async () => {
  const { run, issue } = setup({ env: { rateLimitPerMinute: 2 } });
  const contextId = issue();
  await run({ principal: analyst, sql: SQL, contextId });
  await run({ principal: analyst, sql: SQL, contextId });
  const error = await failure(run({ principal: analyst, sql: SQL, contextId }));
  assert.equal(error.code, 'RATE_LIMITED');
  assert.match(error.message, /^Too many requests\. Retry in \d+s\.$/);
});

test('validation errors keep their code and never reach the database', async () => {
  const { run, issue, executor } = setup();
  const contextId = issue();
  const cases: [string, string][] = [
    [`SELECT * FROM ${O}`, 'SQL_FORBIDDEN'],
    [`DELETE FROM ${O}`, 'SQL_NOT_SELECT'],
    [`SELECT ID FROM COM_ACME_SALES_INVOICES`, 'SQL_ENTITY_NOT_IN_CONTEXT'],
    [`SELECT ID FROM COM_ACME_HR_SALARIES`, 'SQL_ENTITY_UNAVAILABLE'],
    [`SELECT o.NOPE FROM ${O} o`, 'SQL_UNKNOWN_COLUMN'],
    [`SELECT ID FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID`, 'SQL_AMBIGUOUS_COLUMN'],
    [`SELECT ID FROM ${O} LIMIT 5`, 'SQL_FORBIDDEN'],
    [`SELECT TOP 5 ID FROM ${O}`, 'SQL_PARSE'],
  ];
  for (const [sql, code] of cases) {
    assert.equal((await failure(run({ principal: analyst, sql, contextId }))).code, code, sql);
  }
  assert.equal(executor.calls.length, 0);
});

test('the context binds the tables: another context of the same user cannot widen it', async () => {
  const { run, issue } = setup();
  const narrow = issue({ entities: [C] });
  const error = await failure(run({ principal: analyst, sql: SQL, contextId: narrow }));
  assert.equal(error.code, 'SQL_ENTITY_NOT_IN_CONTEXT');
  assert.match(error.message, /Call hana_context with entities:\["COM_ACME_SALES_ORDERS"\]/);
});

test('database errors surface as sanitized one-liners; anything unexpected becomes INTERNAL_ERROR', async () => {
  const timeout = setup({ executor: new FakeExecutor(() => errors.dbTimeout(30)) });
  const t = await failure(
    timeout.run({ principal: analyst, sql: SQL, contextId: timeout.issue() }),
  );
  assert.equal(t.code, 'DB_TIMEOUT');
  assert.equal(t.message, 'Query exceeded 30s. Narrow the filters or aggregate.');

  const leaky = setup({
    executor: new FakeExecutor(
      () => new Error('connect ECONNREFUSED 10.0.0.1:443 password=hunter2'),
    ),
  });
  const e = await failure(leaky.run({ principal: analyst, sql: SQL, contextId: leaky.issue() }));
  assert.equal(e.code, 'INTERNAL_ERROR');
  assert.ok(!e.message.includes('hunter2') && !e.message.includes('10.0.0.1'));
});

test('audit: one entry per call with user, env, sql hash, rows, duration, outcome and bytes; no SQL text', async () => {
  const { run, issue, audits, clock } = setup();
  const contextId = issue();
  const secretSql = `SELECT ORDERNUMBER, TOTALAMOUNT FROM ${O} WHERE NOTES = 'SECRET-LITERAL' ORDER BY ORDERNUMBER`;
  const text = await run({ principal: analyst, sql: secretSql, contextId });
  await failure(run({ principal: analyst, sql: `DROP TABLE ${O}`, contextId }));
  await failure(run({ principal: analyst, sql: SQL, contextId: 'bad' }));
  clock.advance(1);
  assert.equal(audits.length, 3);
  const [ok, rejected, invalid] = audits;
  assert.ok(ok && rejected && invalid);
  assert.equal(ok.user, 'jdoe');
  assert.equal(ok.env, 'DEV-SALES');
  assert.equal(ok.sqlHash, sha256Hex(secretSql));
  assert.equal(ok.rows, 3);
  assert.equal(ok.outcome, 'ok');
  assert.equal(ok.bytes, Buffer.byteLength(text));
  assert.equal(typeof ok.durationMs, 'number');
  assert.equal(rejected.outcome, 'SQL_NOT_SELECT');
  assert.equal(rejected.rows, 0);
  assert.equal(invalid.outcome, 'CONTEXT_INVALID');
  assert.equal(invalid.env, '-');
  assert.ok(!JSON.stringify(audits).includes('SECRET-LITERAL'));
  assert.ok(!JSON.stringify(audits).includes('ORD-0'), 'row values never reach the audit');
});
