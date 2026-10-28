import MiniSearch, { type SearchOptions } from 'minisearch';
import type { CatalogSearch, EntityHit } from '../application/ports.js';
import type { Catalog } from '../domain/catalog.js';
import { tokenize } from '../domain/text-normalizer.js';

interface EntityDoc {
  id: string;
  name: string;
  label: string;
  synonyms: string;
  columns: string;
}

interface ColumnDoc {
  id: string;
  entity: string;
  column: string;
  name: string;
  label: string;
  synonyms: string;
}

/** Terms from 3 chars match as prefixes; terms from 5 chars tolerate one typo. */
const SEARCH_OPTIONS: SearchOptions = {
  prefix: (term) => term.length >= 3,
  fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
  combineWith: 'OR',
};

const NORMALIZATION = { tokenize, processTerm: (term: string) => term };

/** POV 5.4: boosts favor names, labels and synonyms of the table over its column text. */
const ENTITY_BOOST = { name: 2, label: 3, synonyms: 3, columns: 1 };
const COLUMN_BOOST = { name: 2, label: 3, synonyms: 2.5 };

/**
 * In-memory lexical index over one catalog: one index for entities (name, label, synonyms and
 * the text of their columns) and one for columns, used to rank the columns inside an entity.
 */
export class MiniSearchCatalogSearch implements CatalogSearch {
  private readonly entities: MiniSearch<EntityDoc>;
  private readonly columns: MiniSearch<ColumnDoc>;

  constructor(catalog: Catalog) {
    this.entities = new MiniSearch<EntityDoc>({
      fields: ['name', 'label', 'synonyms', 'columns'],
      idField: 'id',
      ...NORMALIZATION,
    });
    this.columns = new MiniSearch<ColumnDoc>({
      fields: ['name', 'label', 'synonyms'],
      storeFields: ['entity', 'column'],
      idField: 'id',
      ...NORMALIZATION,
    });
    this.entities.addAll(
      catalog.entities.map((entity) => ({
        id: entity.name,
        name: entity.name,
        label: entity.label,
        synonyms: entity.synonyms.join(' '),
        columns: entity.columns
          .map((column) => [column.name, column.label, ...column.synonyms].join(' '))
          .join(' '),
      })),
    );
    this.columns.addAll(
      catalog.entities.flatMap((entity) =>
        entity.columns.map((column) => ({
          id: `${entity.name}.${column.name}`,
          entity: entity.name,
          column: column.name,
          name: column.name,
          label: column.label,
          synonyms: column.synonyms.join(' '),
        })),
      ),
    );
  }

  search(question: string): EntityHit[] {
    const columnScores = new Map<string, { name: string; score: number }[]>();
    for (const result of this.columns.search(question, {
      ...SEARCH_OPTIONS,
      boost: COLUMN_BOOST,
    })) {
      const entity = result['entity'] as string;
      const list = columnScores.get(entity) ?? [];
      list.push({ name: result['column'] as string, score: result.score });
      columnScores.set(entity, list);
    }
    return this.entities
      .search(question, { ...SEARCH_OPTIONS, boost: ENTITY_BOOST })
      .map((result) => ({
        entity: result.id as string,
        score: result.score,
        columns: columnScores.get(result.id as string) ?? [],
      }))
      .sort((a, b) => b.score - a.score || a.entity.localeCompare(b.entity));
  }
}
