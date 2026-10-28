import { errors } from '../../../platform/errors/sanitized-error.js';
import type { ContextClaims } from '../domain/context-claims.js';
import type { ContextIdCodec } from './ports.js';

export interface ContextExpectation {
  /** The authenticated user: a context is never valid for someone else. */
  userId: string;
  /** Current effective catalog version of an environment, or undefined if it is unknown. */
  catalogVersionOf(environment: string): string | undefined;
  /** When set, the context must have been issued for exactly this environment. */
  environment?: string;
}

/**
 * Opens a `context_id` for `hana_query` (phase 3). Every failure (tampering, expiry, other user,
 * other environment, outdated catalog) is the same `CONTEXT_INVALID` so the reason never leaks.
 */
export function verifyContextId(
  codec: ContextIdCodec,
  token: string,
  expected: ContextExpectation,
): ContextClaims {
  const claims = codec.open(token);
  if (
    claims === undefined ||
    claims.userId !== expected.userId ||
    (expected.environment !== undefined && claims.environment !== expected.environment) ||
    expected.catalogVersionOf(claims.environment) !== claims.catalogVersion
  ) {
    throw errors.contextInvalid();
  }
  return claims;
}
