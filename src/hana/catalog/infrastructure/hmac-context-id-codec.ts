import { systemClock, type Clock } from '../../../platform/clock.js';
import { openPayload, sealPayload } from '../../../platform/security/hmac.js';
import type { ContextIdCodec } from '../application/ports.js';
import type { ContextClaims } from '../domain/context-claims.js';

/** Contexts live 60 minutes (POV 4.1). */
export const DEFAULT_CONTEXT_TTL_SECONDS = 60 * 60;

interface Payload {
  /** user */
  u: string;
  /** environment */
  e: string;
  /** catalog version */
  v: string;
  /** entities */
  t: string[];
  /** expiry, epoch seconds */
  x: number;
}

function isPayload(value: unknown): value is Payload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p['u'] === 'string' &&
    typeof p['e'] === 'string' &&
    typeof p['v'] === 'string' &&
    Array.isArray(p['t']) &&
    p['t'].every((name) => typeof name === 'string') &&
    typeof p['x'] === 'number' &&
    Number.isFinite(p['x'])
  );
}

export interface HmacContextIdCodecOptions {
  /** Configured signing key (never random per process, POV 3.4 R7). */
  key: Buffer;
  ttlSeconds?: number;
  clock?: Clock;
}

/**
 * `context_id` = `<base64url(payload)>.<HMAC-SHA256>` binding user, environment, catalog version,
 * entities and expiry. The payload is signed, not encrypted: it carries no secrets.
 */
export class HmacContextIdCodec implements ContextIdCodec {
  readonly ttlSeconds: number;
  private readonly key: Buffer;
  private readonly clock: Clock;

  constructor({
    key,
    ttlSeconds = DEFAULT_CONTEXT_TTL_SECONDS,
    clock = systemClock,
  }: HmacContextIdCodecOptions) {
    this.key = key;
    this.ttlSeconds = ttlSeconds;
    this.clock = clock;
  }

  issue(claims: Omit<ContextClaims, 'expiresAt'>): string {
    const payload: Payload = {
      u: claims.userId,
      e: claims.environment,
      v: claims.catalogVersion,
      t: [...claims.entities],
      x: Math.floor(this.clock.now().getTime() / 1000) + this.ttlSeconds,
    };
    return sealPayload(this.key, JSON.stringify(payload));
  }

  open(token: string): ContextClaims | undefined {
    const raw = openPayload(this.key, token);
    if (raw === undefined) return undefined;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!isPayload(payload)) return undefined;
    if (payload.x * 1000 <= this.clock.now().getTime()) return undefined;
    return {
      userId: payload.u,
      environment: payload.e,
      catalogVersion: payload.v,
      entities: payload.t,
      expiresAt: payload.x,
    };
  }
}
