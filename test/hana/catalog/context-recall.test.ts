import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuildContext } from '../../../src/hana/catalog/application/build-context.js';
import { HmacContextIdCodec } from '../../../src/hana/catalog/infrastructure/hmac-context-id-codec.js';
import { MiniSearchCatalogSearch } from '../../../src/hana/catalog/infrastructure/minisearch-catalog-search.js';
import { YamlCatalogSource } from '../../../src/hana/catalog/infrastructure/yaml-catalog-source.js';
import { REFERENCE_QUESTIONS } from '../../fixtures/reference-questions.js';
import { approxTokens, parseContext } from './context-text.js';

const PREFIX = 'COM_ACME_SALES_';
const catalog = new YamlCatalogSource().load('catalog/sales.catalog.yaml');
const search = new MiniSearchCatalogSearch(catalog);
const build = createBuildContext(
  () => ({ catalog, search }),
  new HmacContextIdCodec({ key: Buffer.alloc(32, 3) }),
);

const CONTEXT_TOKEN_BUDGET = 800; // POV 10.2
const RECALL_TARGET = 0.9; // POV 15

test('30 reference questions: recall of tables and fields is at least 90% (POV 15)', () => {
  assert.equal(REFERENCE_QUESTIONS.length, 30);
  let expected = 0;
  let found = 0;
  const misses: string[] = [];
  for (const reference of REFERENCE_QUESTIONS) {
    const { entities } = parseContext(
      build({ userId: 'u', environment: 'E', question: reference.question }).text,
    );
    for (const table of reference.tables) {
      expected += 1;
      if (entities.has(PREFIX + table)) found += 1;
      else misses.push(`${reference.question} -> table ${table}`);
    }
    for (const field of reference.fields) {
      const [table = '', column = ''] = field.split('.');
      expected += 1;
      if (entities.get(PREFIX + table)?.includes(column) === true) found += 1;
      else misses.push(`${reference.question} -> field ${field}`);
    }
  }
  const recall = found / expected;
  process.stderr.write(
    `recall=${(recall * 100).toFixed(1)}% (${found}/${expected}); misses: ${misses.length}\n`,
  );
  assert.ok(recall >= RECALL_TARGET, `recall ${(recall * 100).toFixed(1)}%: ${misses.join(' | ')}`);
});

test('every reference context stays within 800 tokens (bytes / 4) and 5 tables x 12 columns', () => {
  let worst = 0;
  for (const { question } of REFERENCE_QUESTIONS) {
    const text = build({ userId: 'u', environment: 'E', question }).text;
    const tokens = approxTokens(text);
    worst = Math.max(worst, tokens);
    assert.ok(tokens <= CONTEXT_TOKEN_BUDGET, `${question}: ~${tokens} tokens`);
    const { entities } = parseContext(text);
    assert.ok(entities.size <= 5);
    for (const columns of entities.values()) assert.ok(columns.length <= 12);
  }
  process.stderr.write(`worst context = ~${worst} tokens (budget ${CONTEXT_TOKEN_BUDGET})\n`);
});
