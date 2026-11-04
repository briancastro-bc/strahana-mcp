import type { CatalogView, EntityView } from '../../../src/hana/query/domain/reference-resolver.js';

/** Synthetic catalog for the query tests (invented tables, never real data). */
const ENTITIES: readonly EntityView[] = [
  {
    name: 'COM_ACME_SALES_ORDERS',
    columns: [
      'ID',
      'ORDERNUMBER',
      'CUSTOMER_ID',
      'STATUS_CODE',
      'TOTALAMOUNT',
      'CREATEDAT',
      'NOTES',
    ],
  },
  { name: 'COM_ACME_SALES_CUSTOMERS', columns: ['ID', 'NAME', 'COUNTRY_CODE', 'CREATEDAT'] },
  {
    name: 'COM_ACME_SALES_ORDERITEMS',
    columns: ['ID', 'ORDER_ID', 'PRODUCT_ID', 'QUANTITY', 'LINEAMOUNT'],
  },
  { name: 'COM_ACME_SALES_PRODUCTS', columns: ['ID', 'NAME', 'CATEGORY_ID'] },
  { name: 'COM_ACME_SALES_PRODUCTCATEGORIES', columns: ['ID', 'NAME'] },
  { name: 'COM_ACME_SALES_INVOICES', columns: ['ID', 'ORDER_ID', 'AMOUNT'] },
];

export const catalogView: CatalogView = {
  entity: (name) => ENTITIES.find((entity) => entity.name === name),
  entityNames: () => ENTITIES.map((entity) => entity.name),
};

/** INVOICES is in the catalog but deliberately not in the context. */
export const contextEntities: ReadonlySet<string> = new Set([
  'COM_ACME_SALES_ORDERS',
  'COM_ACME_SALES_CUSTOMERS',
  'COM_ACME_SALES_ORDERITEMS',
  'COM_ACME_SALES_PRODUCTS',
  'COM_ACME_SALES_PRODUCTCATEGORIES',
]);

const O = 'COM_ACME_SALES_ORDERS';
const C = 'COM_ACME_SALES_CUSTOMERS';
const I = 'COM_ACME_SALES_ORDERITEMS';
const P = 'COM_ACME_SALES_PRODUCTS';

/** Statements the validator must accept against the synthetic catalog and context. */
export const POSITIVE: readonly string[] = [
  `SELECT o.ID, o.ORDERNUMBER FROM ${O} o`,
  `SELECT ID, ORDERNUMBER FROM ${O}`,
  `SELECT ORDERNUMBER AS num, TOTALAMOUNT AS amount FROM ${O}`,
  `SELECT o.ORDERNUMBER FROM ${O} o WHERE o.STATUS_CODE = 'O' AND o.TOTALAMOUNT > 1000`,
  `SELECT o.ORDERNUMBER, c.NAME FROM ${O} o INNER JOIN ${C} c ON c.ID = o.CUSTOMER_ID`,
  `SELECT o.ORDERNUMBER, c.NAME FROM ${O} o LEFT JOIN ${C} c ON c.ID = o.CUSTOMER_ID`,
  `SELECT o.ORDERNUMBER, c.NAME, i.QUANTITY FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID JOIN ${I} i ON i.ORDER_ID = o.ID`,
  `SELECT o.ORDERNUMBER, c.NAME, i.QUANTITY, p.NAME AS product FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID JOIN ${I} i ON i.ORDER_ID = o.ID LEFT JOIN ${P} p ON p.ID = i.PRODUCT_ID`,
  `SELECT c.COUNTRY_CODE, SUM(o.TOTALAMOUNT) AS total FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID GROUP BY c.COUNTRY_CODE`,
  `SELECT c.NAME, COUNT(*) AS n FROM ${O} o JOIN ${C} c ON c.ID = o.CUSTOMER_ID GROUP BY c.NAME ORDER BY n DESC`,
  `SELECT CUSTOMER_ID, SUM(TOTALAMOUNT) AS total FROM ${O} GROUP BY CUSTOMER_ID HAVING SUM(TOTALAMOUNT) > 5000 ORDER BY total DESC`,
  `SELECT COUNT(DISTINCT o.CUSTOMER_ID) AS customers FROM ${O} o`,
  `SELECT AVG(TOTALAMOUNT) AS a, MIN(TOTALAMOUNT) AS lo, MAX(TOTALAMOUNT) AS hi FROM ${O}`,
  `SELECT DISTINCT STATUS_CODE FROM ${O}`,
  `SELECT o.ID FROM ${O} o WHERE o.CUSTOMER_ID IN (SELECT c.ID FROM ${C} c WHERE c.COUNTRY_CODE = 'ES')`,
  `SELECT c.NAME FROM ${C} c WHERE EXISTS (SELECT 1 FROM ${O} o WHERE o.CUSTOMER_ID = c.ID AND o.TOTALAMOUNT > 100)`,
  `SELECT c.NAME FROM ${C} c WHERE NOT EXISTS (SELECT 1 FROM ${O} o WHERE o.CUSTOMER_ID = c.ID)`,
  `SELECT t.CUSTOMER_ID, t.total FROM (SELECT o.CUSTOMER_ID, SUM(o.TOTALAMOUNT) AS total FROM ${O} o GROUP BY o.CUSTOMER_ID) t WHERE t.total > 1000`,
  `SELECT c.NAME, t.n FROM ${C} c JOIN (SELECT o.CUSTOMER_ID, COUNT(*) AS n FROM ${O} o GROUP BY o.CUSTOMER_ID) t ON t.CUSTOMER_ID = c.ID`,
  `SELECT x.CUSTOMER_ID FROM (SELECT y.CUSTOMER_ID FROM (SELECT o.CUSTOMER_ID FROM ${O} o) y) x`,
  `SELECT o.ID FROM ${O} o WHERE o.TOTALAMOUNT > (SELECT AVG(p.TOTALAMOUNT) FROM ${O} p)`,
  `SELECT CAST(TOTALAMOUNT AS DECIMAL(15, 2)) AS amount, CAST(ID AS VARCHAR(20)) AS id FROM ${O}`,
  `SELECT COALESCE(c.NAME, 'unknown') AS name FROM ${C} c`,
  `SELECT CASE WHEN TOTALAMOUNT > 1000 THEN 'HIGH' ELSE 'LOW' END AS band FROM ${O}`,
  `SELECT UPPER(NAME) AS n, LENGTH(NAME) AS l, SUBSTRING(NAME, 1, 3) AS p FROM ${C}`,
  `SELECT NAME || ' - ' || COUNTRY_CODE AS label FROM ${C}`,
  `SELECT YEAR(CREATEDAT) AS y, MONTH(CREATEDAT) AS m, COUNT(*) AS n FROM ${O} GROUP BY YEAR(CREATEDAT), MONTH(CREATEDAT)`,
  `SELECT ID FROM ${O} WHERE CREATEDAT >= ADD_DAYS(CURRENT_DATE, -30)`,
  `SELECT TO_VARCHAR(CREATEDAT, 'YYYY-MM-DD') AS d, LOCATE(NAME, 'A') AS pos FROM ${C}`,
  `SELECT ID FROM ${O} WHERE CREATEDAT BETWEEN '2024-01-01' AND '2024-12-31'`,
  `SELECT ID FROM ${O} WHERE NOTES IS NOT NULL AND NOT (STATUS_CODE = 'X')`,
  `SELECT ID FROM ${O} WHERE STATUS_CODE NOT IN ('C', 'X') AND NOTES LIKE 'a%'`,
  `SELECT ID FROM ${O} ORDER BY 1`,
  `select o.id, o.ordernumber from com_acme_sales_orders o where o.status_code = 'O'`,
  `SELECT "o"."ID", "o"."ORDERNUMBER" AS "Order Number" FROM "${O}" "o" ORDER BY "Order Number"`,
  `SELECT o.ID FROM ${O} o WHERE o.NOTES = 'it''s; fine -- really /* ok */'`,
  `SELECT o.ID FROM ${O} o WHERE o.NOTES = 'ÁLVARO'`,
  `SELECT EXTRACT(YEAR FROM CREATEDAT) AS y FROM ${O}`,
  `SELECT o.ID FROM ${O} o\n  WHERE o.STATUS_CODE = 'O'\n  ORDER BY o.ID`,
  `SELECT NAME AS n FROM ${C} ORDER BY n`,
  `SELECT i.ID FROM ${I} i WHERE i.ORDER_ID IN (SELECT o.ID FROM ${O} o WHERE o.CUSTOMER_ID IN (SELECT c.ID FROM ${C} c))`,
];
