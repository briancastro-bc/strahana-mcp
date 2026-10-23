/** Identity produced by every authentication adapter (API key now, IAS later). */
export interface Principal {
  readonly userId: string;
  readonly groups: readonly string[];
}

/** Identity used by stdio mode, which does not authenticate. */
export function createLocalPrincipal(groups: Iterable<string>): Principal {
  return { userId: 'local', groups: [...new Set(groups)].sort() };
}
