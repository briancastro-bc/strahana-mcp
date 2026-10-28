import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SanitizedError } from '../src/platform/errors/sanitized-error.js';
import { YamlCatalogSource } from '../src/hana/catalog/infrastructure/yaml-catalog-source.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const files =
  args.length > 0
    ? args
    : readdirSync('catalog')
        .filter((name) => name.endsWith('.catalog.yaml'))
        .sort()
        .map((name) => join('catalog', name));

const source = new YamlCatalogSource();
let failed = false;
for (const file of files) {
  try {
    const catalog = source.load(file);
    process.stdout.write(
      `OK ${file}: ${catalog.entities.length} entities, version ${catalog.version}\n`,
    );
  } catch (error) {
    failed = true;
    const message = error instanceof SanitizedError ? error.message : 'unexpected error';
    process.stderr.write(`FAIL ${file}: ${message}\n`);
  }
}
if (files.length === 0) {
  failed = true;
  process.stderr.write('FAIL no catalog/*.catalog.yaml files found\n');
}
process.exitCode = failed ? 1 : 0;
