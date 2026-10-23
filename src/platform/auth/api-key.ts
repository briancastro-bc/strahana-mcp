import { randomBytes } from 'node:crypto';
import type { ApiKeyEntry } from '../config/schema.js';
import { sha256Hex } from '../security/hmac.js';

export const API_KEY_PREFIX = 'stk_';

/** `sha256:<hex>` of the plaintext key: the only form that is ever stored. */
export function hashApiKey(key: string): string {
  return `sha256:${sha256Hex(key)}`;
}

export interface IssuedApiKey {
  /** Plaintext key. Shown once; never stored or logged. */
  key: string;
  /** Entry to add to `apiKeys` in the strahana-secrets service. */
  entry: ApiKeyEntry;
}

export function issueApiKey(input: { user: string; groups: readonly string[] }): IssuedApiKey {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, entry: { user: input.user, keyHash: hashApiKey(key), groups: [...input.groups] } };
}
