import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SqlRejection } from '../../../../src/hana/query/domain/sql-rejection.js';
import { validateSql } from '../../../../src/hana/query/domain/sql-validator.js';
import { NodeSqlParserAdapter } from '../../../../src/hana/query/infrastructure/node-sql-parser-adapter.js';
import { POSITIVE, catalogView, contextEntities } from '../query-fixtures.js';

/** Deterministic PRNG (mulberry32): the same seed always explores the same mutants. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// CI uses the fixed defaults; set STRAHANA_FUZZ_SEED / STRAHANA_FUZZ_ITERATIONS to explore further.
export const FUZZ_SEED = Number(process.env['STRAHANA_FUZZ_SEED'] ?? 0xc0ffee);
export const FUZZ_ITERATIONS = Number(process.env['STRAHANA_FUZZ_ITERATIONS'] ?? 20000);

const FRAGMENTS = [
  '; DROP TABLE COM_ACME_SALES_ORDERS',
  ';',
  ' -- x',
  ' /* x */',
  '/*',
  ' UNION SELECT ID FROM COM_ACME_SALES_CUSTOMERS',
  ' UNION ALL SELECT ID FROM COM_ACME_SALES_CUSTOMERS',
  ' LIMIT 1',
  ' OFFSET 1',
  ' TOP 5 ',
  ' INTO NEWT',
  ' FOR UPDATE',
  ' OVER (ORDER BY ID)',
  ' CROSS JOIN COM_ACME_SALES_CUSTOMERS',
  ' , COM_ACME_SALES_CUSTOMERS',
  ' NATURAL JOIN COM_ACME_SALES_CUSTOMERS',
  ' RIGHT JOIN COM_ACME_SALES_CUSTOMERS c2 ON 1=1',
  ' WITH x AS (SELECT 1 FROM COM_ACME_SALES_ORDERS)',
  'SYS.',
  '_SYS_BI.',
  'SYS_USERS',
  'SALES_HDI_DB_1.',
  '*',
  'o.*',
  'DELETE FROM COM_ACME_SALES_ORDERS',
  'INSERT INTO COM_ACME_SALES_ORDERS (ID) VALUES (1)',
  'UPDATE COM_ACME_SALES_ORDERS SET ID = 1',
  'CREATE TABLE X (A INT)',
  'CALL P()',
  'SESSION_CONTEXT(',
  'CURRENT_USER',
  'MYFUNC(',
  '::int',
  '\\',
  '`',
  '#',
  '\u0000',
  '；',
  'Е',
  ' ',
  ' EXCEPT SELECT 1',
  ' INTERSECT SELECT 1',
  ' FETCH FIRST 1 ROWS ONLY',
  ' ORDER BY NOPE',
  ' (SELECT ID FROM COM_ACME_SALES_INVOICES)',
  ' COM_ACME_SALES_INVOICES',
  ' COM_ACME_HR_SALARIES',
  "'",
  '"',
  "''",
];

const VOCABULARY = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'ON',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'GROUP',
  'BY',
  'HAVING',
  'ORDER',
  'UNION',
  'INSERT',
  'DELETE',
  'DROP',
  'LIMIT',
  'TOP',
  'INTO',
  'OVER',
  'WITH',
  'COUNT',
  'SUM',
  'UPPER',
  'CAST',
  'AS',
  'NULL',
  'CASE',
  'WHEN',
  'THEN',
  'END',
  '*',
  '(',
  ')',
  ',',
  '.',
  '=',
  '<>',
  '||',
  '-',
  'ID',
  'NAME',
  'o',
  'c',
  "'x'",
  '1',
  'COM_ACME_SALES_INVOICES',
  'SYS',
  'DUMMY',
];

function tokens(sql: string): string[] {
  return sql.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|\w+|\s+|[^\w\s]/g) ?? [sql];
}

function mutate(base: string, random: () => number): string {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  let parts = tokens(base);
  const rounds = 1 + Math.floor(random() * 3);
  for (let r = 0; r < rounds; r++) {
    const at = Math.floor(random() * (parts.length + 1));
    switch (Math.floor(random() * 6)) {
      case 0:
        parts.splice(at, 0, pick(FRAGMENTS));
        break;
      case 1:
        parts.splice(at, 1);
        break;
      case 2:
        parts.splice(at, 1, pick(VOCABULARY));
        break;
      case 3: {
        const from = Math.floor(random() * parts.length);
        parts.splice(at, 0, ...parts.slice(from, from + 1 + Math.floor(random() * 4)));
        break;
      }
      case 4:
        parts = parts.map((part) => (random() < 0.05 ? part.toLowerCase() : part));
        break;
      default: {
        const text = parts.join('');
        const index = Math.floor(random() * text.length);
        parts = [text.slice(0, index) + pick(FRAGMENTS) + text.slice(index + 1)];
      }
    }
  }
  return parts.join('');
}

const FORBIDDEN_WORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'CREATE',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'CALL',
  'MERGE',
  'UPSERT',
  'EXEC',
  'EXECUTE',
  'INTO',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'WITH',
  'LIMIT',
  'OFFSET',
  'TOP',
  'OVER',
  'FETCH',
  'FOR',
  'WINDOW',
  'CROSS',
  'NATURAL',
  'USING',
  'RIGHT',
  'FULL',
  'ROLLUP',
  'CUBE',
  'SYS',
  'DUAL',
  'SESSION_CONTEXT',
  'CURRENT_USER',
];

/** Strips quoted regions so only code is inspected. */
function code(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * Independent oracle: a statement the validator accepted must not contain any construct the
 * policy forbids. It looks at the raw text, not at the parser, so it cannot share its blind spots.
 */
function assertSafe(sql: string): void {
  const text = code(sql).replace(/\bEXTRACT\s*\(\s*\w+\s+FROM\b/gi, 'EXTRACT(X,');
  assert.match(text, /^\s*SELECT\b/i, `not a SELECT: ${sql}`);
  assert.doesNotMatch(text, /;|--|\/\*|\\|`|#|::/, `separator or comment accepted: ${sql}`);
  assert.doesNotMatch(
    sql.replace(/'(?:[^']|'')*'/g, "''"),
    /[^\x20-\x7e\t\n\r]/,
    `non-ASCII code accepted: ${sql}`,
  );
  // An alias (`AS TOP`) is a name, not a construct: it is harmless and fails inside HANA.
  const withoutAliases = text
    .replace(/\bAS\s+\w+/gi, 'AS _alias')
    .replace(/(\)|[\w'"]\s)\s*\w+(?=\s*,|\s+FROM\b)/gi, '$1 _alias');
  for (const word of FORBIDDEN_WORDS) {
    assert.doesNotMatch(
      withoutAliases,
      new RegExp(`\\b${word}\\b`, 'i'),
      `${word} accepted: ${sql}`,
    );
  }
  assert.doesNotMatch(text, /\bSELECT\s+(DISTINCT\s+)?\*/i, `SELECT * accepted: ${sql}`);
  assert.doesNotMatch(text, /\w\s*\.\s*\*/, `qualified star accepted: ${sql}`);
  assert.doesNotMatch(text, /\bFROM\s+[^()\s]+\s*,/i, `comma join accepted: ${sql}`);
  assert.doesNotMatch(text, /\w\s*\.\s*\w+\s*\.\s*\w/i, `schema-qualified name accepted: ${sql}`);
  const allowedTables = [...contextEntities].map((name) => name.toUpperCase());
  for (const match of text.matchAll(/\b(?:FROM|JOIN)\s+("?)([A-Za-z0-9_$#.]+)\1/gi)) {
    const name = (match[2] ?? '').toUpperCase();
    assert.ok(allowedTables.includes(name), `table outside the context accepted (${name}): ${sql}`);
  }
}

test(`fuzz: ${FUZZ_ITERATIONS} seeded mutants never get a forbidden construct accepted`, (t) => {
  const parser = new NodeSqlParserAdapter();
  const corpus = [
    ...POSITIVE,
    ...(JSON.parse(readFileSync('test/fixtures/sql/allowed.json', 'utf8')) as string[]),
  ];
  const random = prng(FUZZ_SEED);
  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < FUZZ_ITERATIONS; i++) {
    const base = corpus[Math.floor(random() * corpus.length)] ?? '';
    const sql = mutate(base, random);
    try {
      const result = validateSql({
        sql,
        parser,
        catalog: catalogView,
        contextEntities,
        environment: 'E',
      });
      assert.equal(result.sql, sql);
      assertSafe(sql);
      accepted++;
    } catch (error) {
      if (!(error instanceof SqlRejection)) throw error;
      assert.ok(!error.message.includes('\n'));
      rejected++;
    }
  }
  t.diagnostic(
    `fuzz seed=${FUZZ_SEED} iterations=${FUZZ_ITERATIONS} accepted=${accepted} rejected=${rejected}`,
  );
  assert.equal(accepted + rejected, FUZZ_ITERATIONS);
  assert.ok(
    rejected > FUZZ_ITERATIONS / 4,
    `mutants should mostly be rejected (rejected=${rejected})`,
  );
  assert.ok(accepted > 100, `some benign mutants must still be accepted (accepted=${accepted})`);
});

test('fuzz is deterministic for a given seed', () => {
  const a = prng(FUZZ_SEED);
  const b = prng(FUZZ_SEED);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});
