import { closest, distance } from 'fastest-levenshtein';
import type { ColumnUse, SelectScope, Source, SqlAnalysis } from './sql-analyzer.js';
import { SqlRejection } from './sql-rejection.js';

/** What the validator needs to know about a catalog entity. Names are exact physical names. */
export interface EntityView {
  readonly name: string;
  readonly columns: readonly string[];
}

/** Read-only view of the environment's catalog (the application adapts the catalog to it). */
export interface CatalogView {
  entity(name: string): EntityView | undefined;
  entityNames(): readonly string[];
}

export interface ResolutionInput {
  readonly analysis: SqlAnalysis;
  readonly catalog: CatalogView;
  /** Physical names of the entities the `context_id` was issued for. */
  readonly contextEntities: ReadonlySet<string>;
  readonly environment: string;
}

const MAX_ECHOED_NAME = 60;

function shown(name: string): string {
  return name.length > MAX_ECHOED_NAME ? `${name.slice(0, MAX_ECHOED_NAME)}…` : name;
}

/** Suggestion by similarity, only when it is plausibly a typo. */
function suggest(name: string, candidates: readonly string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  const target = name.toUpperCase();
  const guess = closest(
    target,
    candidates.map((candidate) => candidate.toUpperCase()),
  );
  const limit = Math.max(2, Math.ceil(target.length / 3));
  if (distance(target, guess) > limit) return undefined;
  return candidates.find((candidate) => candidate.toUpperCase() === guess);
}

function didYouMean(name: string, candidates: readonly string[]): string {
  const guess = suggest(name, candidates);
  return guess === undefined ? '' : ` Did you mean ${guess}?`;
}

/**
 * Finds a physical entity from a table name as written. Unquoted names fold to upper case in
 * HANA; a name written between double quotes anywhere in the statement must match exactly.
 */
function findEntity(
  catalog: CatalogView,
  written: string,
  quotedIdentifiers: ReadonlySet<string>,
): EntityView | undefined {
  const exact = catalog.entity(written);
  if (exact !== undefined) return exact;
  if (quotedIdentifiers.has(written)) return undefined;
  const folded = catalog.entity(written.toUpperCase());
  return folded?.name === folded?.name.toUpperCase() ? folded : undefined;
}

interface ResolvedTable {
  readonly entity: EntityView;
  /** Exact column names reachable unquoted (upper case) by folded name. */
  readonly byFolded: ReadonlyMap<string, string>;
  readonly byExact: ReadonlySet<string>;
}

function describe(entity: EntityView): ResolvedTable {
  const byFolded = new Map<string, string>();
  for (const column of entity.columns) {
    if (column === column.toUpperCase()) byFolded.set(column, column);
  }
  return { entity, byFolded, byExact: new Set(entity.columns) };
}

/**
 * Stage 2 of the validator (POV 6.3 rules 4 and 5): every table must be in the context and every
 * column must exist in the catalog, resolving aliases and unqualified columns without ambiguity
 * (the "inference" of POV 3.3). Throws `SqlRejection`. Returns the physical tables used.
 */
export function resolveReferences(input: ResolutionInput): string[] {
  const { analysis, catalog, contextEntities, environment } = input;
  const resolved = new Map<object, ResolvedTable>();
  const used: string[] = [];

  for (const table of analysis.tables) {
    const entity = findEntity(catalog, table.name, analysis.quotedIdentifiers);
    if (entity === undefined) {
      throw new SqlRejection(
        'SQL_ENTITY_UNAVAILABLE',
        `${shown(table.name)} is not available in the catalog of ${environment}.${didYouMean(table.name, catalog.entityNames())}`,
      );
    }
    if (!contextEntities.has(entity.name)) {
      throw new SqlRejection(
        'SQL_ENTITY_NOT_IN_CONTEXT',
        `${entity.name} is not in this context. Call hana_context with entities:["${entity.name}"].`,
      );
    }
    resolved.set(table, describe(entity));
    if (!used.includes(entity.name)) used.push(entity.name);
  }

  const label = (source: Source): string =>
    (source.alias ?? (source.kind === 'table' ? source.name : '')).toUpperCase();

  const hasColumn = (source: Source, use: ColumnUse): boolean => {
    if (source.kind === 'derived') return source.query.outputs.has(use.column.toUpperCase());
    const table = resolved.get(source);
    if (table === undefined) return false;
    return use.quoted
      ? table.byExact.has(use.column)
      : table.byFolded.has(use.column.toUpperCase());
  };

  const displayName = (source: Source): string => {
    if (source.kind === 'derived') return source.alias;
    return resolved.get(source)?.entity.name ?? source.name;
  };

  const candidatesOf = (source: Source): readonly string[] =>
    source.kind === 'derived'
      ? [...source.query.outputs]
      : (resolved.get(source)?.entity.columns ?? []);

  const resolveQualified = (scope: SelectScope, use: ColumnUse, qualifier: string): void => {
    for (let current: SelectScope | undefined = scope; current; current = current.parent) {
      const source = current.sources.find(
        (candidate) => label(candidate) === qualifier.toUpperCase(),
      );
      if (source === undefined) continue;
      if (hasColumn(source, use)) return;
      throw new SqlRejection(
        'SQL_UNKNOWN_COLUMN',
        `${displayName(source)}.${shown(use.column)} does not exist.${didYouMean(use.column, candidatesOf(source))}`,
      );
    }
    throw new SqlRejection(
      'SQL_UNKNOWN_COLUMN',
      `${shown(qualifier)} is not a table or alias of this query. Use the alias declared in FROM.`,
    );
  };

  const resolveUnqualified = (scope: SelectScope, use: ColumnUse): void => {
    for (let current: SelectScope | undefined = scope; current; current = current.parent) {
      const matches = current.sources.filter((source) => hasColumn(source, use));
      if (matches.length === 1) return;
      if (matches.length > 1) {
        throw new SqlRejection(
          'SQL_AMBIGUOUS_COLUMN',
          `Column ${shown(use.column)} is ambiguous; qualify it with an alias.`,
        );
      }
    }
    if (use.aliasVisible && scope.selectAliases.has(use.column.toUpperCase())) return;
    const pool = [...new Set(scope.sources.flatMap((source) => candidatesOf(source)))];
    throw new SqlRejection(
      'SQL_UNKNOWN_COLUMN',
      `${shown(use.column)} does not exist in the tables of this query.${didYouMean(use.column, pool)}`,
    );
  };

  for (const scope of analysis.scopes) {
    for (const use of scope.uses) {
      if (use.qualifier === undefined) resolveUnqualified(scope, use);
      else resolveQualified(scope, use, use.qualifier);
    }
  }
  return used;
}
