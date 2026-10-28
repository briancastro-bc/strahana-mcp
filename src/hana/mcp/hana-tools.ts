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
import { createContextHandler, type ContextEnvironment } from './context-handler.js';
import { createHanaTools } from './tool-catalog.js';

export interface HanaToolsConfig {
  environments: Readonly<Record<string, ContextEnvironment & { readonly catalog: string }>>;
  signingKey: Buffer;
}

export interface HanaToolsDeps {
  logger: Logger;
  clock?: Clock;
  catalogSource?: CatalogSource;
  rateLimiter?: RateLimiter;
  contextTtlSeconds?: number;
}

/**
 * Composition of the HANA tools: loads and indexes the catalog of every environment (an invalid
 * catalog fails the startup, POV 5.3) and wires `hana_context`. `hana_query` stays a placeholder
 * until phase 3.
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
  return createHanaTools({
    context: createContextHandler({
      environments: config.environments,
      buildContext: createBuildContext(lookup, codec),
      rateLimiter: deps.rateLimiter ?? new InMemoryRateLimiter(clock),
      logger: deps.logger,
      clock,
    }),
  });
}
