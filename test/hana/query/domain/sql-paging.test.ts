import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendPaging } from '../../../../src/hana/query/domain/sql-paging.js';
import { validateSql } from '../../../../src/hana/query/domain/sql-validator.js';
import { NodeSqlParserAdapter } from '../../../../src/hana/query/infrastructure/node-sql-parser-adapter.js';
import { POSITIVE, catalogView, contextEntities } from '../query-fixtures.js';

test('appends LIMIT and OFFSET to the original text without touching it', () => {
  const sql = "SELECT ID FROM T WHERE NOTES = 'a b'\n ORDER BY ID";
  const paged = appendPaging(sql, 51, 100);
  assert.equal(paged, `${sql} LIMIT 51 OFFSET 100`);
  assert.ok(paged.startsWith(sql));
});

test('rejects non-integer, non-positive and unsafe paging values', () => {
  for (const [limit, offset] of [
    [0, 0],
    [-1, 0],
    [1.5, 0],
    [Number.NaN, 0],
    [1, -1],
    [1, 0.5],
    [Number.MAX_SAFE_INTEGER + 2, 0],
    [1, Number.POSITIVE_INFINITY],
  ] as const) {
    assert.throws(() => appendPaging('SELECT 1', limit, offset), RangeError);
  }
});

test('every validated statement stays well formed once the paging suffix is added', () => {
  const parser = new NodeSqlParserAdapter();
  for (const sql of POSITIVE) {
    const validated = validateSql({
      sql,
      parser,
      catalog: catalogView,
      contextEntities,
      environment: 'E',
    });
    const paged = appendPaging(validated.sql, 11, 22);
    const ast = parser.parse(paged) as { limit?: { value?: { value: number }[] } };
    assert.ok(!Array.isArray(ast), paged);
    assert.deepEqual(
      ast.limit?.value?.map((v) => v.value),
      [11, 22],
      paged,
    );
  }
});

test('an input with a trailing semicolon is paged as valid SQL: the semicolon never reaches the suffix', () => {
  const parser = new NodeSqlParserAdapter();
  for (const sql of [
    'SELECT ID FROM COM_ACME_SALES_ORDERS;',
    'SELECT ID FROM COM_ACME_SALES_ORDERS ORDER BY ID ;\n',
  ]) {
    const validated = validateSql({
      sql,
      parser,
      catalog: catalogView,
      contextEntities,
      environment: 'E',
    });
    const paged = appendPaging(validated.sql, 11, 22);
    assert.ok(!paged.includes(';'), paged);
    assert.match(paged, / LIMIT 11 OFFSET 22$/);
    const ast = parser.parse(paged) as { limit?: { value?: { value: number }[] } };
    assert.ok(!Array.isArray(ast), paged);
    assert.deepEqual(
      ast.limit?.value?.map((v) => v.value),
      [11, 22],
      paged,
    );
  }
});
