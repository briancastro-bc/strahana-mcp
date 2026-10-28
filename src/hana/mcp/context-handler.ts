import type { BuiltContext, ContextRequest } from '../catalog/application/build-context.js';
import { authorizeEnvironment } from '../access/application/authorize-environment.js';
import { guardQuestion } from '../access/application/guard-question.js';
import { enforceRateLimit, type RateLimiter } from '../access/application/rate-limiter.js';
import type { EnvironmentGrants } from '../access/domain/environment-access.js';
import { systemClock, type Clock } from '../../platform/clock.js';
import { errors, toSanitizedError } from '../../platform/errors/sanitized-error.js';
import type { Logger } from '../../platform/logging/logger.js';
import { sha256Hex } from '../../platform/security/hmac.js';
import type { ContextToolHandler } from './tool-catalog.js';

export interface ContextEnvironment extends EnvironmentGrants {
  readonly limits: { readonly rateLimitPerMinute: number };
}

export interface ContextHandlerDeps {
  environments: Readonly<Record<string, ContextEnvironment>>;
  buildContext: (request: ContextRequest) => BuiltContext;
  rateLimiter: RateLimiter;
  logger: Logger;
  clock?: Clock;
}

const QUESTION_HASH_LENGTH = 16;

/** The question can be sensitive: only a short digest of its normalized text is ever logged. */
function hashQuestion(question: string): string {
  return sha256Hex(question.trim().toLowerCase().replace(/\s+/g, ' ')).slice(
    0,
    QUESTION_HASH_LENGTH,
  );
}

/**
 * Input adapter of `hana_context`: auth is done by the transport, this runs steps 2 and 3 of the
 * flow (environment authorization, guards, rate limit, context) and writes the audit record
 * (user, environment, duration, outcome, bytes, question hash; never values).
 */
export function createContextHandler(deps: ContextHandlerDeps): ContextToolHandler {
  const clock = deps.clock ?? systemClock;
  return (input, { principal }) => {
    const started = clock.now().getTime();
    let environment: string | undefined;
    const audit = (
      outcome: 'ok' | 'error',
      extra: { bytes?: number; code?: string; entities?: number },
    ) =>
      deps.logger.info('context audit', {
        event: 'context',
        tool: 'hana_context',
        user: principal.userId,
        ...(environment === undefined ? {} : { env: environment }),
        questionHash: hashQuestion(input.question),
        durationMs: clock.now().getTime() - started,
        outcome,
        ...extra,
      });
    try {
      environment = authorizeEnvironment(principal, input.environment, deps.environments);
      const limit = deps.environments[environment]?.limits.rateLimitPerMinute;
      if (limit === undefined) throw errors.internal();
      enforceRateLimit(deps.rateLimiter, principal.userId, limit);
      guardQuestion(input.question);
      const built = deps.buildContext({
        userId: principal.userId,
        environment,
        question: input.question,
        entities: input.entities,
      });
      audit('ok', { bytes: Buffer.byteLength(built.text), entities: built.entities.length });
      return Promise.resolve(built.text);
    } catch (error) {
      audit('error', { code: toSanitizedError(error).code });
      return Promise.reject(error instanceof Error ? error : toSanitizedError(error));
    }
  };
}
