export const COLUMN_TYPES = [
  'string',
  'decimal',
  'integer',
  'bigint',
  'date',
  'timestamp',
  'boolean',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface Column {
  /** Exact physical column name. */
  readonly name: string;
  readonly type: ColumnType;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly key: boolean;
  /** Short label (at most 4 words). Sent to the LLM. */
  readonly label: string;
  /** Search-only terms. Never sent to the LLM. */
  readonly synonyms: readonly string[];
}

/** One column pair of a join: `from` belongs to the declaring entity, `to` to the target. */
export interface JoinColumns {
  readonly from: string;
  readonly to: string;
}

export interface Join {
  readonly entity: string;
  readonly on: readonly JoinColumns[];
}

export interface Entity {
  /** Exact physical table or view name. */
  readonly name: string;
  readonly label: string;
  /** Search-only terms. Never sent to the LLM. */
  readonly synonyms: readonly string[];
  readonly columns: readonly Column[];
  readonly joins: readonly Join[];
  /** Short usage hints, sent to the LLM only when the entity is part of the context. */
  readonly rules: readonly string[];
}

export interface Catalog {
  readonly domain: string;
  readonly label: string;
  /** Number maintained by the catalog owner (POV 5.3). */
  readonly fileVersion: number;
  /**
   * Effective version: the file version plus a digest of the validated content, so that an edit
   * without a version bump still invalidates previously issued contexts.
   */
  readonly version: string;
  readonly entities: readonly Entity[];
}

export function findEntity(catalog: Catalog, name: string): Entity | undefined {
  return catalog.entities.find((entity) => entity.name === name);
}
