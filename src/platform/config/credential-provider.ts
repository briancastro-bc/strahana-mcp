import { filterServices, loadEnv } from '@sap/xsenv';
import { errors } from '../errors/sanitized-error.js';

/** Port: reads service credentials (VCAP_SERVICES format). Values are secrets: never log them. */
export interface CredentialProvider {
  /** Credentials of the binding with this exact name, or undefined. */
  byName(name: string): unknown;
  /** Credentials of every binding that carries this tag. */
  byTag(tag: string): unknown[];
}

/** Adapter: `@sap/xsenv` over VCAP_SERVICES, falling back to a local default-env.json. */
export function createXsenvCredentialProvider(
  defaultEnvFile = 'default-env.json',
): CredentialProvider {
  try {
    loadEnv(defaultEnvFile);
  } catch {
    // The parser error can quote file content; keep the message generic.
    throw errors.configInvalid(`${defaultEnvFile} is not valid JSON.`);
  }
  return {
    byName: (name) => filterServices({ name })[0]?.credentials,
    byTag: (tag) => filterServices({ tag }).map((binding) => binding.credentials),
  };
}

/** Adapter for tests and embedding: bindings held in memory. */
export function createInMemoryCredentialProvider(
  bindings: readonly { name: string; tags?: readonly string[]; credentials: unknown }[],
): CredentialProvider {
  return {
    byName: (name) => bindings.find((b) => b.name === name)?.credentials,
    byTag: (tag) => bindings.filter((b) => b.tags?.includes(tag)).map((b) => b.credentials),
  };
}
