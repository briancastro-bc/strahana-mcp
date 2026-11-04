import { InMemoryRateLimiter } from '../access/infrastructure/in-memory-rate-limiter.js';
import type { RateLimiter } from '../access/application/rate-limiter.js';
import {
  createBuildContext,
  type CatalogLookup,
  type EnvironmentCatalog,
} from '../catalog/application/build-context.js';
import type { CatalogSource } from '../catalog/application/ports.js';
import { HmacContextIdCodec } from '../catalog/infrastructure/hmac-context-id-codec.js';
import { MiniSearchCatalogSearch } from '../catalog/infrastructure/minisearch-catalog-search.js';
import { YamlCatalogSource } from '../catalog/infrastructure/yaml-catalog-source.js';
import { systemClock, type Clock } from '../../platform/clock.js';
import { errors } from '../../platform/errors/sanitized-error.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { ToolDefinition } from '../../platform/mcp/tool-definition.js';
import { createRunQuery, type QueryEnvironment } from '../query/application/run-query.js';
import type { SqlExecutor } from '../query/application/ports.js';
import { NodeSqlParserAdapter } from '../query/infrastructure/node-sql-parser-adapter.js';
import { createContextHandler, type ContextEnvironment } from './context-handler.js';
import { createQueryHandler } from './query-handler.js';
import { createHanaTools } from './tool-catalog.js';

export interface HanaToolsConfig {
  environments: Readonly<
    Record<string, ContextEnvironment & QueryEnvironment & { readonly catalog: string }>
  >;
  signingKey: Buffer;
}

export interface HanaToolsDeps {
  logger: Logger;
  /** Runs the validated SQL. In production it is the `@sap/hana-client` adapter. */
  executor: SqlExecutor;
  clock?: Clock;
  catalogSource?: CatalogSource;
  rateLimiter?: RateLimiter;
  contextTtlSeconds?: number;
}

/**
 * Composition of the HANA tools: loads and indexes the catalog of every environment (an invalid
 * catalog fails the startup, POV 5.3) and wires `hana_context` and `hana_query`. Both tools share
 * the catalogs, the context signer and the rate limiter.
 */
export function createConfiguredHanaTools(
  config: HanaToolsConfig,
  deps: HanaToolsDeps,
): readonly ToolDefinition[] {
  const clock = deps.clock ?? systemClock;
  const source = deps.catalogSource ?? new YamlCatalogSource();
  const loaded = new Map<string, EnvironmentCatalog>();
  const byPath = new Map<string, EnvironmentCatalog>();
  for (const [name, environment] of Object.entries(config.environments)) {
    let entry = byPath.get(environment.catalog);
    if (entry === undefined) {
      const catalog = source.load(environment.catalog);
      entry = { catalog, search: new MiniSearchCatalogSearch(catalog) };
      byPath.set(environment.catalog, entry);
    }
    loaded.set(name, entry);
  }
  const lookup: CatalogLookup = (environment) => {
    const entry = loaded.get(environment);
    if (entry === undefined) throw errors.internal();
    return entry;
  };
  const codec = new HmacContextIdCodec({
    key: config.signingKey,
    clock,
    ...(deps.contextTtlSeconds === undefined ? {} : { ttlSeconds: deps.contextTtlSeconds }),
  });
  const rateLimiter = deps.rateLimiter ?? new InMemoryRateLimiter(clock);
  return createHanaTools({
    context: createContextHandler({
      environments: config.environments,
      buildContext: createBuildContext(lookup, codec),
      rateLimiter,
      logger: deps.logger,
      clock,
    }),
    query: createQueryHandler(
      createRunQuery({
        environments: config.environments,
        catalogs: lookup,
        codec,
        parser: new NodeSqlParserAdapter(),
        executor: deps.executor,
        rateLimiter,
        audit: deps.logger,
        clock,
      }),
    ),
  });
}
