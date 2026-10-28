import type { Catalog } from '../domain/catalog.js';
import type { ContextClaims } from '../domain/context-claims.js';

/** Port: where catalogs come from (YAML files in the MVP). Throws SanitizedError when invalid. */
export interface CatalogSource {
  load(reference: string): Catalog;
}

/** Relevance of one catalog entity for a question, with the columns that matched. */
export interface EntityHit {
  readonly entity: string;
  readonly score: number;
  /** Matching columns, best first. */
  readonly columns: readonly { readonly name: string; readonly score: number }[];
}

/** Port: lexical search over one catalog (MiniSearch in the MVP). Deterministic ordering. */
export interface CatalogSearch {
  search(question: string): EntityHit[];
}

/** Port: issues and opens the signed `context_id`. */
export interface ContextIdCodec {
  issue(claims: Omit<ContextClaims, 'expiresAt'>): string;
  /** Returns the claims when the token is authentic and not expired, otherwise undefined. */
  open(token: string): ContextClaims | undefined;
  readonly ttlSeconds: number;
}
