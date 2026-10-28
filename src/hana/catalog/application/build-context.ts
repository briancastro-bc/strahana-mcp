import { closest, distance } from 'fastest-levenshtein';
import { errors } from '../../../platform/errors/sanitized-error.js';
import type { Catalog } from '../domain/catalog.js';
import { renderContext } from '../domain/context-renderer.js';
import {
  selectContext,
  selectWholeEntities,
  type ContextSelection,
} from '../domain/context-selection.js';
import type { CatalogSearch, ContextIdCodec } from './ports.js';

export interface EnvironmentCatalog {
  readonly catalog: Catalog;
  readonly search: CatalogSearch;
}

/** Resolves the catalog loaded for an environment. Environments are loaded at startup. */
export type CatalogLookup = (environment: string) => EnvironmentCatalog;

export interface ContextRequest {
  userId: string;
  environment: string;
  question: string;
  /** Progressive disclosure: return every column of these entities. */
  entities?: readonly string[] | undefined;
}

export interface BuiltContext {
  /** The single text block returned to the LLM. */
  text: string;
  matched: boolean;
  entities: readonly string[];
}

const MAX_OVERVIEW_ENTITIES = 30;
const MAX_ECHOED_NAME = 60;

function resolveEntities(catalog: Catalog, requested: readonly string[]): string[] {
  const names = catalog.entities.map((entity) => entity.name);
  const byUpper = new Map(names.map((name) => [name.toUpperCase(), name]));
  const resolved: string[] = [];
  for (const raw of requested) {
    const name = byUpper.get(raw.trim().toUpperCase());
    if (name === undefined) {
      const shown = raw.trim().slice(0, MAX_ECHOED_NAME);
      const guess = names.length > 0 ? closest(shown.toUpperCase(), names) : undefined;
      const hint =
        guess !== undefined && distance(shown.toUpperCase(), guess) <= Math.max(3, guess.length / 3)
          ? ` Did you mean ${guess}?`
          : ' Call hana_context without entities to discover tables.';
      throw errors.invalidInput(`Unknown entity ${shown} in ${catalog.domain} catalog.${hint}`);
    }
    if (!resolved.includes(name)) resolved.push(name);
  }
  return resolved;
}

function overview(catalog: Catalog, environment: string): string {
  const lines = catalog.entities
    .slice(0, MAX_OVERVIEW_ENTITIES)
    .map((entity) => `${entity.name} "${entity.label}"`);
  const rest = catalog.entities.length - lines.length;
  if (rest > 0) lines.push(`+${rest} more`);
  return [
    `No table of ${environment} matches the question. Rephrase it with business terms or pass entities:[...].`,
    ...lines,
  ].join('\n');
}

/**
 * Step 3 of the flow (POV 3.2): finds the relevant tables and columns in the environment's
 * catalog and returns the compact context with a signed `context_id`. The caller has already
 * authenticated, authorized the environment and applied the input guards.
 */
export function createBuildContext(lookup: CatalogLookup, codec: ContextIdCodec) {
  return (request: ContextRequest): BuiltContext => {
    const { catalog, search } = lookup(request.environment);
    let selection: ContextSelection;
    if (request.entities !== undefined && request.entities.length > 0) {
      selection = selectWholeEntities(catalog, resolveEntities(catalog, request.entities));
    } else {
      selection = selectContext(catalog, search.search(request.question));
    }
    if (selection.entities.length === 0) {
      return { text: overview(catalog, request.environment), matched: false, entities: [] };
    }
    const entities = selection.entities.map((item) => item.entity.name);
    const contextId = codec.issue({
      userId: request.userId,
      environment: request.environment,
      catalogVersion: catalog.version,
      entities,
    });
    const text = renderContext(selection, {
      contextId,
      environment: request.environment,
      ttlMinutes: Math.ceil(codec.ttlSeconds / 60),
    });
    return { text, matched: true, entities };
  };
}
