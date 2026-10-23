#!/usr/bin/env node
import { parseCliArgs, start } from './bootstrap.js';
import { toSanitizedError } from './platform/errors/sanitized-error.js';
import { createLogger } from './platform/logging/logger.js';

const logger = createLogger();

async function main(): Promise<void> {
  const app = await start(parseCliArgs(process.argv.slice(2)), { logger });
  const shutdown = () => {
    void app.close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  const sanitized = toSanitizedError(error);
  logger.error(sanitized.message, { code: sanitized.code, event: 'startup' });
  process.exit(1);
});
