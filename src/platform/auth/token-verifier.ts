import type { Principal } from './principal.js';

/** Lower-cased request headers, as exposed by Node's HTTP server. */
export type AuthHeaders = Readonly<Record<string, string | string[] | undefined>>;

/**
 * Port: authenticates one request. Resolves to a Principal or rejects with AUTH_REQUIRED.
 * ApiKeyVerifier is the pilot adapter; an IAS adapter replaces it without touching callers.
 */
export interface TokenVerifier {
  verify(headers: AuthHeaders): Promise<Principal>;
}
