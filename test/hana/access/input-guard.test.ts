import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardQuestion } from '../../../src/hana/access/application/guard-question.js';
import { checkQuestion } from '../../../src/hana/access/domain/input-guard.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';

test('accepts natural-language questions, including ones that start like SQL verbs', () => {
  for (const question of [
    '¿Cuántos pedidos hay por cliente?',
    'Show me the orders created this month',
    'select the best customers by revenue',
    'create a summary of sales per country',
    'call center orders last week',
    'drop in sales between March and April',
    'delete duplicates report for customers',
  ]) {
    assert.equal(checkQuestion(question), undefined, question);
  }
});

test('rejects raw SQL as QUESTION_IS_SQL with the fix in the message', () => {
  for (const question of [
    'SELECT * FROM COM_ACME_SALES_ORDERS',
    'select name, country from customers where id = 1',
    'select count(*) from orders',
    '  SELECT DISTINCT NAME FROM CUSTOMERS',
    'orders; DROP TABLE orders',
    'x UNION SELECT password FROM users',
    'DELETE FROM orders',
    'update orders set status = 1',
    'insert into orders values (1)',
    'DROP TABLE orders',
    'CREATE OR REPLACE VIEW v AS SELECT 1',
    'with t as (select 1) select * from t',
    'CALL my_proc(1)',
    'GRANT SELECT ON orders TO bob',
  ]) {
    assert.equal(checkQuestion(question), 'looks_like_sql', question);
    assert.throws(
      () => guardQuestion(question),
      (error: unknown) =>
        error instanceof SanitizedError &&
        error.code === 'QUESTION_IS_SQL' &&
        error.message === 'hana_context expects a natural-language question, not SQL.',
    );
  }
});

test('enforces the length bounds after trimming', () => {
  assert.equal(checkQuestion('   ab   '), 'empty');
  assert.equal(checkQuestion('x'.repeat(301)), 'too_long');
  assert.equal(checkQuestion('x'.repeat(300)), undefined);
  assert.throws(() => guardQuestion('     '), /at least 3 non-blank/);
  assert.throws(() => guardQuestion('y'.repeat(301)), /at most 300/);
});
