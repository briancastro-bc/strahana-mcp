import type { Catalog, Column, Entity, Join } from './catalog.js';

export const MAX_CONTEXT_ENTITIES = 5;
export const MAX_CONTEXT_COLUMNS = 12;
/** Entities scoring below this fraction of the best one are not worth their tokens. */
const RELATIVE_SCORE_THRESHOLD = 0.25;
/** An entity never shows fewer columns than this (when it has them), so it stays usable. */
const MIN_COLUMNS = 6;

/** Search result consumed by the selection; produced by the CatalogSearch port. */
export interface RankedEntity {
  readonly entity: string;
  readonly score: number;
  readonly columns: readonly { readonly name: string; readonly score: number }[];
}

export interface ContextEntity {
  readonly entity: Entity;
  /** Shown columns, in catalog order. */
  readonly columns: readonly Column[];
  /** Columns of the entity that are not shown (`+N cols`). */
  readonly hiddenColumns: number;
  /** Joins whose target is also part of the context. */
  readonly joins: readonly Join[];
}

export interface ContextSelection {
  readonly entities: readonly ContextEntity[];
}

function joinsWithin(entity: Entity, included: ReadonlySet<string>): Join[] {
  return entity.joins.filter((join) => included.has(join.entity));
}

/** Columns that must be visible so the LLM can write the declared joins. */
function joinColumns(catalog: Catalog, name: string, included: ReadonlySet<string>): Set<string> {
  const needed = new Set<string>();
  for (const entity of catalog.entities) {
    if (!included.has(entity.name)) continue;
    for (const join of joinsWithin(entity, included)) {
      for (const pair of join.on) {
        if (entity.name === name) needed.add(pair.from);
        if (join.entity === name) needed.add(pair.to);
      }
    }
  }
  return needed;
}

function pickColumns(
  entity: Entity,
  forced: ReadonlySet<string>,
  matches: ReadonlyMap<string, number>,
  maxColumns: number,
): Column[] {
  const chosen = new Set<string>();
  const add = (name: string) => {
    if (chosen.size < maxColumns) chosen.add(name);
  };
  for (const column of entity.columns) if (column.key) add(column.name);
  for (const column of entity.columns) if (forced.has(column.name)) add(column.name);
  const ranked = entity.columns
    .map((column, index) => ({ column, index, score: matches.get(column.name) ?? 0 }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const item of ranked) add(item.column.name);
  for (const column of entity.columns) {
    if (chosen.size >= Math.min(MIN_COLUMNS, maxColumns)) break;
    add(column.name);
  }
  return entity.columns.filter((column) => chosen.has(column.name));
}

function toContextEntity(
  catalog: Catalog,
  entity: Entity,
  included: ReadonlySet<string>,
  matches: ReadonlyMap<string, number>,
  maxColumns: number,
): ContextEntity {
  const columns = pickColumns(
    entity,
    joinColumns(catalog, entity.name, included),
    matches,
    maxColumns,
  );
  return {
    entity,
    columns,
    hiddenColumns: entity.columns.length - columns.length,
    joins: joinsWithin(entity, included),
  };
}

function linked(catalog: Catalog, a: string, b: string): boolean {
  const joins = (name: string) => catalog.entities.find((e) => e.name === name)?.joins ?? [];
  return joins(a).some((join) => join.entity === b) || joins(b).some((join) => join.entity === a);
}

/**
 * Top-k entities (k <= 5) with their keys plus best-ranked columns (<= 12), and the declared
 * joins whose two ends are both selected (POV 5.4). Pure and deterministic.
 */
export function selectContext(
  catalog: Catalog,
  hits: readonly RankedEntity[],
  maxEntities = MAX_CONTEXT_ENTITIES,
  maxColumns = MAX_CONTEXT_COLUMNS,
): ContextSelection {
  const known = new Map(catalog.entities.map((entity) => [entity.name, entity]));
  const ranked = hits
    .filter((hit) => hit.score > 0 && known.has(hit.entity))
    .sort((a, b) => b.score - a.score || a.entity.localeCompare(b.entity));
  const best = ranked[0];
  if (best === undefined) return { entities: [] };

  const chosen = ranked
    .filter((hit) => hit.score >= best.score * RELATIVE_SCORE_THRESHOLD)
    .slice(0, maxEntities);
  // Spare slots go to weaker hits that are joinable with something already selected.
  for (const hit of ranked) {
    if (chosen.length >= maxEntities) break;
    if (chosen.includes(hit)) continue;
    if (chosen.some((other) => linked(catalog, hit.entity, other.entity))) chosen.push(hit);
  }

  const included = new Set(chosen.map((hit) => hit.entity));
  const entities = chosen.flatMap((hit) => {
    const entity = known.get(hit.entity);
    if (entity === undefined) return [];
    const matches = new Map(hit.columns.map((column) => [column.name, column.score]));
    return [toContextEntity(catalog, entity, included, matches, maxColumns)];
  });
  return { entities };
}

/** Progressive disclosure (`entities` parameter): every column of the requested entities. */
export function selectWholeEntities(catalog: Catalog, names: readonly string[]): ContextSelection {
  const included = new Set(names);
  const entities = names.flatMap((name) => {
    const entity = catalog.entities.find((candidate) => candidate.name === name);
    if (entity === undefined) return [];
    return [
      { entity, columns: entity.columns, hiddenColumns: 0, joins: joinsWithin(entity, included) },
    ];
  });
  return { entities };
}
