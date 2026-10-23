import type { Principal } from '../../../platform/auth/principal.js';
import { errors } from '../../../platform/errors/sanitized-error.js';
import { allowedEnvironments, type EnvironmentGrants } from '../domain/environment-access.js';

/**
 * Resolves the environment a principal may use. The environment is explicit: when omitted it is
 * only inferred if exactly one environment is allowed. Unknown and forbidden environments are
 * indistinguishable to the caller.
 */
export function authorizeEnvironment(
  principal: Principal,
  requested: string | undefined,
  environments: Readonly<Record<string, EnvironmentGrants>>,
): string {
  const allowed = allowedEnvironments(principal.groups, environments);
  if (requested !== undefined) {
    if (allowed.includes(requested)) return requested;
    throw errors.envForbidden(requested);
  }
  const [only, ...rest] = allowed;
  if (only === undefined) throw errors.noEnvironmentAccess();
  if (rest.length === 0) return only;
  throw errors.envRequired(allowed);
}
