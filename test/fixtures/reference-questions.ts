/**
 * 30 synthetic reference questions (Spanish and English) over catalog/sales.catalog.yaml, with
 * the tables and columns a correct SQL needs (POV 15). Keys (ID) are always shown, so they are
 * only listed when they are what the question is about. Tables are given without the prefix.
 */
export interface ReferenceQuestion {
  question: string;
  tables: string[];
  /** `TABLE.COLUMN`, table without the COM_ACME_SALES_ prefix. */
  fields: string[];
}

export const REFERENCE_QUESTIONS: readonly ReferenceQuestion[] = [
  {
    question: '¿Cuántos pedidos hay por cliente?',
    tables: ['ORDERS', 'CUSTOMERS'],
    fields: ['ORDERS.CUSTOMER_ID', 'CUSTOMERS.NAME'],
  },
  {
    question: 'Importe total de ventas por moneda',
    tables: ['ORDERS'],
    fields: ['ORDERS.TOTALAMOUNT', 'ORDERS.CURRENCY_CODE'],
  },
  {
    question: 'List the top customers by country',
    tables: ['CUSTOMERS'],
    fields: ['CUSTOMERS.NAME', 'CUSTOMERS.COUNTRY_CODE'],
  },
  {
    question: 'Pedidos abiertos creados este mes',
    tables: ['ORDERS'],
    fields: ['ORDERS.STATUS_CODE', 'ORDERS.CREATEDAT'],
  },
  {
    question: 'Número de factura y fecha de vencimiento de las facturas impagas',
    tables: ['INVOICES'],
    fields: ['INVOICES.INVOICENUMBER', 'INVOICES.DUEDATE', 'INVOICES.PAID'],
  },
  {
    question: 'Which invoices are unpaid and overdue?',
    tables: ['INVOICES'],
    fields: ['INVOICES.PAID', 'INVOICES.DUEDATE'],
  },
  {
    question: 'Cobros recibidos por forma de pago',
    tables: ['PAYMENTS'],
    fields: ['PAYMENTS.AMOUNT', 'PAYMENTS.METHOD_CODE'],
  },
  {
    question: 'Payments received per payment method last quarter',
    tables: ['PAYMENTS'],
    fields: ['PAYMENTS.PAYMENTDATE', 'PAYMENTS.METHOD_CODE', 'PAYMENTS.AMOUNT'],
  },
  {
    question: 'Productos con su categoría y precio de lista',
    tables: ['PRODUCTS', 'PRODUCTCATEGORIES'],
    fields: ['PRODUCTS.LISTPRICE', 'PRODUCTS.CATEGORY_ID'],
  },
  {
    question: 'Cantidad vendida por producto',
    tables: ['ORDERITEMS', 'PRODUCTS'],
    fields: ['ORDERITEMS.QUANTITY', 'ORDERITEMS.PRODUCT_ID'],
  },
  {
    question: 'Descuento medio por posición de pedido',
    tables: ['ORDERITEMS'],
    fields: ['ORDERITEMS.DISCOUNT'],
  },
  {
    question: 'Envíos entregados por transportista',
    tables: ['SHIPMENTS'],
    fields: ['SHIPMENTS.DELIVERED', 'SHIPMENTS.CARRIER'],
  },
  {
    question: 'Shipments by warehouse and carrier',
    tables: ['SHIPMENTS', 'WAREHOUSES'],
    fields: ['SHIPMENTS.CARRIER', 'SHIPMENTS.WAREHOUSE_ID'],
  },
  {
    question: 'Capacidad de los almacenes por país',
    tables: ['WAREHOUSES'],
    fields: ['WAREHOUSES.CAPACITY', 'WAREHOUSES.COUNTRY_CODE'],
  },
  {
    question: 'Cuota anual de cada vendedor por región',
    tables: ['SALESREPS'],
    fields: ['SALESREPS.QUOTA', 'SALESREPS.REGION_CODE'],
  },
  {
    question: 'Sales rep quota versus total order amount',
    tables: ['SALESREPS', 'ORDERS'],
    fields: ['SALESREPS.QUOTA', 'ORDERS.TOTALAMOUNT'],
  },
  {
    question: 'Clientes activos con límite de crédito mayor a 10000',
    tables: ['CUSTOMERS'],
    fields: ['CUSTOMERS.ACTIVE', 'CUSTOMERS.CREDITLIMIT'],
  },
  { question: 'Customers by industry', tables: ['CUSTOMERS'], fields: ['CUSTOMERS.INDUSTRY_CODE'] },
  {
    question: 'Fecha de entrega prevista de los pedidos',
    tables: ['ORDERS'],
    fields: ['ORDERS.DELIVERYDATE'],
  },
  { question: 'Orders by sales channel', tables: ['ORDERS'], fields: ['ORDERS.CHANNEL_CODE'] },
  {
    question: 'Condiciones de pago de los pedidos por cliente',
    tables: ['ORDERS', 'CUSTOMERS'],
    fields: ['ORDERS.PAYMENTTERMS', 'ORDERS.CUSTOMER_ID'],
  },
  {
    question: 'Peso total de los productos activos',
    tables: ['PRODUCTS'],
    fields: ['PRODUCTS.WEIGHT', 'PRODUCTS.ACTIVE'],
  },
  {
    question: 'Número de seguimiento de los envíos de un pedido',
    tables: ['SHIPMENTS', 'ORDERS'],
    fields: ['SHIPMENTS.TRACKINGNUMBER', 'ORDERS.ORDERNUMBER'],
  },
  {
    question: 'Impuestos facturados por cliente',
    tables: ['INVOICES', 'CUSTOMERS'],
    fields: ['INVOICES.TAXAMOUNT', 'INVOICES.CUSTOMER_ID'],
  },
  {
    question: 'Total facturado por cliente en el último año',
    tables: ['INVOICES', 'CUSTOMERS'],
    fields: ['INVOICES.GROSSAMOUNT', 'INVOICES.INVOICEDATE', 'INVOICES.CUSTOMER_ID'],
  },
  {
    question: 'Precio unitario y cantidad por pedido',
    tables: ['ORDERITEMS', 'ORDERS'],
    fields: ['ORDERITEMS.UNITPRICE', 'ORDERITEMS.QUANTITY', 'ORDERITEMS.ORDER_ID'],
  },
  {
    question: 'Which products were discontinued?',
    tables: ['PRODUCTS'],
    fields: ['PRODUCTS.ACTIVE'],
  },
  {
    question: 'Ventas por vendedor y mes',
    tables: ['ORDERS', 'SALESREPS'],
    fields: ['ORDERS.TOTALAMOUNT', 'ORDERS.CREATEDAT', 'ORDERS.SALESREP_ID'],
  },
  {
    question: 'Notas o comentarios de los pedidos cancelados',
    tables: ['ORDERS'],
    fields: ['ORDERS.NOTES', 'ORDERS.STATUS_CODE'],
  },
  {
    question: 'Pagos aplicados a cada factura',
    tables: ['PAYMENTS', 'INVOICES'],
    fields: ['PAYMENTS.INVOICE_ID'],
  },
];
