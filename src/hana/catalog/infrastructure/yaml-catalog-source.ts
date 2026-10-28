import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { configIssue } from '../../../platform/config/schema.js';
import { errors } from '../../../platform/errors/sanitized-error.js';
import { sha256Hex } from '../../../platform/security/hmac.js';
import type { CatalogSource } from '../application/ports.js';
import type { Catalog, Entity } from '../domain/catalog.js';
import { catalogFileSchema, type CatalogFile } from './catalog-file-schema.js';

const DIGEST_LENGTH = 8;

function toEntities(file: CatalogFile): Entity[] {
  return file.entities.map((entity) => ({
    name: entity.name,
    label: entity.label,
    synonyms: entity.synonyms,
    columns: entity.columns.map((column) => ({
      name: column.name,
      type: column.type,
      ...(column.length === undefined ? {} : { length: column.length }),
      ...(column.precision === undefined ? {} : { precision: column.precision }),
      ...(column.scale === undefined ? {} : { scale: column.scale }),
      key: column.key,
      label: column.label,
      synonyms: column.synonyms,
    })),
    joins: entity.joins.map((join) => ({
      entity: join.entity,
      on: Object.entries(join.on).map(([from, to]) => ({ from, to })),
    })),
    rules: entity.rules,
  }));
}

/** Builds the domain catalog from the validated file, deriving the effective version. */
export function buildCatalog(file: CatalogFile): Catalog {
  const entities = toEntities(file);
  const digest = sha256Hex(JSON.stringify({ d: file.domain, e: entities })).slice(0, DIGEST_LENGTH);
  return {
    domain: file.domain,
    label: file.label,
    fileVersion: file.version,
    version: `${file.version}.${digest}`,
    entities,
  };
}

/** Parses and validates catalog YAML text. `source` only labels error messages. */
export function parseCatalogYaml(text: string, source: string): Catalog {
  const document = parseDocument(text, { uniqueKeys: true });
  const [syntaxError] = document.errors;
  if (syntaxError !== undefined) {
    const line = syntaxError.linePos?.[0]?.line;
    throw errors.configInvalid(
      `${source}: YAML syntax error${line === undefined ? '' : ` at line ${line}`} (${syntaxError.code}).`,
    );
  }
  const parsed = catalogFileSchema.safeParse(document.toJS());
  if (!parsed.success) throw configIssue(`catalog ${source}:`, parsed.error);
  return buildCatalog(parsed.data);
}

/** Catalog source backed by YAML files. A missing or invalid file fails closed. */
export class YamlCatalogSource implements CatalogSource {
  load(reference: string): Catalog {
    let text: string;
    try {
      text = readFileSync(reference, 'utf8');
    } catch {
      throw errors.configInvalid(`catalog ${reference} not found or unreadable.`);
    }
    return parseCatalogYaml(text, reference);
  }
}
