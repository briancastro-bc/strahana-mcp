import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyzeSql } from '../../../../src/hana/query/domain/sql-analyzer.js';
import { SqlRejection } from '../../../../src/hana/query/domain/sql-rejection.js';
import { NodeSqlParserAdapter } from '../../../../src/hana/query/infrastructure/node-sql-parser-adapter.js';

// Corpus ported from the approved Phase 0 spike (synthetic names). The only change: a single
// trailing semicolon moved from forbidden to allowed (approved after Phase 3). It exercises stage 1 only
// (syntax and policy); resolution against the catalog is covered by sql-validator.test.ts.
const load = (file: string): unknown =>
  JSON.parse(readFileSync(`test/fixtures/sql/${file}`, 'utf8'));
const allowed = load('allowed.json') as string[];
const forbidden = load('forbidden.json') as { sql: string; label: string }[];
const gaps = load('hana-gaps.json') as { sql: string; gap: string }[];

const parser = new NodeSqlParserAdapter();

test('corpus sizes are the ones of the spike', () => {
  assert.equal(allowed.length, 63);
  assert.equal(forbidden.length, 101);
  assert.equal(gaps.length, 8);
});

test('allowed corpus is accepted by the policy', async (t) => {
  for (const sql of allowed) {
    await t.test(sql.slice(0, 90), () => {
      const analysis = analyzeSql(sql, parser);
      assert.ok(analysis.tables.length > 0);
    });
  }
});

test('forbidden corpus is rejected with a SqlRejection (fail closed)', async (t) => {
  for (const { sql, label } of forbidden) {
    await t.test(label, () => {
      assert.throws(
        () => analyzeSql(sql, parser),
        (error: unknown) => {
          assert.ok(error instanceof SqlRejection, `SLIPPED THROUGH or crashed: ${sql}`);
          assert.ok(!error.message.includes('\n'));
          return true;
        },
      );
    });
  }
});

const isPolicyGap = (gap: string) => gap.includes('policy gap');

test('parser gaps stay rejected (fail closed) with a one-line, actionable error', async (t) => {
  for (const { sql, gap } of gaps.filter((g) => !isPolicyGap(g.gap))) {
    await t.test(gap, () => {
      assert.throws(
        () => analyzeSql(sql, parser),
        (error: unknown) => {
          assert.ok(error instanceof SqlRejection);
          assert.ok(!error.message.includes('\n'));
          return true;
        },
      );
    });
  }
});

test('policy gaps of the spike (TO_VARCHAR, LOCATE) are now whitelisted', async (t) => {
  for (const { sql, gap } of gaps.filter((g) => isPolicyGap(g.gap))) {
    await t.test(sql, () => {
      assert.ok(analyzeSql(sql, parser).tables.length > 0, gap);
    });
  }
});

test('unsupported HANA syntax errors name the supported alternative', () => {
  const nvarchar = gaps.find((g) => g.sql.includes('NVARCHAR'))?.sql ?? '';
  assert.throws(() => analyzeSql(nvarchar, parser), /VARCHAR.*NVARCHAR.*not supported/);
  const fromFor = gaps.find((g) => g.sql.includes('FROM 1 FOR'))?.sql ?? '';
  assert.throws(() => analyzeSql(fromFor, parser), /SUBSTRING\(x, start, length\)/);
  assert.throws(() => analyzeSql('SELECT TOP 10 a FROM T', parser), /limit parameter/);
});
