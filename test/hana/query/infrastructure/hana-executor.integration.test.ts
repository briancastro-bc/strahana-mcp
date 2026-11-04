import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HanaSqlExecutor,
  connectionOptions,
  loadHanaDriver,
  type HanaConnectionLike,
} from '../../../../src/hana/query/infrastructure/hana-executor.js';
import { createXsenvCredentialProvider } from '../../../../src/platform/config/credential-provider.js';
import {
  loadRuntimeConfig,
  readConfigFile,
} from '../../../../src/platform/config/runtime-config.js';
import { SanitizedError } from '../../../../src/platform/errors/sanitized-error.js';

/**
 * Opt-in integration test against a real SAP HANA Cloud (POV 15: "0 sentencias distintas de
 * SELECT" and "STRAHANA_RO no puede escribir"). SKIPPED unless STRAHANA_IT=1.
 *
 *   STRAHANA_IT=1                      enable
 *   STRAHANA_IT_ENV=DEV-SALES          environment of strahana.config.json (default: the first)
 *   STRAHANA_IT_SELECT="SELECT ..."    a read-only SELECT (default: SELECT 1 AS ONE FROM DUMMY)
 *   STRAHANA_IT_WRITE_SQL="UPDATE ..." a write on a catalog object that matches no rows, for
 *                                      example UPDATE <TABLE> SET <COL> = <COL> WHERE 1 = 0
 *
 * Credentials come from default-env.json; the user MUST be the dedicated STRAHANA_RO, never the
 * HDI runtime user. Use synthetic data only.
 */
const enabled = process.env['STRAHANA_IT'] === '1';
const skip = enabled ? false : 'set STRAHANA_IT=1 (and default-env.json for STRAHANA_RO) to run';

function setup() {
  const runtime = loadRuntimeConfig({
    config: readConfigFile(process.env['STRAHANA_CONFIG'] ?? 'strahana.config.json'),
    credentials: createXsenvCredentialProvider(),
    mode: 'stdio',
  });
  const name = process.env['STRAHANA_IT_ENV'] ?? Object.keys(runtime.environments)[0] ?? '';
  const environment = runtime.environments[name];
  assert.ok(environment, `environment ${name} not found`);
  assert.equal(
    environment.connection.user.toUpperCase().includes('STRAHANA_RO') ||
      process.env['STRAHANA_IT_ALLOW_USER'] === environment.connection.user,
    true,
    'the integration test must run as the read-only user STRAHANA_RO',
  );
  const executor = new HanaSqlExecutor({ environments: { [name]: environment } });
  return { name, environment, executor };
}

test('a SELECT runs as STRAHANA_RO', { skip }, async () => {
  const { name, executor } = setup();
  try {
    const sql = `${process.env['STRAHANA_IT_SELECT'] ?? 'SELECT 1 AS ONE FROM DUMMY'} LIMIT 5 OFFSET 0`;
    const result = await executor.execute({ environment: name, sql, timeoutSeconds: 30 });
    assert.ok(result.columns.length > 0);
    assert.ok(result.rows.length <= 5);
  } finally {
    await executor.close();
  }
});

test(
  'a write attempt through the executor MUST FAIL (read-only transaction)',
  { skip },
  async () => {
    const write = process.env['STRAHANA_IT_WRITE_SQL'];
    assert.ok(write, 'set STRAHANA_IT_WRITE_SQL to a write on a catalog object');
    const { name, executor } = setup();
    try {
      await assert.rejects(
        executor.execute({ environment: name, sql: write, timeoutSeconds: 30 }),
        (error: unknown) => error instanceof SanitizedError && error.code === 'DB_ERROR',
      );
    } finally {
      await executor.close();
    }
  },
);

test(
  'STRAHANA_RO itself cannot write, even without the read-only transaction (layer 1)',
  { skip },
  async () => {
    const write = process.env['STRAHANA_IT_WRITE_SQL'];
    assert.ok(write, 'set STRAHANA_IT_WRITE_SQL to a write on a catalog object');
    const { environment } = setup();
    const driver = loadHanaDriver() as unknown as {
      createConnection(options: Record<string, unknown>): HanaConnectionLike & {
        connect(callback: (error: Error | null) => void): void;
      };
    };
    const connection = driver.createConnection(connectionOptions(environment, 5));
    await new Promise<void>((resolve, reject) => {
      connection.connect((error) => (error ? reject(error) : resolve()));
    });
    try {
      const outcome = await new Promise<'written' | 'refused'>((resolve) => {
        connection.exec(write, (error) => resolve(error ? 'refused' : 'written'));
      });
      assert.equal(
        outcome,
        'refused',
        'STRAHANA_RO was able to write: fix its .hdbrole before going on',
      );
    } finally {
      connection.disconnect();
    }
  },
);
