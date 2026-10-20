// Throwaway prototype of the POV 6.2 subset validator (Phase 0 spike).
// Strategy: text pre-check -> node-sql-parser (PostgreSQL grammar) -> strict allow-list AST walk.
// Fail closed: parse errors, unknown node types and unknown AST keys are rejected.
import sqlParser from 'node-sql-parser';

const { Parser } = sqlParser;
const parser = new Parser();

const MAX_TABLES = 4;
const MAX_SUBQUERY_DEPTH = 2;
const MAX_SQL_LENGTH = 8000;

const ALLOWED_FUNCTIONS = new Set([
  'UPPER', 'LOWER', 'LENGTH', 'TRIM', 'LTRIM', 'RTRIM', 'SUBSTRING', 'SUBSTR', 'CONCAT', 'REPLACE',
  'LEFT', 'RIGHT', 'LPAD', 'RPAD', 'ROUND', 'FLOOR', 'CEIL', 'ABS', 'MOD',
  'COALESCE', 'NULLIF', 'IFNULL',
  'ADD_DAYS', 'ADD_MONTHS', 'DAYS_BETWEEN', 'YEAR', 'MONTH', 'DAYOFMONTH', 'TO_DATE', 'CURRENT_DATE',
]);
const AGGREGATES = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
const BINARY_OPS = new Set([
  '=', '<>', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '||',
  'AND', 'OR', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS', 'IS NOT', 'BETWEEN', 'NOT BETWEEN',
]);
const JOIN_TYPES = new Set(['INNER JOIN', 'JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN']);
const LITERAL_TYPES = new Set(['number', 'single_quote_string', 'string', 'bool', 'null']);
const SELECT_KEYS = new Set([
  'with', 'type', 'options', 'distinct', 'columns', 'into', 'from', 'where', 'groupby', 'having',
  'orderby', 'limit', 'window', '_next', 'set_op', '_orderby', '_limit', 'locking_read', 'parentheses_symbol',
]);

class Reject extends Error {}
const reject = (msg) => {
  throw new Reject(msg);
};

/** Scans outside quoted regions: rejects comments, semicolons, non-ASCII, control chars, backslashes. */
export function precheck(sql) {
  if (typeof sql !== 'string' || sql.trim() === '') reject('empty SQL');
  if (sql.length > MAX_SQL_LENGTH) reject('SQL too long');
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const code = ch.codePointAt(0);
    if (ch === '\\') reject('backslash is not allowed');
    if (quote) {
      if (code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r') reject('control character');
      if (ch === quote) {
        if (sql[i + 1] === quote) i++; // doubled quote escape
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ';') reject('semicolons are not allowed');
    if (ch === '-' && sql[i + 1] === '-') reject('comments are not allowed');
    if (ch === '/' && sql[i + 1] === '*') reject('comments are not allowed');
    if (code > 0x7e) reject('non-ASCII character outside a literal');
    if (code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r') reject('control character');
  }
  if (quote) reject('unterminated quote');
}

function identName(col) {
  // column / table names come as string, {expr:{type,value}} or similar
  if (typeof col === 'string') return col;
  if (col && col.expr && typeof col.expr.value === 'string') {
    if (!['default', 'double_quote_string', 'backticks_quote_string'].includes(col.expr.type)) reject(`identifier type ${col.expr.type}`);
    return col.expr.value;
  }
  return reject('unrecognized identifier shape');
}

function checkExactKeys(node, allowed, what) {
  for (const k of Object.keys(node)) if (!allowed.has(k)) reject(`unexpected ${what} property "${k}"`);
}

export function validateSubset(sql) {
  const tables = new Set();
  const columns = new Set();
  let tableCount = 0;
  try {
    precheck(sql);
    let ast;
    try {
      ast = parser.astify(sql, { database: 'postgresql' });
    } catch (e) {
      reject(`SQL_PARSE: ${String(e.message).split('\n')[0].slice(0, 120)}`);
    }
    if (Array.isArray(ast)) reject('multiple statements');
    if (!ast || ast.type !== 'select') reject(`SQL_NOT_SELECT: ${ast && ast.type}`);

    const aliases = new Set();

    function select(node, depth, topLevel = false) {
      if (!node || node.type !== 'select') reject('SQL_NOT_SELECT: nested non-select');
      if (depth > MAX_SUBQUERY_DEPTH) reject(`more than ${MAX_SUBQUERY_DEPTH} subquery levels`);
      checkExactKeys(node, SELECT_KEYS, 'select');
      if (node.with) reject('WITH/CTE is not allowed');
      if (node._next || node.set_op) reject('UNION/INTERSECT/EXCEPT is not allowed');
      if (node.options) reject('select options (TOP etc.) are not allowed');
      if (node.distinct && node.distinct.type && node.distinct.type !== 'DISTINCT') reject('unsupported DISTINCT form');
      if (node.into && (node.into.position || node.into.expr)) reject('INTO is not allowed');
      if (node.locking_read) reject('FOR UPDATE/SHARE is not allowed');
      if (topLevel && node.parentheses_symbol) reject('parenthesized top-level statement is not allowed');
      if (node.window) reject('window clause is not allowed');
      if (node.limit && node.limit.value && node.limit.value.length) reject('LIMIT/OFFSET is not allowed');
      if (node.limit && !('value' in node.limit)) reject('unrecognized limit shape');
      if (node.limit && (node.limit.seperator || node.limit.separator)) reject('LIMIT/OFFSET is not allowed');
      if (!Array.isArray(node.columns) || node.columns.length === 0) reject('explicit columns required');
      if (!Array.isArray(node.from) || node.from.length === 0) reject('FROM is required');

      // FROM / JOIN
      node.from.forEach((f, idx) => {
        if (f.type === 'dual') reject('DUAL is not allowed');
        if (f.expr && f.expr.ast) {
          select(f.expr.ast, depth + 1);
          if (!f.as) reject('FROM subquery needs an alias');
        } else if (f.table !== undefined) {
          checkExactKeys(f, new Set(['db', 'table', 'as', 'join', 'on', 'using', 'schema']), 'from');
          if (f.db || f.schema) reject('schema-qualified names are not allowed');
          if (typeof f.table !== 'string') reject('unrecognized table shape');
          if (/^(SYS$|SYS_|_SYS_)/i.test(f.table)) reject('SYS objects are not allowed');
          tables.add(f.table);
          tableCount++;
        } else reject('unrecognized FROM item');
        if (f.as) aliases.add(f.as);
        if (idx === 0) {
          if (f.join || f.on) reject('malformed first FROM item');
        } else {
          if (!f.join) reject('implicit join (comma) is not allowed');
          if (!JOIN_TYPES.has(f.join)) reject(`join type not allowed: ${f.join}`);
          if (!f.on || f.using) reject('JOIN requires an ON condition');
          expr(f.on, depth);
        }
      });

      node.columns.forEach((c) => {
        if (c.expr === undefined || typeof c.expr !== 'object') reject('unrecognized select column');
        if (c.expr.type === 'column_ref' && c.expr.column === '*') reject('SELECT * is not allowed');
        if (c.type !== undefined && c.type !== 'expr') reject('unrecognized select column type');
        expr(c.expr, depth);
        if (c.as !== null && c.as !== undefined && typeof c.as !== 'string') reject('unrecognized alias');
      });
      if (node.where) expr(node.where, depth);
      if (node.groupby) {
        const items = Array.isArray(node.groupby) ? node.groupby : node.groupby.columns;
        if (!Array.isArray(items)) reject('unrecognized GROUP BY shape');
        items.forEach((g) => expr(g, depth));
      }
      if (node.having) expr(node.having, depth);
      if (node.orderby) {
        if (!Array.isArray(node.orderby)) reject('unrecognized ORDER BY shape');
        node.orderby.forEach((o) => {
          if (o.type && !['ASC', 'DESC'].includes(o.type)) reject('unrecognized ORDER BY direction');
          expr(o.expr, depth);
        });
      }
    }

    function subqueryOf(v, depth) {
      // values wrapped as {tableList, columnList, ast} inside expr_list, or bare select nodes
      const ast = v && v.ast ? v.ast : v;
      select(ast, depth + 1);
    }

    function expr(n, depth) {
      if (n === null || typeof n !== 'object') reject('unrecognized expression');
      switch (n.type) {
        case 'column_ref': {
          if (n.column === '*') reject('SELECT * is not allowed');
          if (n.schema || n.db) reject('schema-qualified column is not allowed');
          if (n.collate) reject('COLLATE is not allowed');
          if (n.table && /^(SYS$|SYS_|_SYS_)/i.test(n.table)) reject('SYS objects are not allowed');
          columns.add(`${n.table ?? ''}.${identName(n.column)}`);
          return;
        }
        case 'double_quote_string':
          // in PG grammar a bare "x" outside column position is an identifier-like string
          return;
        case 'binary_expr': {
          if (!BINARY_OPS.has(String(n.operator).toUpperCase())) reject(`operator not allowed: ${n.operator}`);
          expr(n.left, depth);
          if (n.right && n.right.type === 'expr_list') {
            n.right.value.forEach((v) => (v && (v.ast || v.type === 'select') ? subqueryOf(v, depth) : expr(v, depth)));
          } else expr(n.right, depth);
          return;
        }
        case 'unary_expr': {
          const op = String(n.operator).toUpperCase();
          if (!['NOT', 'NOT EXISTS', '-', '+'].includes(op)) reject(`unary operator not allowed: ${n.operator}`);
          if (op === 'NOT EXISTS') subqueryOf(n.expr, depth);
          else expr(n.expr, depth);
          return;
        }
        case 'expr_list':
          n.value.forEach((v) => (v && (v.ast || v.type === 'select') ? subqueryOf(v, depth) : expr(v, depth)));
          return;
        case 'select':
          subqueryOf(n, depth);
          return;
        case 'aggr_func': {
          if (!AGGREGATES.has(String(n.name).toUpperCase())) reject(`aggregate not allowed: ${n.name}`);
          if (n.over) reject('window functions are not allowed');
          const a = n.args || {};
          if (a.orderby || a.separator) reject('aggregate modifiers not allowed');
          if (a.distinct && String(a.distinct).toUpperCase() !== 'DISTINCT') reject('unrecognized DISTINCT');
          if (a.expr && a.expr.type === 'star') return; // COUNT(*)
          expr(a.expr, depth);
          return;
        }
        case 'function': {
          const name = (n.name?.name ?? []).map((p) => p.value).join('.').toUpperCase();
          if (n.over) reject('window functions are not allowed');
          if (name === 'NOT') {
            // parser quirk: NOT (cond) is emitted as a function call named NOT
            expr(n.args, depth);
            return;
          }
          if (name === 'EXISTS') {
            (n.args?.value ?? []).forEach((v) => subqueryOf(v, depth));
            return;
          }
          if (!ALLOWED_FUNCTIONS.has(name)) reject(`function not allowed: ${name}`);
          if (n.args) expr(n.args, depth);
          return;
        }
        case 'cast': {
          if (!Array.isArray(n.target) || n.target.length !== 1) reject('unrecognized CAST target');
          if (String(n.symbol).toLowerCase() !== 'as') reject('PostgreSQL :: cast syntax is not HANA SQL; use CAST(x AS type)');
          expr(n.expr, depth);
          return;
        }
        case 'case': {
          if (n.expr) expr(n.expr, depth);
          if (!Array.isArray(n.args)) reject('unrecognized CASE shape');
          n.args.forEach((w) => {
            if (w.type === 'when') {
              expr(w.cond, depth);
              expr(w.result, depth);
            } else if (w.type === 'else') expr(w.result, depth);
            else reject(`unrecognized CASE branch: ${w.type}`);
          });
          return;
        }
        case 'extract':
          if (!n.args || !['YEAR', 'MONTH', 'DAY'].includes(String(n.args.field).toUpperCase()) || n.args.cast_type) reject('unrecognized EXTRACT');
          expr(n.args.source, depth);
          return;
        case 'origin':
          // CURRENT_DATE etc. are parsed as origin nodes
          if (!['CURRENT_DATE'].includes(String(n.value).toUpperCase())) reject(`keyword not allowed: ${n.value}`);
          return;
        case 'date':
        case 'timestamp':
          return;
        default:
          // bare scalar subquery: { ast, parentheses } without a type
          if (n.type === undefined && n.ast) return subqueryOf(n, depth);
          if (LITERAL_TYPES.has(n.type)) return;
          reject(`unrecognized AST node: ${n.type}`);
      }
    }

    select(ast, 0, true);
    if (tableCount > MAX_TABLES) reject(`more than ${MAX_TABLES} tables`);
    return { ok: true, tables: [...tables].sort(), columns: [...columns].sort() };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.message };
    return { ok: false, reason: `internal error (fail closed): ${e.message}` };
  }
}
