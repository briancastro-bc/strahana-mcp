import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryRateLimiter } from '../../../src/hana/access/infrastructure/in-memory-rate-limiter.js';
import { createBuildContext } from '../../../src/hana/catalog/application/build-context.js';
import { HmacContextIdCodec } from '../../../src/hana/catalog/infrastructure/hmac-context-id-codec.js';
import { MiniSearchCatalogSearch } from '../../../src/hana/catalog/infrastructure/minisearch-catalog-search.js';
import { YamlCatalogSource } from '../../../src/hana/catalog/infrastructure/yaml-catalog-source.js';
import { createContextHandler } from '../../../src/hana/mcp/context-handler.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';
import { silentLogger } from '../../helpers.js';

const catalog = new YamlCatalogSource().load('catalog/sales.catalog.yaml');
const search = new MiniSearchCatalogSearch(catalog);

function setup(rateLimitPerMinute = 30) {
  const time = { ms: Date.UTC(2026, 0, 1) };
  const clock = { now: () => new Date(time.ms) };
  const lines: string[] = [];
  const handler = createContextHandler({
    environments: {
      'DEV-SALES': { groups: ['G_SALES'], limits: { rateLimitPerMinute } },
      'QAS-SALES': { groups: ['G_QAS'], limits: { rateLimitPerMinute } },
    },
    buildContext: createBuildContext(
      () => ({ catalog, search }),
      new HmacContextIdCodec({ key: Buffer.alloc(32, 5), clock }),
    ),
    rateLimiter: new InMemoryRateLimiter(clock),
    logger: silentLogger(lines),
    clock,
  });
  return { handler, lines, time };
}

const jdoe = { userId: 'jdoe', groups: ['G_SALES'] };
const both = { userId: 'boss', groups: ['G_SALES', 'G_QAS'] };

const codeOf = async (promise: Promise<string>) => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SanitizedError);
    return error.code;
  }
  return 'OK';
};

test('infers the only allowed environment and answers with a context', async () => {
  const { handler } = setup();
  const text = await handler({ question: 'pedidos por cliente' }, { principal: jdoe });
  assert.match(text, /^ctx=\S+ env=DEV-SALES ttl=60m\n/);
});

test('requires an explicit environment when several are allowed, and lists them', async () => {
  const { handler } = setup();
  await assert.rejects(
    handler({ question: 'pedidos por cliente' }, { principal: both }),
    (error: unknown) =>
      error instanceof SanitizedError &&
      error.code === 'ENV_REQUIRED' &&
      error.message === 'environment required: DEV-SALES, QAS-SALES',
  );
});

test('rejects environments the user has no group for, indistinguishable from unknown ones', async () => {
  const { handler } = setup();
  const forbidden = await codeOf(
    handler({ question: 'pedidos por cliente', environment: 'QAS-SALES' }, { principal: jdoe }),
  );
  const unknown = await codeOf(
    handler({ question: 'pedidos por cliente', environment: 'NOPE' }, { principal: jdoe }),
  );
  assert.equal(forbidden, 'ENV_FORBIDDEN');
  assert.equal(unknown, 'ENV_FORBIDDEN');
});

test('rejects SQL questions and applies the per-user rate limit with an injectable clock', async () => {
  const { handler, time } = setup(2);
  assert.equal(
    await codeOf(handler({ question: 'SELECT * FROM T' }, { principal: jdoe })),
    'QUESTION_IS_SQL',
  );
  // The rejected SQL call spent one of the two calls too: abuse is limited as well.
  assert.equal(
    await codeOf(handler({ question: 'pedidos por cliente' }, { principal: jdoe })),
    'OK',
  );
  assert.equal(
    await codeOf(handler({ question: 'pedidos por cliente' }, { principal: jdoe })),
    'RATE_LIMITED',
  );
  time.ms += 61_000;
  assert.equal(
    await codeOf(handler({ question: 'pedidos por cliente' }, { principal: jdoe })),
    'OK',
  );
  // Another user has an independent budget.
  assert.equal(
    await codeOf(
      handler(
        { question: 'pedidos por cliente' },
        { principal: { userId: 'ana', groups: ['G_SALES'] } },
      ),
    ),
    'OK',
  );
});

test('audit record has user, environment, duration, outcome and a question hash, never the question', async () => {
  const { handler, lines } = setup();
  const question = 'ventas confidenciales del cliente Zeta Corp';
  await handler({ question }, { principal: jdoe });
  await codeOf(handler({ question: 'SELECT * FROM T' }, { principal: jdoe }));
  const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const ok = records.find((r) => r['event'] === 'context' && r['outcome'] === 'ok');
  assert.ok(ok);
  assert.equal(ok['user'], 'jdoe');
  assert.equal(ok['env'], 'DEV-SALES');
  assert.equal(ok['tool'], 'hana_context');
  assert.match(String(ok['questionHash']), /^[0-9a-f]{16}$/);
  assert.equal(typeof ok['durationMs'], 'number');
  assert.equal(typeof ok['bytes'], 'number');
  const failed = records.find((r) => r['event'] === 'context' && r['outcome'] === 'error');
  assert.equal(failed?.['code'], 'QUESTION_IS_SQL');
  const raw = lines.join('');
  assert.ok(!raw.includes('Zeta'), 'question text must not be logged');
  assert.ok(!raw.includes('SELECT'), 'question text must not be logged');
  assert.ok(!raw.includes('ctx='), 'context must not be logged');
});
