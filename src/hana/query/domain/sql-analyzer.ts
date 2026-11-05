import {
  UNSUPPORTED_SYNTAX_HINT,
  ALLOWED_AGGREGATES,
  ALLOWED_BINARY_OPERATORS,
  ALLOWED_CAST_TYPES,
  ALLOWED_FUNCTIONS,
  ALLOWED_JOIN_TYPES,
  ALLOWED_UNARY_OPERATORS,
  LITERAL_TYPES,
  MAX_SUBQUERY_DEPTH,
  MAX_TABLES,
  SYSTEM_OBJECT_PATTERN,
} from './sql-policy.js';
import { reject } from './sql-rejection.js';
import type { SqlParser } from './sql-parser.js';
import { checkSqlText } from './sql-text-check.js';

/**
 * Stage 1 of the validator: syntax and policy. Parses the text and walks the AST with a strict
 * allow-list (unknown node types and unknown AST keys are rejected), producing a neutral tree of
 * scopes, sources and column uses that stage 2 resolves against the catalog and the context.
 */

export interface BaseTableSource {
  readonly kind: 'table';
  /** Table name as written. */
  readonly name: string;
  readonly alias: string | undefined;
}

export interface DerivedTableSource {
  readonly kind: 'derived';
  readonly alias: string;
  readonly query: SelectScope;
}

export type Source = BaseTableSource | DerivedTableSource;

export interface ColumnUse {
  /** Qualifier as written (alias or table name), if any. */
  readonly qualifier: string | undefined;
  readonly column: string;
  /** Written between double quotes: case-sensitive in HANA. */
  readonly quoted: boolean;
  /** Select-list aliases are visible in GROUP BY, HAVING and ORDER BY only. */
  readonly aliasVisible: boolean;
}

export interface SelectScope {
  readonly parent: SelectScope | undefined;
  readonly sources: Source[];
  readonly uses: ColumnUse[];
  /** Upper-cased names this SELECT exposes: aliases and plain column names. */
  readonly outputs: Set<string>;
  /** Upper-cased explicit aliases of the select list. */
  readonly selectAliases: Set<string>;
}

export interface SqlAnalysis {
  readonly root: SelectScope;
  /** Every SELECT of the statement (top-level, subqueries, derived tables), in order of appearance. */
  readonly scopes: readonly SelectScope[];
  /** Every base table of the statement, in order of appearance (repeats included). */
  readonly tables: readonly BaseTableSource[];
  /** The top-level SELECT has an ORDER BY. */
  readonly hasOrderBy: boolean;
  readonly quotedIdentifiers: ReadonlySet<string>;
  /** The text to execute: the input without its single trailing `;`, otherwise unchanged. */
  readonly statement: string;
}

type Node = Readonly<Record<string, unknown>>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const unsupported = (what: string) =>
  reject.forbidden(`Unsupported SQL construct: ${what}. Rewrite with the allowed subset.`);

function asNode(value: unknown, what: string): Node {
  if (!isNode(value)) throw unsupported(what);
  return value;
}

function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) throw unsupported(what);
  return value as readonly unknown[];
}

function typeOf(node: Node): string | undefined {
  return typeof node['type'] === 'string' ? node['type'] : undefined;
}

function checkKeys(node: Node, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(node)) {
    if (key !== 'type' && key !== 'parentheses' && !allowed.includes(key)) {
      throw unsupported(`${what} with "${key}"`);
    }
  }
}

const SELECT_KEYS = [
  'with',
  'options',
  'distinct',
  'columns',
  'into',
  'from',
  'where',
  'groupby',
  'having',
  'orderby',
  'limit',
  'window',
  '_next',
  'set_op',
  '_orderby',
  '_limit',
  'locking_read',
];

interface Context {
  tables: BaseTableSource[];
  scopes: SelectScope[];
  topHasOrderBy: boolean;
}

function newScope(ctx: Context, parent: SelectScope | undefined): SelectScope {
  const scope: SelectScope = {
    parent,
    sources: [],
    uses: [],
    outputs: new Set(),
    selectAliases: new Set(),
  };
  ctx.scopes.push(scope);
  return scope;
}

/** Identifier of a column: `{ expr: { type, value } }` where the type tells the quoting. */
function columnIdentifier(value: unknown): { name: string; quoted: boolean } {
  if (typeof value === 'string') return { name: value, quoted: false };
  const holder = asNode(value, 'column name');
  const inner = asNode(holder['expr'], 'column name');
  const name = inner['value'];
  if (typeof name !== 'string') throw unsupported('column name');
  const type = typeOf(inner);
  if (type === 'double_quote_string') return { name, quoted: true };
  if (type === 'default') return { name, quoted: false };
  throw unsupported(`identifier of type ${type ?? 'unknown'}`);
}

function isSystemObject(name: string): boolean {
  return SYSTEM_OBJECT_PATTERN.test(name);
}

function functionName(node: Node): string {
  const holder = asNode(node['name'], 'function name');
  // The parser keeps a schema prefix (`S.F(x)`) apart from the name parts.
  if (holder['schema'] !== undefined && holder['schema'] !== null) {
    throw reject.forbidden('Schema-qualified functions are not allowed.');
  }
  checkKeys(holder, ['name'], 'function name');
  const parts = asArray(holder['name'], 'function name').map((part) => {
    const value = asNode(part, 'function name')['value'];
    if (typeof value !== 'string') throw unsupported('function name');
    return value;
  });
  if (parts.length !== 1) throw reject.forbidden('Schema-qualified functions are not allowed.');
  return (parts[0] ?? '').toUpperCase();
}

class Walker {
  constructor(private readonly ctx: Context) {}

  select(raw: unknown, parent: SelectScope | undefined, depth: number): SelectScope {
    const node = asNode(raw, 'subquery');
    if (typeOf(node) !== 'select') {
      throw reject.notSelect('Only SELECT statements are allowed, including subqueries.');
    }
    if (depth > MAX_SUBQUERY_DEPTH) {
      throw reject.forbidden(
        `More than ${MAX_SUBQUERY_DEPTH} levels of subqueries are not allowed.`,
      );
    }
    checkKeys(node, SELECT_KEYS, 'SELECT');
    if (node['with']) throw reject.forbidden('WITH (CTE) is not allowed. Use a subquery.');
    if (node['_next'] || node['set_op']) {
      throw reject.forbidden('UNION, INTERSECT and EXCEPT are not allowed. Run separate queries.');
    }
    if (node['options']) {
      throw reject.forbidden(
        'TOP and other SELECT options are not allowed. Use the limit parameter.',
      );
    }
    const distinct = node['distinct'];
    if (distinct !== null && distinct !== undefined) {
      const kind = asNode(distinct, 'DISTINCT')['type'];
      if (kind !== null && kind !== 'DISTINCT') throw unsupported('DISTINCT form');
    }
    const into = node['into'];
    if (isNode(into) && (into['position'] || into['expr'])) {
      throw reject.forbidden('INTO is not allowed.');
    }
    if (node['locking_read']) throw reject.forbidden('FOR UPDATE and FOR SHARE are not allowed.');
    if (node['window']) throw reject.forbidden('Window functions are not allowed.');
    const limit = node['limit'];
    if (limit !== null && limit !== undefined) {
      const holder = asNode(limit, 'LIMIT');
      const values = holder['value'];
      if (!Array.isArray(values) || values.length > 0) {
        throw reject.forbidden(
          'LIMIT and OFFSET are not allowed. Use the limit and offset parameters.',
        );
      }
    }
    if (node['_orderby'] || node['_limit']) throw unsupported('set operation modifiers');

    const columns = node['columns'];
    if (!Array.isArray(columns)) {
      throw reject.forbidden('SELECT * is not allowed; list the columns.');
    }
    if (columns.length === 0) throw unsupported('empty select list');
    const from = node['from'];
    if (!Array.isArray(from) || from.length === 0) {
      throw reject.parse('FROM is required. Select from a table of the context.');
    }

    const scope = newScope(this.ctx, parent);
    this.fromClause(from as readonly unknown[], scope, depth);

    for (const raw of columns as readonly unknown[]) {
      const column = asNode(raw, 'select column');
      const kind = column['type'];
      if (kind !== undefined && kind !== 'expr') throw unsupported('select column');
      const expr = asNode(column['expr'], 'select column');
      this.expr(expr, scope, depth, false);
      const alias = column['as'];
      if (alias !== null && alias !== undefined && typeof alias !== 'string') {
        throw unsupported('column alias');
      }
      if (typeof alias === 'string') {
        scope.selectAliases.add(alias.toUpperCase());
        scope.outputs.add(alias.toUpperCase());
      } else if (typeOf(expr) === 'column_ref') {
        scope.outputs.add(columnIdentifier(expr['column']).name.toUpperCase());
      }
    }

    if (node['where']) this.expr(asNode(node['where'], 'WHERE'), scope, depth, false);
    const groupby = node['groupby'];
    if (groupby !== null && groupby !== undefined) {
      const holder = asNode(groupby, 'GROUP BY');
      const modifiers = holder['modifiers'];
      if (Array.isArray(modifiers) && modifiers.length > 0) {
        throw reject.forbidden('GROUP BY modifiers (ROLLUP, CUBE) are not allowed.');
      }
      for (const item of asArray(holder['columns'], 'GROUP BY')) {
        this.expr(asNode(item, 'GROUP BY item'), scope, depth, true);
      }
    }
    if (node['having']) this.expr(asNode(node['having'], 'HAVING'), scope, depth, true);
    const orderby = node['orderby'];
    if (orderby !== null && orderby !== undefined) {
      for (const raw of asArray(orderby, 'ORDER BY')) {
        const item = asNode(raw, 'ORDER BY item');
        const direction = item['type'];
        if (direction !== null && direction !== 'ASC' && direction !== 'DESC') {
          throw unsupported('ORDER BY direction');
        }
        if (item['nulls']) throw unsupported('NULLS FIRST/LAST');
        this.expr(asNode(item['expr'], 'ORDER BY item'), scope, depth, true);
      }
      if (parent === undefined) this.ctx.topHasOrderBy = true;
    }
    return scope;
  }

  private fromClause(from: readonly unknown[], scope: SelectScope, depth: number): void {
    const joins: { condition: Node }[] = [];
    from.forEach((raw, index) => {
      const item = asNode(raw, 'FROM item');
      if (typeOf(item) === 'dual') throw reject.forbidden('DUAL is not allowed.');
      checkKeys(
        item,
        ['db', 'table', 'as', 'join', 'on', 'using', 'schema', 'prefix', 'expr'],
        'FROM item',
      );
      const alias = item['as'];
      if (alias !== null && alias !== undefined && typeof alias !== 'string') {
        throw unsupported('table alias');
      }
      const aliasName = typeof alias === 'string' ? alias : undefined;
      const derived = item['expr'];
      if (derived !== undefined && derived !== null) {
        if (item['prefix'] !== null && item['prefix'] !== undefined) {
          throw unsupported('LATERAL subquery');
        }
        const holder = asNode(derived, 'FROM subquery');
        checkKeys(holder, ['tableList', 'columnList', 'ast'], 'FROM subquery');
        if (holder['ast'] === undefined) throw unsupported('FROM expression');
        if (aliasName === undefined) {
          throw reject.forbidden('A subquery in FROM needs an alias.');
        }
        const query = this.select(holder['ast'], scope, depth + 1);
        scope.sources.push({ kind: 'derived', alias: aliasName, query });
      } else if (typeof item['table'] === 'string') {
        if (item['db'] || item['schema']) {
          throw reject.forbidden(
            'Schema-qualified table names are not allowed; use the table name only.',
          );
        }
        if (isSystemObject(item['table'])) {
          throw reject.forbidden('SYS objects are not allowed.');
        }
        const source: BaseTableSource = { kind: 'table', name: item['table'], alias: aliasName };
        this.ctx.tables.push(source);
        if (this.ctx.tables.length > MAX_TABLES) {
          throw reject.forbidden(`More than ${MAX_TABLES} tables are not allowed in one query.`);
        }
        scope.sources.push(source);
      } else {
        throw unsupported('FROM item');
      }
      if (index === 0) {
        if (item['join'] || item['on']) throw unsupported('first FROM item with JOIN');
      } else {
        const join = item['join'];
        if (typeof join !== 'string') {
          throw reject.forbidden('Comma joins are not allowed; use JOIN ... ON.');
        }
        if (!ALLOWED_JOIN_TYPES.has(join.toUpperCase())) {
          throw reject.forbidden(`${join} is not allowed; use INNER JOIN or LEFT JOIN with ON.`);
        }
        if (item['using'] || !item['on']) {
          throw reject.forbidden('Every JOIN needs an ON condition (no USING, no CROSS JOIN).');
        }
        joins.push({ condition: asNode(item['on'], 'JOIN condition') });
      }
    });
    const seen = new Set<string>();
    for (const source of scope.sources) {
      const label = (source.alias ?? (source.kind === 'table' ? source.name : '')).toUpperCase();
      if (seen.has(label)) {
        throw reject.forbidden(`Alias ${label} is used twice; give each table its own alias.`);
      }
      seen.add(label);
    }
    for (const { condition } of joins) this.expr(condition, scope, depth, false);
  }

  private subquery(raw: unknown, scope: SelectScope, depth: number): void {
    const holder = asNode(raw, 'subquery');
    if (holder['ast'] !== undefined) {
      checkKeys(holder, ['tableList', 'columnList', 'ast'], 'subquery');
      this.select(holder['ast'], scope, depth + 1);
    } else {
      this.select(holder, scope, depth + 1);
    }
  }

  /** Walks one expression node, registering its column uses in `scope`. */
  expr(n: Node, scope: SelectScope, depth: number, aliasVisible: boolean): void {
    const kind = typeOf(n);
    switch (kind) {
      case 'column_ref': {
        checkKeys(n, ['table', 'column', 'collate', 'schema', 'db'], 'column');
        if (n['column'] === '*')
          throw reject.forbidden('SELECT * is not allowed; list the columns.');
        if (n['schema'] || n['db'])
          throw reject.forbidden('Schema-qualified columns are not allowed.');
        if (n['collate']) throw reject.forbidden('COLLATE is not allowed.');
        const qualifier = n['table'];
        if (qualifier !== null && qualifier !== undefined && typeof qualifier !== 'string') {
          throw unsupported('column qualifier');
        }
        if (typeof qualifier === 'string' && isSystemObject(qualifier)) {
          throw reject.forbidden('SYS objects are not allowed.');
        }
        const { name, quoted } = columnIdentifier(n['column']);
        if (name === '*') throw reject.forbidden('SELECT * is not allowed; list the columns.');
        scope.uses.push({
          qualifier: typeof qualifier === 'string' ? qualifier : undefined,
          column: name,
          quoted,
          aliasVisible,
        });
        return;
      }
      case 'binary_expr': {
        checkKeys(n, ['operator', 'left', 'right'], 'operator expression');
        const operator = String(n['operator']).toUpperCase();
        if (!ALLOWED_BINARY_OPERATORS.has(operator)) {
          throw reject.forbidden(`Operator ${String(n['operator'])} is not allowed.`);
        }
        this.expr(asNode(n['left'], 'operand'), scope, depth, aliasVisible);
        this.operands(n['right'], scope, depth, aliasVisible);
        return;
      }
      case 'unary_expr': {
        checkKeys(n, ['operator', 'expr'], 'unary expression');
        const operator = String(n['operator']).toUpperCase();
        if (!ALLOWED_UNARY_OPERATORS.has(operator)) {
          throw reject.forbidden(`Operator ${String(n['operator'])} is not allowed.`);
        }
        if (operator === 'NOT EXISTS') this.subquery(n['expr'], scope, depth);
        else this.expr(asNode(n['expr'], 'operand'), scope, depth, aliasVisible);
        return;
      }
      case 'expr_list':
        checkKeys(n, ['value'], 'list');
        this.operands(n, scope, depth, aliasVisible);
        return;
      case 'select':
        this.select(n, scope, depth + 1);
        return;
      case 'aggr_func': {
        checkKeys(n, ['name', 'args', 'over'], 'aggregate');
        const name = String(n['name']).toUpperCase();
        if (!ALLOWED_AGGREGATES.has(name))
          throw reject.forbidden(`Function ${name} is not allowed.`);
        if (n['over']) throw reject.forbidden('Window functions are not allowed.');
        const args = asNode(n['args'], 'aggregate arguments');
        checkKeys(args, ['expr', 'distinct', 'orderby', 'separator'], 'aggregate arguments');
        if (args['orderby'] || args['separator']) throw unsupported('aggregate modifiers');
        const distinct = args['distinct'];
        if (distinct !== null && distinct !== undefined && distinct !== 'DISTINCT') {
          throw unsupported('aggregate DISTINCT form');
        }
        const inner = asNode(args['expr'], 'aggregate argument');
        if (typeOf(inner) === 'star') {
          if (name !== 'COUNT' || distinct) throw unsupported('aggregate over *');
          return;
        }
        this.expr(inner, scope, depth, aliasVisible);
        return;
      }
      case 'function':
        this.functionCall(n, scope, depth, aliasVisible);
        return;
      case 'cast': {
        checkKeys(n, ['keyword', 'expr', 'symbol', 'target'], 'CAST');
        if (String(n['symbol']).toLowerCase() !== 'as') {
          throw reject.forbidden('The :: cast is not HANA SQL; use CAST(x AS type).');
        }
        const target = asArray(n['target'], 'CAST target');
        if (target.length !== 1) throw unsupported('CAST target');
        const type = asNode(target[0], 'CAST target');
        const suffix = type['suffix'];
        if (Array.isArray(suffix) && suffix.length > 0) throw unsupported('CAST target');
        checkKeys(type, ['dataType', 'length', 'scale', 'parentheses', 'suffix'], 'CAST target');
        const dataType = typeof type['dataType'] === 'string' ? type['dataType'].toUpperCase() : '';
        if (!ALLOWED_CAST_TYPES.has(dataType)) {
          throw reject.forbidden(
            `CAST type ${dataType || 'unknown'} is not supported. Use VARCHAR, INTEGER, BIGINT, DECIMAL(p,s), DATE or TIMESTAMP.`,
          );
        }
        this.expr(asNode(n['expr'], 'CAST operand'), scope, depth, aliasVisible);
        return;
      }
      case 'case': {
        checkKeys(n, ['expr', 'args'], 'CASE');
        if (n['expr']) this.expr(asNode(n['expr'], 'CASE operand'), scope, depth, aliasVisible);
        for (const raw of asArray(n['args'], 'CASE branches')) {
          const branch = asNode(raw, 'CASE branch');
          if (typeOf(branch) === 'when') {
            checkKeys(branch, ['cond', 'result'], 'WHEN');
            this.expr(asNode(branch['cond'], 'WHEN'), scope, depth, aliasVisible);
            this.expr(asNode(branch['result'], 'THEN'), scope, depth, aliasVisible);
          } else if (typeOf(branch) === 'else') {
            checkKeys(branch, ['result'], 'ELSE');
            this.expr(asNode(branch['result'], 'ELSE'), scope, depth, aliasVisible);
          } else {
            throw unsupported('CASE branch');
          }
        }
        return;
      }
      case 'extract': {
        checkKeys(n, ['args'], 'EXTRACT');
        const args = asNode(n['args'], 'EXTRACT');
        checkKeys(args, ['field', 'source', 'cast_type'], 'EXTRACT');
        const field = String(args['field']).toUpperCase();
        if (!['YEAR', 'MONTH', 'DAY'].includes(field) || args['cast_type']) {
          throw unsupported('EXTRACT field');
        }
        this.expr(asNode(args['source'], 'EXTRACT source'), scope, depth, aliasVisible);
        return;
      }
      case 'origin':
        checkKeys(n, ['value'], 'keyword');
        if (String(n['value']).toUpperCase() !== 'CURRENT_DATE') {
          throw reject.forbidden(`Keyword ${String(n['value'])} is not allowed.`);
        }
        return;
      case 'date':
      case 'timestamp':
        checkKeys(n, ['value'], 'date literal');
        return;
      case undefined:
        // Bare scalar subquery: { ast, tableList, columnList } without a type.
        if (n['ast'] !== undefined) {
          this.subquery(n, scope, depth);
          return;
        }
        throw unsupported('expression');
      default:
        if (LITERAL_TYPES.has(kind)) {
          this.literal(n);
          return;
        }
        throw unsupported(`expression ${kind}`);
    }
  }

  private literal(n: Node): void {
    checkKeys(n, ['value', 'escape'], 'literal');
    const escape = n['escape'];
    if (escape !== undefined && escape !== null) {
      const holder = asNode(escape, 'ESCAPE');
      checkKeys(holder, ['value'], 'ESCAPE');
      const value = asNode(holder['value'], 'ESCAPE');
      if (typeOf(value) !== 'single_quote_string') throw unsupported('ESCAPE');
      checkKeys(value, ['value'], 'ESCAPE');
    }
  }

  /** Right-hand side of an operator: a list, a subquery or a plain expression. */
  private operands(raw: unknown, scope: SelectScope, depth: number, aliasVisible: boolean): void {
    const n = asNode(raw, 'operand');
    if (typeOf(n) === 'expr_list') {
      checkKeys(n, ['value'], 'list');
      for (const item of asArray(n['value'], 'list')) {
        const child = asNode(item, 'list item');
        if (child['ast'] !== undefined || typeOf(child) === 'select') {
          this.subquery(child, scope, depth);
        } else {
          this.expr(child, scope, depth, aliasVisible);
        }
      }
      return;
    }
    this.expr(n, scope, depth, aliasVisible);
  }

  private functionCall(n: Node, scope: SelectScope, depth: number, aliasVisible: boolean): void {
    checkKeys(n, ['name', 'args', 'over', 'suffix'], 'function');
    if (n['over']) throw reject.forbidden('Window functions are not allowed.');
    if (n['suffix']) throw unsupported('function suffix');
    const name = functionName(n);
    const args = n['args'];
    if (name === 'NOT') {
      // Parser quirk: NOT (cond) is emitted as a function call named NOT.
      this.operands(args, scope, depth, aliasVisible);
      return;
    }
    if (name === 'EXISTS') {
      const list = asNode(args, 'EXISTS');
      for (const item of asArray(list['value'], 'EXISTS')) this.subquery(item, scope, depth);
      return;
    }
    if (!ALLOWED_FUNCTIONS.has(name)) {
      throw reject.forbidden(`Function ${name} is not allowed. Use only the documented functions.`);
    }
    if (args !== undefined && args !== null) this.operands(args, scope, depth, aliasVisible);
  }
}

/**
 * Parses and checks `sql` against the policy of POV 6.2. Throws `SqlRejection`. Anything the
 * parser or the walker does not recognize is rejected (fail closed), including internal errors.
 */
export function analyzeSql(sql: string, parser: SqlParser): SqlAnalysis {
  const { statement, quotedIdentifiers } = checkSqlText(sql);
  let ast: unknown;
  try {
    ast = parser.parse(statement);
  } catch (error) {
    throw parseFailure(statement, error);
  }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) throw reject.forbidden('Only one statement is allowed.');
    ast = ast[0] as unknown;
  }
  const root = asNode(ast, 'statement');
  if (typeOf(root) !== 'select') throw reject.notSelect();
  if (root['parentheses'] === true) {
    throw reject.forbidden(
      'A parenthesized statement is not allowed; remove the outer parentheses.',
    );
  }
  const ctx: Context = { tables: [], scopes: [], topHasOrderBy: false };
  const scope = new Walker(ctx).select(root, undefined, 0);
  return {
    root: scope,
    scopes: ctx.scopes,
    tables: ctx.tables,
    hasOrderBy: ctx.topHasOrderBy,
    quotedIdentifiers,
    statement,
  };
}

const NEAR_WORD = /[A-Za-z0-9_]/;

/** The words around a parse error offset, never anything inside quotes. */
function nearText(sql: string, offset: number): string | undefined {
  let quote: string | undefined;
  for (let i = 0; i < Math.min(offset + 1, sql.length); i++) {
    const ch = sql.charAt(i);
    if (quote === undefined && (ch === "'" || ch === '"')) quote = ch;
    else if (quote !== undefined && ch === quote) quote = undefined;
  }
  if (quote !== undefined) return undefined;
  let start = offset;
  while (start > 0 && NEAR_WORD.test(sql.charAt(start - 1))) start--;
  let end = offset;
  while (end < sql.length && NEAR_WORD.test(sql.charAt(end))) end++;
  if (end === start) return undefined;
  let from = start;
  let gap = from;
  while (gap > 0 && sql.charAt(gap - 1) === ' ') gap--;
  if (gap < from && gap > 0 && NEAR_WORD.test(sql.charAt(gap - 1))) {
    from = gap;
    while (from > 0 && NEAR_WORD.test(sql.charAt(from - 1))) from--;
  }
  return sql.slice(from, end);
}

const HANA_ONLY_SYNTAX =
  /\b(NVARCHAR|SECONDDATE|DAYDATE|SMALLDECIMAL|NCLOB)\b|\bSUBSTRING\s*\([^()]*\bFROM\b/i;

function parseFailure(sql: string, error: unknown) {
  const location = isNode(error) ? error['location'] : undefined;
  const start = isNode(location) ? location['start'] : undefined;
  const offset = isNode(start) && typeof start['offset'] === 'number' ? start['offset'] : undefined;
  const near = offset === undefined ? undefined : nearText(sql, offset);
  const where = near === undefined ? 'Unsupported SQL syntax.' : `Unsupported SQL near "${near}".`;
  const masked = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  const first = /^\s*\(?\s*([A-Za-z_]+)/.exec(masked)?.[1]?.toUpperCase();
  if (first === 'WITH') return reject.forbidden('WITH (CTE) is not allowed. Use a subquery.');
  if (first !== undefined && first !== 'SELECT') return reject.notSelect();
  if (/\bFOR\s+(UPDATE|SHARE)\b/i.test(masked)) {
    return reject.forbidden('FOR UPDATE and FOR SHARE are not allowed.');
  }
  if (/\bINTO\b/i.test(masked)) return reject.forbidden('INTO is not allowed.');
  if (/\bTOP\s+\d/i.test(masked))
    return reject.parse(`${where} Use the limit parameter instead of TOP.`);
  if (HANA_ONLY_SYNTAX.test(masked)) {
    return reject.parse(`${where} ${UNSUPPORTED_SYNTAX_HINT}`);
  }
  return reject.parse(`${where} Use plain SELECT syntax with the documented functions.`);
}
