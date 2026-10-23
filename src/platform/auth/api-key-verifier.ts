import { errors } from '../errors/sanitized-error.js';
import type { ApiKeyEntry } from '../config/schema.js';
import { safeEqual, sha256Hex } from '../security/hmac.js';
import type { Principal } from './principal.js';
import type { AuthHeaders, TokenVerifier } from './token-verifier.js';

const MAX_KEY_LENGTH = 256;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Reads the key from `Authorization: Bearer <key>` or, failing that, from `X-API-Key`. */
function extractKey(headers: AuthHeaders): string | undefined {
  const authorization = single(headers['authorization']);
  const bearer =
    authorization === undefined ? undefined : /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (bearer !== undefined) return bearer;
  return single(headers['x-api-key']);
}

interface StoredKey {
  hash: Buffer;
  principal: Principal;
}

/**
 * Pilot adapter of TokenVerifier: one key per user, compared by SHA-256 hash. Every stored
 * hash is compared on every call (no early exit), so timing does not reveal which key matched.
 */
export class ApiKeyVerifier implements TokenVerifier {
  private readonly stored: StoredKey[];

  constructor(entries: readonly ApiKeyEntry[]) {
    this.stored = entries.map((entry) => ({
      hash: Buffer.from(entry.keyHash.slice('sha256:'.length), 'hex'),
      principal: { userId: entry.user, groups: [...entry.groups] },
    }));
  }

  verify(headers: AuthHeaders): Promise<Principal> {
    const key = extractKey(headers);
    if (key === undefined || key.length > MAX_KEY_LENGTH) {
      return Promise.reject(errors.authRequired());
    }
    const presented = Buffer.from(sha256Hex(key), 'hex');
    let match: Principal | undefined;
    for (const candidate of this.stored) {
      if (safeEqual(presented, candidate.hash)) match = candidate.principal;
    }
    return match === undefined ? Promise.reject(errors.authRequired()) : Promise.resolve(match);
  }
}
