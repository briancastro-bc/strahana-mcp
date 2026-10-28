import { format, resolveConfig } from 'prettier';
import { catalogJsonSchema } from '../src/hana/catalog/infrastructure/catalog-file-schema.js';

/**
 * Serialized JSON Schema of the catalog file, formatted like the rest of the repository so that
 * the committed `schemas/catalog.schema.json` passes `prettier --check`. Build/test-time only.
 */
export async function renderCatalogJsonSchema(): Promise<string> {
  const options = (await resolveConfig('schemas/catalog.schema.json')) ?? {};
  return format(JSON.stringify(catalogJsonSchema()), { ...options, parser: 'json' });
}
