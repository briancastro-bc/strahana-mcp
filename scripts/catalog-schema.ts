import { writeFileSync } from 'node:fs';
import { renderCatalogJsonSchema } from './catalog-json-schema.js';

writeFileSync('schemas/catalog.schema.json', await renderCatalogJsonSchema());
process.stdout.write('schemas/catalog.schema.json updated\n');
