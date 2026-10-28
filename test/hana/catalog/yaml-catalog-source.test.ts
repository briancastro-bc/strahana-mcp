import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderCatalogJsonSchema } from '../../../scripts/catalog-json-schema.js';
import { findEntity } from '../../../src/hana/catalog/domain/catalog.js';
import {
  parseCatalogYaml,
  YamlCatalogSource,
} from '../../../src/hana/catalog/infrastructure/yaml-catalog-source.js';
import { SanitizedError } from '../../../src/platform/errors/sanitized-error.js';

const VALID = `
domain: demo
version: 2
label: Demo
entities:
  - name: DEMO_A
    label: Tabla A
    synonyms: [alfa]
    columns:
      - { name: ID, type: string, length: 36, key: true, label: ID }
      - { name: AMOUNT, type: decimal, precision: 15, scale: 2, label: Importe }
      - { name: B_ID, type: string, length: 36, label: Tabla B }
    joins:
      - { entity: DEMO_B, on: { B_ID: ID } }
    rules: ["STATUS: O=open"]
  - name: DEMO_B
    label: Tabla B
    columns:
      - { name: ID, type: string, length: 36, key: true, label: ID }
`;

function rejects(text: string, fragment: RegExp) {
  assert.throws(
    () => parseCatalogYaml(text, 'x.catalog.yaml'),
    (error: unknown) =>
      error instanceof SanitizedError &&
      error.code === 'CONFIG_INVALID' &&
      !error.message.includes('\n') &&
      fragment.test(error.message),
  );
}

test('parses a valid catalog into the domain model with defaults', () => {
  const catalog = parseCatalogYaml(VALID, 'demo.catalog.yaml');
  assert.equal(catalog.domain, 'demo');
  assert.equal(catalog.fileVersion, 2);
  assert.match(catalog.version, /^2\.[0-9a-f]{8}$/);
  const a = findEntity(catalog, 'DEMO_A');
  assert.deepEqual(a?.joins, [{ entity: 'DEMO_B', on: [{ from: 'B_ID', to: 'ID' }] }]);
  assert.deepEqual(a.rules, ['STATUS: O=open']);
  assert.equal(a.columns[2]?.key, false);
  assert.deepEqual(findEntity(catalog, 'DEMO_B')?.synonyms, []);
});

test('the effective version is derived from content, not only from the file version', () => {
  const same = parseCatalogYaml(VALID, 'a').version;
  assert.equal(parseCatalogYaml(`${VALID}\n# a comment changes nothing\n`, 'b').version, same);
  const edited = VALID.replace('label: Importe', 'label: Monto');
  assert.notEqual(parseCatalogYaml(edited, 'c').version, same);
});

test('fails closed with one-line, actionable, sanitized errors', () => {
  rejects('domain: [', /YAML syntax error at line \d+/);
  rejects(VALID.replace('version: 2', 'version: 0'), /version/);
  rejects(
    VALID.replace('label: Importe', 'label: Importe del total del pedido'),
    /at most 4 words/,
  );
  rejects(
    VALID.replace('type: decimal, precision: 15, ', 'type: decimal, '),
    /decimal requires precision/,
  );
  rejects(VALID.replace('B_ID: ID', 'MISSING: ID'), /unknown column in this entity/);
  rejects(VALID.replace('B_ID: ID', 'B_ID: NOPE'), /unknown column in the join target/);
  rejects(VALID.replace('entity: DEMO_B, on', 'entity: DEMO_Z, on'), /join target/);
  rejects(VALID.replace('name: DEMO_B', 'name: DEMO_A'), /duplicated entity name/);
  rejects(VALID.replace('name: AMOUNT', 'name: ID'), /duplicated column name/);
  rejects(VALID.replace('name: DEMO_A', 'name: MYSCHEMA.DEMO_A'), /plain identifier/);
  rejects(VALID.replace('name: DEMO_B', 'name: SYS_TABLES'), /system objects/);
  rejects(VALID.replace('rules: ["STATUS: O=open"]', 'unexpected: 1'), /Unrecognized key/);
  rejects(VALID.replace('domain: demo', 'domain: demo\ndomain: other'), /YAML syntax error/);
});

test('error messages never echo rejected values', () => {
  const secret = 'SUPER-SECRET-VALUE-123';
  assert.throws(
    () => parseCatalogYaml(VALID.replace('type: decimal', `type: ${secret}`), 'x'),
    (error: unknown) => error instanceof SanitizedError && !error.message.includes(secret),
  );
});

test('a missing file is reported without leaking anything else', () => {
  assert.throws(
    () => new YamlCatalogSource().load('catalog/does-not-exist.catalog.yaml'),
    /not found or unreadable/,
  );
});

test('the shipped example catalog is valid, synthetic and within the pilot size', () => {
  const catalog = new YamlCatalogSource().load('catalog/sales.catalog.yaml');
  assert.ok(catalog.entities.length >= 8 && catalog.entities.length <= 30);
  assert.ok(catalog.entities.every((entity) => entity.name.startsWith('COM_ACME_SALES_')));
});

test('schemas/catalog.schema.json is in sync (run pnpm catalog:schema to refresh)', async () => {
  assert.equal(
    readFileSync('schemas/catalog.schema.json', 'utf8'),
    await renderCatalogJsonSchema(),
  );
});
