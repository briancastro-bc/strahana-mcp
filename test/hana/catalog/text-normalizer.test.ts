import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokenize } from '../../../src/hana/catalog/domain/text-normalizer.js';

test('lowercases, strips diacritics and splits identifiers', () => {
  assert.deepEqual(tokenize('COM_ACME_SALES_ORDERS'), ['com', 'acme', 'sale', 'order']);
  assert.deepEqual(tokenize('Categoría'), tokenize('categoria'));
});

test('singular and plural forms share a stem in Spanish and English', () => {
  for (const [a, b] of [
    ['pedido', 'pedidos'],
    ['cliente', 'clientes'],
    ['orden', 'ordenes'],
    ['invoice', 'invoices'],
    ['customer', 'customers'],
    ['vendedor', 'vendedores'],
  ] as const) {
    assert.deepEqual(tokenize(a), tokenize(b), `${a} / ${b}`);
  }
});

test('drops stopwords and question filler in both languages', () => {
  assert.deepEqual(tokenize('¿Cuántos pedidos hay por cliente?'), ['pedid', 'client']);
  assert.deepEqual(tokenize('Show me the top orders by customer'), ['order', 'customer']);
});
