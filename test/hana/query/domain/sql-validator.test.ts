import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSql } from '../../../../src/hana/query/domain/sql-validator.js';
import {
  SqlRejection,
  type SqlRejectionCode,
} from '../../../../src/hana/query/domain/sql-rejection.js';
import { NodeSqlParserAdapter } from '../../../../src/hana/query/infrastructure/node-sql-parser-adapter.js';
import { POSITIVE, catalogView, contextEntities } from '../query-fixtures.js';

// Built from code points on purpose: irregular whitespace in source is invisible.
const NBSP = String.fromCharCode(0x00a0);
const ZWSP = String.fromCharCode(0x200b);
const MINUS = String.fromCharCode(0x2212);

const parser = new NodeSqlParserAdapter();
const O = 'COM_ACME_SALES_ORDERS';
const C = 'COM_ACME_SALES_CUSTOMERS';
const I = 'COM_ACME_SALES_ORDERITEMS';
const P = 'COM_ACME_SALES_PRODUCTS';

function validate(sql: string) {
  return validateSql({
    sql,
    parser,
    catalog: catalogView,
    contextEntities,
    environment: 'DEV-SALES',
  });
}

function rejection(sql: string): SqlRejection {
  try {
    validate(sql);
  } catch (error) {
    assert.ok(error instanceof SqlRejection, `unexpected non-rejection for: ${sql}`);
    assert.ok(!error.message.includes('\n'), 'message must be one line');
    assert.ok(error.message.length <= 300, 'message must stay short');
    return error;
  }
  throw new assert.AssertionError({ message: `ACCEPTED, expected rejection: ${sql}` });
}

test('positive cases are accepted and return the original text untouched', async (t) => {
  for (const sql of POSITIVE) {
    await t.test(sql.slice(0, 80), () => {
      const result = validate(sql);
      assert.equal(result.sql, sql, 'the executed text must be the original, never regenerated');
      assert.ok(result.tables.length > 0);
      for (const table of result.tables) assert.ok(contextEntities.has(table));
    });
  }
});

test('tables used are reported by physical name, deduplicated', () => {
  const result = validate(
    `select o.id from com_acme_sales_orders o join ${C} c on c.id = o.customer_id where o.id in (select p.id from ${O} p)`,
  );
  assert.deepEqual(result.tables, [O, C]);
});

test('hasOrderBy reflects the top-level SELECT only', () => {
  assert.equal(validate(`SELECT ID FROM ${O} ORDER BY ID`).hasOrderBy, true);
  assert.equal(validate(`SELECT ID FROM ${O}`).hasOrderBy, false);
  assert.equal(validate(`SELECT x.ID FROM (SELECT ID FROM ${O} ORDER BY ID) x`).hasOrderBy, false);
});

test('a single trailing semicolon (and trailing whitespace) is stripped before validation', async (t) => {
  const base = `SELECT ID FROM ${O}`;
  const cases: [string, string][] = [
    [`${base};`, base],
    [`${base};\n`, base],
    [`${base} ;  \t\r\n`, base],
    [`${base}\n;`, base],
    [`${base} ORDER BY ID;`, `${base} ORDER BY ID`],
    [`${base} WHERE NOTES = 'a;b';`, `${base} WHERE NOTES = 'a;b'`],
    [`${base} WHERE NOTES = 'a;';`, `${base} WHERE NOTES = 'a;'`],
    [`${base} WHERE NOTES = 'x'';';`, `${base} WHERE NOTES = 'x'';'`],
    [`${base} WHERE "ID" = 'a;'`, `${base} WHERE "ID" = 'a;'`],
  ];
  for (const [sql, expected] of cases) {
    await t.test(JSON.stringify(sql), () => {
      const result = validate(sql);
      assert.equal(result.sql, expected);
      assert.deepEqual(result.tables, [O]);
    });
  }
});

test('a semicolon inside a literal at the very end is never stripped', () => {
  const sql = `SELECT ID FROM ${O} WHERE NOTES = 'a;'`;
  assert.equal(validate(sql).sql, sql);
});

test('multi-statement errors say the semicolon is only accepted once at the end', () => {
  for (const sql of [`SELECT ID FROM ${O};;`, `SELECT ID FROM ${O}; SELECT ID FROM ${C}`]) {
    assert.match(
      rejection(sql).message,
      /Only one statement is allowed; ";" is only accepted once/,
    );
  }
});

interface Negative {
  label: string;
  sql: string;
  code: SqlRejectionCode;
}

const NEGATIVE: readonly Negative[] = [
  // not a SELECT
  { label: 'INSERT', sql: `INSERT INTO ${O} (ID) VALUES ('1')`, code: 'SQL_NOT_SELECT' },
  { label: 'UPDATE', sql: `UPDATE ${O} SET NOTES = 'x'`, code: 'SQL_NOT_SELECT' },
  { label: 'DELETE', sql: `DELETE FROM ${O}`, code: 'SQL_NOT_SELECT' },
  { label: 'DROP TABLE', sql: `DROP TABLE ${O}`, code: 'SQL_NOT_SELECT' },
  { label: 'CREATE TABLE', sql: 'CREATE TABLE T (A INTEGER)', code: 'SQL_NOT_SELECT' },
  { label: 'ALTER TABLE', sql: `ALTER TABLE ${O} ADD (X INTEGER)`, code: 'SQL_NOT_SELECT' },
  { label: 'TRUNCATE', sql: `TRUNCATE TABLE ${O}`, code: 'SQL_NOT_SELECT' },
  { label: 'GRANT', sql: `GRANT SELECT ON ${O} TO PUBLIC`, code: 'SQL_NOT_SELECT' },
  { label: 'CALL', sql: 'CALL PROC()', code: 'SQL_NOT_SELECT' },
  {
    label: 'MERGE',
    sql: `MERGE INTO ${O} USING ${C} ON 1=1 WHEN MATCHED THEN DELETE`,
    code: 'SQL_NOT_SELECT',
  },
  { label: 'UPSERT', sql: `UPSERT ${O} VALUES (1)`, code: 'SQL_NOT_SELECT' },
  { label: 'EXPLAIN', sql: `EXPLAIN PLAN FOR SELECT ID FROM ${O}`, code: 'SQL_NOT_SELECT' },
  { label: 'SET', sql: 'SET SCHEMA SYS', code: 'SQL_NOT_SELECT' },
  { label: 'lowercase delete', sql: `delete from ${O}`, code: 'SQL_NOT_SELECT' },
  { label: 'empty', sql: '   ', code: 'SQL_PARSE' },
  { label: 'garbage', sql: 'hello world', code: 'SQL_NOT_SELECT' },
  // stacked statements, comments and hidden payloads
  { label: 'stacked drop', sql: `SELECT ID FROM ${O}; DROP TABLE ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'stacked select',
    sql: `SELECT ID FROM ${O}; SELECT ID FROM ${C}`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'double semicolon', sql: `SELECT ID FROM ${O};;`, code: 'SQL_FORBIDDEN' },
  { label: 'semicolons separated by space', sql: `SELECT ID FROM ${O}; ;`, code: 'SQL_FORBIDDEN' },
  { label: 'space before double semicolon', sql: `SELECT ID FROM ${O} ;;`, code: 'SQL_FORBIDDEN' },
  {
    label: 'semicolon followed by line comment',
    sql: `SELECT ID FROM ${O};--c`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'semicolon followed by block comment',
    sql: `SELECT ID FROM ${O}; /*x*/`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'semicolon alone', sql: ';', code: 'SQL_PARSE' },
  { label: 'semicolon after whitespace only', sql: '  ;\n', code: 'SQL_PARSE' },
  { label: 'semicolon mid-statement', sql: `SELECT ID; FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'semicolon then non-breaking space then text',
    sql: `SELECT ID FROM ${O};${NBSP}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'semicolon then control char',
    sql: `SELECT ID FROM ${O};\u0000`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'semicolon after an unterminated literal',
    sql: `SELECT ID FROM ${O} WHERE NOTES = 'a;`,
    code: 'SQL_PARSE',
  },
  { label: 'line comment', sql: `SELECT ID FROM ${O} -- hi`, code: 'SQL_FORBIDDEN' },
  {
    label: 'line comment hides tail',
    sql: `SELECT ID FROM ${O} WHERE 1=1 --\n AND 1=0`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'block comment', sql: `SELECT /* x */ ID FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'block comment payload',
    sql: `SELECT ID FROM ${O} /*; DROP TABLE ${O}; */`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'comment splits keyword', sql: `SEL/**/ECT ID FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'backslash escape',
    sql: `SELECT ID FROM ${O} WHERE NOTES = 'a\\'' OR 1=1 --'`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'unterminated quote', sql: `SELECT ID FROM ${O} WHERE NOTES = 'abc`, code: 'SQL_PARSE' },
  { label: 'unterminated identifier quote', sql: `SELECT "ID FROM ${O}`, code: 'SQL_PARSE' },
  { label: 'backtick identifier', sql: 'SELECT `ID` FROM ' + O, code: 'SQL_FORBIDDEN' },
  { label: 'hash temp table', sql: 'SELECT ID FROM #TMP', code: 'SQL_FORBIDDEN' },
  { label: 'control char NUL', sql: `SELECT ID FROM ${O}\u0000`, code: 'SQL_FORBIDDEN' },
  { label: 'control char outside quotes', sql: `SELECT\u0007 ID FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'control char inside literal',
    sql: `SELECT ID FROM ${O} WHERE NOTES = 'a\u0001b'`,
    code: 'SQL_FORBIDDEN',
  },
  // unicode look-alikes outside quotes
  {
    label: 'fullwidth semicolon',
    sql: `SELECT ID FROM ${O}； DROP TABLE ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'cyrillic keyword', sql: `SЕLECT ID FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'cyrillic table name',
    sql: `SELECT ID FROM COM_ACME_SALES_ОRDERS`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'non-breaking space', sql: `SELECT${NBSP}ID FROM ${O}`, code: 'SQL_FORBIDDEN' },
  { label: 'zero width space', sql: `SELECT ID${ZWSP} FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'unicode minus comment',
    sql: `SELECT ID FROM ${O} ${MINUS}${MINUS} x`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'lookalike inside quoted identifier is just unknown',
    sql: `SELECT "IDа" FROM ${O}`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  // star, limits and clauses outside the subset
  { label: 'SELECT *', sql: `SELECT * FROM ${O}`, code: 'SQL_FORBIDDEN' },
  { label: 'qualified star', sql: `SELECT o.* FROM ${O} o`, code: 'SQL_FORBIDDEN' },
  { label: 'star mixed', sql: `SELECT COUNT(*) AS n, * FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'star in subquery',
    sql: `SELECT ID FROM ${O} WHERE ID IN (SELECT * FROM ${C})`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'LIMIT', sql: `SELECT ID FROM ${O} LIMIT 10`, code: 'SQL_FORBIDDEN' },
  { label: 'LIMIT OFFSET', sql: `SELECT ID FROM ${O} LIMIT 10 OFFSET 5`, code: 'SQL_FORBIDDEN' },
  { label: 'OFFSET', sql: `SELECT ID FROM ${O} OFFSET 5`, code: 'SQL_FORBIDDEN' },
  { label: 'TOP', sql: `SELECT TOP 10 ID FROM ${O}`, code: 'SQL_PARSE' },
  {
    label: 'LIMIT in subquery',
    sql: `SELECT ID FROM ${O} WHERE ID IN (SELECT ID FROM ${C} LIMIT 1)`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'FETCH FIRST', sql: `SELECT ID FROM ${O} FETCH FIRST 5 ROWS ONLY`, code: 'SQL_PARSE' },
  { label: 'CTE', sql: `WITH x AS (SELECT ID FROM ${O}) SELECT ID FROM x`, code: 'SQL_FORBIDDEN' },
  { label: 'UNION', sql: `SELECT ID FROM ${O} UNION SELECT ID FROM ${C}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'UNION ALL',
    sql: `SELECT ID FROM ${O} UNION ALL SELECT ID FROM ${C}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'INTERSECT',
    sql: `SELECT ID FROM ${O} INTERSECT SELECT ID FROM ${C}`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'EXCEPT', sql: `SELECT ID FROM ${O} EXCEPT SELECT ID FROM ${C}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'UNION in subquery',
    sql: `SELECT ID FROM ${O} WHERE ID IN (SELECT ID FROM ${C} UNION SELECT ID FROM ${P})`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'window function',
    sql: `SELECT ROW_NUMBER() OVER (ORDER BY ID) AS r FROM ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'aggregate over window',
    sql: `SELECT SUM(TOTALAMOUNT) OVER (PARTITION BY CUSTOMER_ID) AS s FROM ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'WINDOW clause',
    sql: `SELECT SUM(TOTALAMOUNT) OVER w AS s FROM ${O} WINDOW w AS (PARTITION BY CUSTOMER_ID)`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'INTO table', sql: `SELECT ID INTO NEWT FROM ${O}`, code: 'SQL_FORBIDDEN' },
  { label: 'INTO variable', sql: `SELECT ID INTO :v FROM ${O}`, code: 'SQL_FORBIDDEN' },
  { label: 'FOR UPDATE', sql: `SELECT ID FROM ${O} FOR UPDATE`, code: 'SQL_FORBIDDEN' },
  {
    label: 'ROLLUP',
    sql: `SELECT CUSTOMER_ID, SUM(TOTALAMOUNT) AS s FROM ${O} GROUP BY ROLLUP(CUSTOMER_ID)`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'parenthesized top level', sql: `(SELECT ID FROM ${O})`, code: 'SQL_FORBIDDEN' },
  { label: 'no FROM', sql: 'SELECT 1', code: 'SQL_PARSE' },
  { label: 'DUAL', sql: 'SELECT 1 FROM DUAL', code: 'SQL_FORBIDDEN' },
  // joins and size limits
  { label: 'CROSS JOIN', sql: `SELECT o.ID FROM ${O} o CROSS JOIN ${C} c`, code: 'SQL_FORBIDDEN' },
  {
    label: 'comma join',
    sql: `SELECT o.ID FROM ${O} o, ${C} c WHERE o.CUSTOMER_ID = c.ID`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'RIGHT JOIN',
    sql: `SELECT o.ID FROM ${O} o RIGHT JOIN ${C} c ON c.ID = o.CUSTOMER_ID`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'FULL JOIN',
    sql: `SELECT o.ID FROM ${O} o FULL JOIN ${C} c ON c.ID = o.CUSTOMER_ID`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'NATURAL JOIN', sql: `SELECT o.ID FROM ${O} o NATURAL JOIN ${C} c`, code: 'SQL_PARSE' },
  {
    label: 'JOIN USING',
    sql: `SELECT o.ID FROM ${O} o JOIN ${C} c USING (ID)`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'JOIN without ON', sql: `SELECT o.ID FROM ${O} o JOIN ${C} c`, code: 'SQL_FORBIDDEN' },
  {
    label: '5 tables',
    sql: `SELECT o.ID FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID JOIN ${I} i ON i.ORDER_ID = o.ID JOIN ${P} p ON p.ID = i.PRODUCT_ID JOIN COM_ACME_SALES_PRODUCTCATEGORIES g ON g.ID = p.CATEGORY_ID`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: '5 tables counting subqueries',
    sql: `SELECT o.ID FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID JOIN ${I} i ON i.ORDER_ID = o.ID WHERE o.ID IN (SELECT p.ID FROM ${P} p WHERE p.ID IN (SELECT g.ID FROM COM_ACME_SALES_PRODUCTCATEGORIES g))`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: '3 levels of subqueries',
    sql: `SELECT a.ID FROM (SELECT b.ID FROM (SELECT c.ID FROM (SELECT d.ID FROM ${O} d) c) b) a`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'derived table without alias',
    sql: `SELECT ID FROM (SELECT ID FROM ${O})`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'duplicated alias',
    sql: `SELECT o.ID FROM ${O} o JOIN ${C} o ON o.ID = o.ID`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'SQL longer than 4000 characters',
    sql: `SELECT ID FROM ${O} WHERE ${Array.from({ length: 300 }, () => "NOTES = 'abcdefghij'").join(' OR ')}`,
    code: 'SQL_FORBIDDEN',
  },
  // schemas and system objects
  {
    label: 'schema qualified table',
    sql: `SELECT ID FROM SALES_HDI_DB_1.${O}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'quoted schema qualified table',
    sql: `SELECT ID FROM "SALES_HDI_DB_1"."${O}"`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'schema qualified column',
    sql: `SELECT SALES_HDI_DB_1.${O}.ID FROM ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'SYS table', sql: 'SELECT SCHEMA_NAME FROM SYS.SCHEMAS', code: 'SQL_FORBIDDEN' },
  {
    label: 'SYS view without schema',
    sql: 'SELECT USER_NAME FROM SYS_USERS',
    code: 'SQL_FORBIDDEN',
  },
  { label: '_SYS_ object', sql: 'SELECT ID FROM _SYS_BI.BIMC_ALL_CUBES', code: 'SQL_FORBIDDEN' },
  {
    label: 'M_ monitoring view',
    sql: 'SELECT HOST FROM M_DATABASE',
    code: 'SQL_ENTITY_UNAVAILABLE',
  },
  {
    label: 'SYS in subquery',
    sql: `SELECT ID FROM ${O} WHERE ID IN (SELECT USER_NAME FROM SYS.USERS)`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'DUMMY', sql: 'SELECT DUMMY FROM DUMMY', code: 'SQL_ENTITY_UNAVAILABLE' },
  // functions and operators
  {
    label: 'SESSION_CONTEXT',
    sql: `SELECT SESSION_CONTEXT('X') AS v FROM ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'CURRENT_USER', sql: `SELECT CURRENT_USER AS u FROM ${O}`, code: 'SQL_PARSE' },
  {
    label: 'user function',
    sql: `SELECT MYSCHEMA.MYFUNC(ID) AS v FROM ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'schema-qualified whitelisted function',
    sql: `SELECT SYS.UPPER(NAME) AS u FROM ${C}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'schema-qualified whitelisted function (user schema)',
    sql: `SELECT MYSCHEMA.LOCATE(NAME, 'A') AS p FROM ${C}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'unknown function',
    sql: `SELECT DROP_EVERYTHING(ID) AS v FROM ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'string_agg',
    sql: `SELECT STRING_AGG(NAME, ',') AS v FROM ${C}`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'sleep-like function', sql: `SELECT SLEEP(10) AS v FROM ${O}`, code: 'SQL_FORBIDDEN' },
  { label: 'postgres cast', sql: `SELECT ID::int AS v FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'cast to unsupported type',
    sql: `SELECT CAST(ID AS TEXT) AS v FROM ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'regex operator', sql: `SELECT ID FROM ${O} WHERE NOTES ~ 'a'`, code: 'SQL_FORBIDDEN' },
  { label: 'JSON operator', sql: `SELECT NOTES->>'a' AS v FROM ${O}`, code: 'SQL_FORBIDDEN' },
  { label: 'array literal', sql: `SELECT ARRAY[1,2] AS v FROM ${O}`, code: 'SQL_FORBIDDEN' },
  { label: 'dollar quoting', sql: `SELECT $$x$$ AS v FROM ${O}`, code: 'SQL_FORBIDDEN' },
  { label: 'bind parameter', sql: `SELECT ID FROM ${O} WHERE ID = ?`, code: 'SQL_PARSE' },
  {
    label: 'collate',
    sql: `SELECT ID FROM ${O} WHERE NOTES COLLATE "C" = 'a'`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'ESCAPE with expression',
    sql: `SELECT ID FROM ${O} WHERE NOTES LIKE 'a' ESCAPE (SELECT NOTES FROM ${O})`,
    code: 'SQL_PARSE',
  },
  {
    label: 'interval',
    sql: `SELECT ID FROM ${O} WHERE CREATEDAT > CURRENT_DATE - INTERVAL '1 day'`,
    code: 'SQL_FORBIDDEN',
  },
  // syntax the parser knows from other dialects, or HANA extensions the subset does not cover
  { label: 'national string literal', sql: `SELECT N'abc' AS a FROM ${O}`, code: 'SQL_PARSE' },
  { label: 'hex string literal', sql: `SELECT X'41' AS a FROM ${O}`, code: 'SQL_PARSE' },
  {
    label: 'adjacent string literals',
    sql: `SELECT ID FROM ${O} WHERE NOTES = 'x' 'y'`,
    code: 'SQL_PARSE',
  },
  {
    label: 'TABLESAMPLE',
    sql: `SELECT ID FROM ${O} TABLESAMPLE SYSTEM (10)`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'WITH HINT', sql: `SELECT ID FROM ${O} WITH HINT (NO_CS_JOIN)`, code: 'SQL_PARSE' },
  {
    label: 'FOR SYSTEM_TIME',
    sql: `SELECT ID FROM ${O} FOR SYSTEM_TIME AS OF '2024-01-01'`,
    code: 'SQL_PARSE',
  },
  {
    label: 'GROUPING SETS',
    sql: `SELECT CUSTOMER_ID FROM ${O} GROUP BY GROUPING SETS ((CUSTOMER_ID))`,
    code: 'SQL_PARSE',
  },
  {
    label: 'ANY subquery',
    sql: `SELECT ID FROM ${O} WHERE ID = ANY (SELECT ID FROM ${C})`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'NULLS FIRST',
    sql: `SELECT ID FROM ${O} ORDER BY ID NULLS FIRST`,
    code: 'SQL_FORBIDDEN',
  },
  {
    label: 'SIMILAR TO',
    sql: `SELECT ID FROM ${O} WHERE NOTES SIMILAR TO 'x'`,
    code: 'SQL_FORBIDDEN',
  },
  { label: 'array index', sql: `SELECT NOTES[1] AS v FROM ${O}`, code: 'SQL_FORBIDDEN' },
  {
    label: 'TRIM with BOTH',
    sql: `SELECT TRIM(BOTH 'x' FROM NOTES) AS v FROM ${O}`,
    code: 'SQL_FORBIDDEN',
  },
  // catalog and context
  {
    label: 'table not in context',
    sql: 'SELECT ID FROM COM_ACME_SALES_INVOICES',
    code: 'SQL_ENTITY_NOT_IN_CONTEXT',
  },
  {
    label: 'table not in context (join)',
    sql: `SELECT o.ID FROM ${O} o JOIN COM_ACME_SALES_INVOICES v ON v.ORDER_ID = o.ID`,
    code: 'SQL_ENTITY_NOT_IN_CONTEXT',
  },
  {
    label: 'table not in context (subquery)',
    sql: `SELECT ID FROM ${O} WHERE ID IN (SELECT ORDER_ID FROM COM_ACME_SALES_INVOICES)`,
    code: 'SQL_ENTITY_NOT_IN_CONTEXT',
  },
  {
    label: 'table not in catalog',
    sql: 'SELECT ID FROM COM_ACME_HR_SALARIES',
    code: 'SQL_ENTITY_UNAVAILABLE',
  },
  {
    label: 'table not in catalog (subquery)',
    sql: `SELECT ID FROM ${O} WHERE ID IN (SELECT ID FROM COM_ACME_HR_SALARIES)`,
    code: 'SQL_ENTITY_UNAVAILABLE',
  },
  {
    label: 'quoted lowercase table is a different object',
    sql: `SELECT "ID" FROM "com_acme_sales_orders"`,
    code: 'SQL_ENTITY_UNAVAILABLE',
  },
  { label: 'unknown column', sql: `SELECT o.CUSTOMERNAME FROM ${O} o`, code: 'SQL_UNKNOWN_COLUMN' },
  {
    label: 'unknown unqualified column',
    sql: `SELECT SALARY FROM ${O}`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'unknown column in WHERE',
    sql: `SELECT ID FROM ${O} WHERE SECRET = 1`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'unknown column in JOIN ON',
    sql: `SELECT o.ID FROM ${O} o JOIN ${C} c ON c.NOPE = o.CUSTOMER_ID`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'unknown column in GROUP BY',
    sql: `SELECT COUNT(*) AS n FROM ${O} GROUP BY NOPE`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'unknown column in HAVING',
    sql: `SELECT CUSTOMER_ID FROM ${O} GROUP BY CUSTOMER_ID HAVING SUM(NOPE) > 1`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'unknown column in ORDER BY',
    sql: `SELECT ID FROM ${O} ORDER BY NOPE`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'unknown column in subquery',
    sql: `SELECT ID FROM ${O} WHERE ID IN (SELECT NOPE FROM ${C})`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'unknown column inside function',
    sql: `SELECT UPPER(NOPE) AS u FROM ${C}`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  { label: 'unknown alias', sql: `SELECT x.ID FROM ${O} o`, code: 'SQL_UNKNOWN_COLUMN' },
  {
    label: 'table name used when alias exists',
    sql: `SELECT ${O}.ID FROM ${O} o`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'column of a joined table is not available through another alias',
    sql: `SELECT o.NAME FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'derived table column not exposed',
    sql: `SELECT t.TOTALAMOUNT FROM (SELECT ID FROM ${O}) t`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'select alias not visible in WHERE',
    sql: `SELECT ORDERNUMBER AS num FROM ${O} WHERE num = '1'`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'quoted lowercase column is a different column',
    sql: `SELECT "id" FROM ${O}`,
    code: 'SQL_UNKNOWN_COLUMN',
  },
  {
    label: 'ambiguous unqualified column',
    sql: `SELECT ID FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID`,
    code: 'SQL_AMBIGUOUS_COLUMN',
  },
  {
    label: 'ambiguous in WHERE',
    sql: `SELECT o.ID FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID WHERE NAME = 'x' AND CREATEDAT > '2024-01-01'`,
    code: 'SQL_AMBIGUOUS_COLUMN',
  },
  {
    label: 'ambiguous across two derived tables',
    sql: `SELECT ID FROM (SELECT ID FROM ${O}) a JOIN (SELECT ID FROM ${C}) b ON a.ID = b.ID`,
    code: 'SQL_AMBIGUOUS_COLUMN',
  },
];

test('negative cases are rejected with the exact error code', async (t) => {
  for (const { label, sql, code } of NEGATIVE) {
    await t.test(label, () => {
      const error = rejection(sql);
      assert.equal(error.code, code, `${label}: ${error.message}`);
    });
  }
});

test('field errors suggest the closest column (one-attempt correction)', () => {
  const error = rejection(`SELECT c.NAMEE FROM ${C} c`);
  assert.equal(error.code, 'SQL_UNKNOWN_COLUMN');
  assert.equal(error.message, `${C}.NAMEE does not exist. Did you mean NAME?`);
  assert.match(rejection(`SELECT COUNTRYCODE FROM ${C}`).message, /Did you mean COUNTRY_CODE\?/);
  assert.doesNotMatch(rejection(`SELECT ZZZZZZZZ FROM ${C}`).message, /Did you mean/);
});

test('entity errors tell how to fix them', () => {
  assert.equal(
    rejection('SELECT ID FROM COM_ACME_SALES_INVOICES').message,
    'COM_ACME_SALES_INVOICES is not in this context. Call hana_context with entities:["COM_ACME_SALES_INVOICES"].',
  );
  assert.equal(
    rejection('SELECT ID FROM COM_ACME_HR_SALARIES').message,
    'COM_ACME_HR_SALARIES is not available in the catalog of DEV-SALES.',
  );
  assert.match(
    rejection('SELECT ID FROM COM_ACME_SALES_ORDER').message,
    /Did you mean COM_ACME_SALES_ORDERS\?/,
  );
});

test('ambiguity errors name the column and the fix', () => {
  assert.equal(
    rejection(`SELECT ID FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID`).message,
    'Column ID is ambiguous; qualify it with an alias.',
  );
});

test('correlated subqueries resolve outer aliases; inner columns shadow outer ones', () => {
  validate(
    `SELECT c.NAME FROM ${C} c WHERE EXISTS (SELECT 1 FROM ${O} o WHERE o.CUSTOMER_ID = c.ID)`,
  );
  // ID exists in both scopes: the inner one wins, so it is not ambiguous.
  validate(`SELECT c.NAME FROM ${C} c WHERE EXISTS (SELECT 1 FROM ${O} o WHERE ID = c.ID)`);
  // An outer-only column is visible from the subquery.
  validate(
    `SELECT c.NAME FROM ${C} c WHERE EXISTS (SELECT 1 FROM ${O} o WHERE o.CUSTOMER_ID = COUNTRY_CODE)`,
  );
});

test('error messages never echo SQL literals', () => {
  const secret = 'TOP-SECRET-LITERAL';
  const samples = [
    `SELECT ID FROM ${O} WHERE NOTES = '${secret}' AND NOPE = 1`,
    `SELECT ID FROM ${O} WHERE NOTES = '${secret}' ; DROP TABLE X`,
    `SELECT ID FROM ${O} WHERE NOTES = '${secret}' LIMIT 3`,
    `SELECT ID FROM ${O} WHERE NOTES = '${secret}' ORDER`,
    `SELECT ID FROM ${O} WHERE NOTES = '${secret}' AND MYFUNC(NOTES) = 1`,
    `SELECT ID FROM COM_ACME_SALES_INVOICES WHERE NOTES = '${secret}'`,
  ];
  for (const sql of samples) assert.doesNotMatch(rejection(sql).message, new RegExp(secret));
});
