/** What a `context_id` binds (POV 3.4 R3, 4.1). */
export interface ContextClaims {
  readonly userId: string;
  readonly environment: string;
  /** Effective catalog version the context was built from. */
  readonly catalogVersion: string;
  /** Physical names of the entities that are part of the context. */
  readonly entities: readonly string[];
  /** Expiry as epoch seconds. */
  readonly expiresAt: number;
}
