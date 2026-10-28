import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Column, Entity } from '../../../src/hana/catalog/domain/catalog.js';
import { renderContext } from '../../../src/hana/catalog/domain/context-renderer.js';

const col = (c: Partial<Column> & Pick<Column, 'name' | 'type' | 'label'>): Column => ({
  key: false,
  synonyms: ['never-in-response'],
  ...c,
});

const entity = (name: string, label: string, joins: Entity['joins'] = []): Entity => ({
  name,
  label,
  synonyms: ['never-in-response'],
  columns: [],
  joins,
  rules: [],
});

test('renders exactly the compact format of POV 4.2', () => {
  const text = renderContext(
    {
      entities: [
        {
          entity: entity('COM_ACME_SALES_ORDERS', 'Pedidos de venta'),
          columns: [
            col({ name: 'ID', type: 'string', length: 36, key: true, label: 'ID' }),
            col({ name: 'ORDERNUMBER', type: 'string', length: 10, label: 'Nº pedido' }),
            col({ name: 'CREATEDAT', type: 'timestamp', label: 'Creado' }),
            col({ name: 'CUSTOMER_ID', type: 'string', length: 36, label: 'Cliente' }),
            col({ name: 'STATUS_CODE', type: 'string', length: 1, label: 'Estado' }),
            col({
              name: 'TOTALAMOUNT',
              type: 'decimal',
              precision: 15,
              scale: 2,
              label: 'Importe total',
            }),
            col({ name: 'CURRENCY_CODE', type: 'string', length: 3, label: 'Moneda' }),
          ],
          hiddenColumns: 6,
          joins: [{ entity: 'COM_ACME_SALES_CUSTOMERS', on: [{ from: 'CUSTOMER_ID', to: 'ID' }] }],
        },
        {
          entity: entity('COM_ACME_SALES_CUSTOMERS', 'Clientes'),
          columns: [
            col({ name: 'ID', type: 'string', length: 36, key: true, label: 'ID' }),
            col({ name: 'NAME', type: 'string', length: 111, label: 'Nombre' }),
            col({ name: 'COUNTRY_CODE', type: 'string', length: 3, label: 'País' }),
          ],
          hiddenColumns: 9,
          joins: [],
        },
      ],
    },
    { contextId: 'abc.def', environment: 'DEV-SALES', ttlMinutes: 60 },
  );
  assert.equal(
    text,
    [
      'ctx=abc.def env=DEV-SALES ttl=60m',
      'COM_ACME_SALES_ORDERS "Pedidos de venta"',
      '  ID s36 PK · ORDERNUMBER s10 "Nº pedido" · CREATEDAT ts "Creado" · CUSTOMER_ID s36 "Cliente" · STATUS_CODE s1 "Estado" · TOTALAMOUNT d15.2 "Importe total" · CURRENCY_CODE s3 "Moneda" · +6 cols',
      '  join COM_ACME_SALES_CUSTOMERS ON CUSTOMER_ID=ID',
      'COM_ACME_SALES_CUSTOMERS "Clientes"',
      '  ID s36 PK · NAME s111 "Nombre" · COUNTRY_CODE s3 "País" · +9 cols',
      'rules: SELECT only; list columns (no *); no LIMIT/TOP (use limit); prefer GROUP BY',
    ].join('\n'),
  );
  assert.ok(!text.includes('never-in-response'));
});

test('type codes cover every column type', () => {
  const text = renderContext(
    {
      entities: [
        {
          entity: entity('T', 'T'),
          columns: [
            col({ name: 'A', type: 'integer', label: 'a b' }),
            col({ name: 'B', type: 'bigint', label: 'bb' }),
            col({ name: 'C', type: 'date', label: 'cc' }),
            col({ name: 'D', type: 'boolean', label: 'dd' }),
            col({ name: 'E', type: 'string', label: 'ee' }),
          ],
          hiddenColumns: 0,
          joins: [],
        },
      ],
    },
    { contextId: 'x', environment: 'E', ttlMinutes: 5 },
  );
  assert.match(text, /A i "a b" · B bi "bb" · C dt "cc" · D b "dd" · E s "ee"/);
});
