import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import { createConfiguredHanaTools } from './hana/mcp/hana-tools.js';
import type { SqlExecutor } from './hana/query/application/ports.js';
import { HanaSqlExecutor } from './hana/query/infrastructure/hana-executor.js';
import { ApiKeyVerifier } from './platform/auth/api-key-verifier.js';
import { createLocalPrincipal } from './platform/auth/principal.js';
import {
  createXsenvCredentialProvider,
  type CredentialProvider,
} from './platform/config/credential-provider.js';
import {
  loadRuntimeConfig,
  readConfigFile,
  type TransportMode,
} from './platform/config/runtime-config.js';
import type { Clock } from './platform/clock.js';
import { errors } from './platform/errors/sanitized-error.js';
import { createLogger, type Logger } from './platform/logging/logger.js';
import { createMcpServer } from './platform/mcp/create-mcp-server.js';
import { createHttpApp, listen } from './platform/mcp/http-app.js';
import { runStdio } from './platform/mcp/stdio-transport.js';
import { VERSION } from './version.js';

export interface CliOptions {
  mode: TransportMode;
  configPath: string;
  envFile: string;
  port: number;
}

const DEFAULT_PORT = 8080;

export function parseCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        transport: { type: 'string' },
        config: { type: 'string' },
        'env-file': { type: 'string' },
        port: { type: 'string' },
      },
      strict: true,
    }));
  } catch {
    throw errors.configInvalid(
      'unknown option. Use --transport http|stdio [--config <file>] [--env-file <file>] [--port <n>].',
    );
  }
  const transport = values.transport ?? 'http';
  if (transport !== 'http' && transport !== 'stdio') {
    throw errors.configInvalid('--transport must be http or stdio.');
  }
  const rawPort = values.port ?? env['PORT'] ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw errors.configInvalid('port must be an integer between 0 and 65535.');
  }
  return {
    mode: transport,
    configPath: values.config ?? 'strahana.config.json',
    envFile: values['env-file'] ?? 'default-env.json',
    port,
  };
}

export interface RunningApp {
  /** Bound port in HTTP mode. */
  port?: number;
  close: () => Promise<void>;
}

export interface StartDeps {
  credentials?: CredentialProvider;
  logger?: Logger;
  /** Clock for contexts and rate limits (tests). */
  clock?: Clock;
  /** Replaces the `@sap/hana-client` executor (tests, or a database stand-in). */
  executor?: SqlExecutor;
  /** Interface to bind in HTTP mode (all interfaces on Cloud Foundry). */
  host?: string;
}

/** Composition root: wires configuration, auth, tools and the chosen transport. */
export async function start(options: CliOptions, deps: StartDeps = {}): Promise<RunningApp> {
  const logger = deps.logger ?? createLogger();
  const credentials = deps.credentials ?? createXsenvCredentialProvider(options.envFile);
  const config = readConfigFile(options.configPath);
  const runtime = loadRuntimeConfig({ config, credentials, mode: options.mode });
  const serverInfo = { name: 'strahana', version: VERSION };
  const hana =
    deps.executor === undefined
      ? new HanaSqlExecutor({ environments: runtime.environments })
      : undefined;
  const executor = deps.executor ?? hana;
  if (executor === undefined) throw errors.internal();
  const tools = createConfiguredHanaTools(
    { environments: runtime.environments, signingKey: runtime.signingKey },
    { logger, executor, ...(deps.clock === undefined ? {} : { clock: deps.clock }) },
  );

  if (options.mode === 'stdio') {
    for (const name of runtime.rejectedProductive) {
      logger.warn(`stdio mode rejects productive environment ${name}`, { transport: 'stdio' });
    }
    const principal = createLocalPrincipal(
      Object.values(runtime.environments).flatMap((env) => env.groups),
    );
    const server = createMcpServer({ tools, principal, logger, serverInfo });
    await runStdio(server);
    logger.info('server started', { transport: 'stdio' });
    return {
      close: async () => {
        await server.close();
        await hana?.close();
      },
    };
  }

  const app = createHttpApp({
    verifier: new ApiKeyVerifier(runtime.apiKeys),
    buildServer: (principal) => createMcpServer({ tools, principal, logger, serverInfo }),
    logger,
  });
  const httpServer = await listen(app, options.port, deps.host);
  const port = (httpServer.address() as AddressInfo).port;
  logger.info('server started', { transport: 'http', port });
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        httpServer.closeAllConnections();
      }).then(() => hana?.close()),
  };
}
