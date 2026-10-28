import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBuildContext,
  type CatalogLookup,
} from '../../../src/hana/catalog/application/build-context.js';
import type { CatalogSearch, EntityHit } from '../../../src/hana/catalog/application/ports.js';
import { MiniSearchCatalogSearch } from '../../../src/hana/catalog/infrastructure/minisearch-catalog-search.js';
import { HmacContextIdCodec } from '../../../src/hana/catalog/infrastructure/hmac-context-id-codec.js';
import {
  parseCatalogYaml,
  YamlCatalogSource,
} from '../../../src/hana/catalog/infrastructure/yaml-catalog-source.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';
import { approxTokens, parseContext } from './context-text.js';

const codec = new HmacContextIdCodec({ key: Buffer.alloc(32, 7) });
const sales = new YamlCatalogSource().load('catalog/sales.catalog.yaml');
const realLookup: CatalogLookup = () => ({
  catalog: sales,
  search: new MiniSearchCatalogSearch(sales),
});
const build = createBuildContext(realLookup, codec);
const ask = (question: string, entities?: string[]) =>
  build({ userId: 'jdoe', environment: 'DEV-SALES', question, entities });

test('returns one text block with a verifiable context_id for a matching question', () => {
  const result = ask('importe total de pedidos por cliente');
  const parsed = parseContext(result.text);
  assert.equal(result.matched, true);
  assert.equal(parsed.environment, 'DEV-SALES');
  assert.equal(parsed.ttl, '60m');
  const claims = codec.open(parsed.contextId);
  assert.equal(claims?.userId, 'jdoe');
  assert.equal(claims.catalogVersion, sales.version);
  assert.deepEqual(claims.entities, [...parsed.entities.keys()]);
  assert.ok(parsed.entities.has('COM_ACME_SALES_ORDERS'));
  assert.match(parsed.rulesLine, /^rules: SELECT only;/);
});

test('is deterministic: same question, same catalog, same context text', () => {
  const frozen = new HmacContextIdCodec({
    key: Buffer.alloc(32, 7),
    clock: { now: () => new Date(0) },
  });
  const make = () => createBuildContext(realLookup, frozen);
  const input = { userId: 'u', environment: 'E', question: 'pedidos por vendedor' };
  assert.equal(make()(input).text, make()(input).text);
});

test('synonyms steer the search but never appear in the response', () => {
  const result = ask('razón social de los compradores');
  assert.ok(parseContext(result.text).entities.has('COM_ACME_SALES_CUSTOMERS'));
  for (const column of sales.entities.flatMap((e) => [e, ...e.columns])) {
    for (const synonym of column.synonyms) {
      assert.ok(!result.text.includes(synonym), `synonym "${synonym}" leaked`);
    }
  }
});

test('typos, accents and plurals still find the table (fuzzy, prefix, stemming)', () => {
  for (const question of ['facturaz pendientes', 'FACTURAS', 'cobros de facturas', 'envios']) {
    assert.ok(ask(question).matched, question);
  }
  assert.ok(parseContext(ask('envios').text).entities.has('COM_ACME_SALES_SHIPMENTS'));
});

test('caps: at most 5 entities and 12 columns each, with +N cols for the rest', () => {
  const columns = Array.from(
    { length: 20 },
    (_, i) => `      - { name: C${i}, type: integer, label: alpha beta${i} }`,
  ).join('\n');
  const entities = Array.from(
    { length: 8 },
    (_, i) => `  - name: T${i}\n    label: alpha table\n    columns:\n${columns}`,
  ).join('\n');
  const wide = parseCatalogYaml(
    `domain: wide\nversion: 1\nlabel: Wide\nentities:\n${entities}\n`,
    'wide',
  );
  const allHits: CatalogSearch = {
    search: (): EntityHit[] =>
      wide.entities.map((e) => ({
        entity: e.name,
        score: 10,
        columns: e.columns.map((c, i) => ({ name: c.name, score: 20 - i })),
      })),
  };
  const result = createBuildContext(
    () => ({ catalog: wide, search: allHits }),
    codec,
  )({
    userId: 'u',
    environment: 'E',
    question: 'alpha',
  });
  const parsed = parseContext(result.text);
  assert.equal(parsed.entities.size, 5);
  for (const columns of parsed.entities.values()) assert.equal(columns.length, 12);
  assert.equal(result.text.match(/\+8 cols/g)?.length, 5);
});

test('joins appear only when both ends are in the context, and their columns are shown', () => {
  const both = parseContext(ask('pedidos por cliente').text);
  assert.ok(both.joins.includes('join COM_ACME_SALES_CUSTOMERS ON CUSTOMER_ID=ID'));
  assert.ok(both.entities.get('COM_ACME_SALES_ORDERS')?.includes('CUSTOMER_ID'));
  for (const question of [
    'cuota anual de vendedores',
    'envíos por almacén',
    'categorías de producto',
  ]) {
    const parsed = parseContext(ask(question).text);
    for (const join of parsed.joins) {
      const target = /^join (\S+) ON/.exec(join)?.[1] ?? '';
      assert.ok(parsed.entities.has(target), `${question}: join to ${target} without its table`);
    }
  }
});

test('entities parameter returns every column of exactly those entities', () => {
  const result = ask('detalle', [
    'com_acme_sales_orders',
    'COM_ACME_SALES_ORDERS',
    'COM_ACME_SALES_CUSTOMERS',
  ]);
  const parsed = parseContext(result.text);
  assert.deepEqual(
    [...parsed.entities.keys()],
    ['COM_ACME_SALES_ORDERS', 'COM_ACME_SALES_CUSTOMERS'],
  );
  assert.equal(parsed.entities.get('COM_ACME_SALES_ORDERS')?.length, 12);
  assert.ok(!result.text.includes('cols'));
  assert.deepEqual(codec.open(parsed.contextId)?.entities, [...parsed.entities.keys()]);
});

test('unknown entities fail with a one-line suggestion', () => {
  assert.throws(
    () => ask('x y z', ['COM_ACME_SALES_ORDRES']),
    (error: unknown) =>
      error instanceof SanitizedError &&
      error.code === 'INPUT_INVALID' &&
      error.message.includes('Did you mean COM_ACME_SALES_ORDERS?') &&
      !error.message.includes('\n'),
  );
  assert.throws(() => ask('x y z', ['SOMETHING_ELSE_ENTIRELY']), /hana_context without entities/);
});

test('a question with no match returns an actionable overview and no context_id', () => {
  const result = ask('zzzz qqqq xxxx');
  assert.equal(result.matched, false);
  assert.deepEqual(result.entities, []);
  const lines = result.text.split('\n');
  assert.match(lines[0] ?? '', /^No table of DEV-SALES matches the question\. Rephrase/);
  assert.equal(lines.length, 1 + sales.entities.length);
  assert.ok(lines.slice(1).every((line) => /^COM_ACME_SALES_\w+ ".+"$/.test(line)));
  assert.ok(!result.text.includes('ctx='));
});

test('context stays within the 800 token budget even for a broad question', () => {
  const result = ask('pedidos clientes productos facturas pagos envíos almacenes vendedores');
  assert.ok(approxTokens(result.text) <= 800);
});
