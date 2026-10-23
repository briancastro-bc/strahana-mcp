import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { errors } from '../errors/sanitized-error.js';

const MIN_KEY_BYTES = 32;

/**
 * Decodes the configured signing key. The key must come from configuration (never random per
 * process) so signed handles survive restarts. The offending value is never echoed.
 */
export function parseSigningKey(base64: string): Buffer {
  const valid = /^[A-Za-z0-9+/_-]+={0,2}$/.test(base64);
  const key = valid ? Buffer.from(base64, 'base64') : Buffer.alloc(0);
  if (key.length < MIN_KEY_BYTES) {
    throw errors.configInvalid(
      `signingKey must be at least ${MIN_KEY_BYTES} random bytes in base64.`,
    );
  }
  return key;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison that tolerates different lengths. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function hmacSign(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('base64url');
}

export function hmacVerify(key: Buffer, data: string, signature: string): boolean {
  return safeEqual(Buffer.from(hmacSign(key, data)), Buffer.from(signature));
}

/** Builds `<base64url(payload)>.<signature>`. */
export function sealPayload(key: Buffer, payload: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  return `${body}.${hmacSign(key, body)}`;
}

/** Returns the payload when the signature is valid, otherwise undefined. */
export function openPayload(key: Buffer, token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 2) return undefined;
  const [body = '', signature = ''] = parts;
  if (!hmacVerify(key, body, signature)) return undefined;
  return Buffer.from(body, 'base64url').toString('utf8');
}
