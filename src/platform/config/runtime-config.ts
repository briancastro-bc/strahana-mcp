import { readFileSync } from 'node:fs';
import { errors } from '../errors/sanitized-error.js';
import { parseSigningKey } from '../security/hmac.js';
import type { CredentialProvider } from './credential-provider.js';
import {
  configIssue,
  configSchema,
  hanaCredentialsSchema,
  secretsSchema,
  type ApiKeyEntry,
  type EnvironmentConfig,
  type HanaCredentials,
  type StrahanaConfig,
} from './schema.js';

export const SECRETS_TAG = 'strahana-secrets';

export type TransportMode = 'http' | 'stdio';

export interface ResolvedEnvironment extends EnvironmentConfig {
  name: string;
  /** Connection credentials. Secret: never log or return them. */
  connection: HanaCredentials;
}

export interface RuntimeConfig {
  environments: Record<string, ResolvedEnvironment>;
  signingKey: Buffer;
  apiKeys: ApiKeyEntry[];
  /** Productive environments that stdio mode refused to load. */
  rejectedProductive: string[];
}

/** Reads and validates strahana.config.json (non-secret configuration). */
export function readConfigFile(path: string): StrahanaConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw errors.configInvalid(
      `${path} not found or unreadable. Copy strahana.config.example.json.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw errors.configInvalid(`${path} is not valid JSON.`);
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) throw configIssue(`${path}:`, parsed.error);
  return parsed.data;
}

export interface LoadRuntimeConfigInput {
  config: StrahanaConfig;
  credentials: CredentialProvider;
  mode: TransportMode;
}

/**
 * Combines the versioned configuration with the secrets and connection credentials, failing
 * fast with sanitized messages. Stdio mode never loads productive environments.
 */
export function loadRuntimeConfig({
  config,
  credentials,
  mode,
}: LoadRuntimeConfigInput): RuntimeConfig {
  const secretBindings = credentials.byTag(SECRETS_TAG);
  if (secretBindings.length !== 1) {
    throw errors.configInvalid(
      `exactly one service tagged ${SECRETS_TAG} is required (found ${secretBindings.length}).`,
    );
  }
  const secrets = secretsSchema.safeParse(secretBindings[0]);
  if (!secrets.success) throw configIssue(`service ${SECRETS_TAG}:`, secrets.error);
  const signingKey = parseSigningKey(secrets.data.signingKey);
  if (mode === 'http' && secrets.data.apiKeys.length === 0) {
    throw errors.configInvalid(
      `service ${SECRETS_TAG} has no apiKeys. Issue one with pnpm apikey:new and add its hash line.`,
    );
  }

  const environments: Record<string, ResolvedEnvironment> = {};
  const rejectedProductive: string[] = [];
  for (const [name, env] of Object.entries(config.environments)) {
    if (mode === 'stdio' && env.productive) {
      rejectedProductive.push(name);
      continue;
    }
    const raw = credentials.byName(env.service);
    if (raw === undefined) {
      throw errors.configInvalid(`environment ${name}: service ${env.service} is not bound.`);
    }
    const connection = hanaCredentialsSchema.safeParse(raw);
    if (!connection.success) {
      throw configIssue(`service ${env.service}:`, connection.error);
    }
    environments[name] = { ...env, name, connection: connection.data };
  }
  if (Object.keys(environments).length === 0) {
    throw errors.configInvalid(
      mode === 'stdio'
        ? 'stdio mode rejects productive environments and none is left. Add a non-productive one.'
        : 'no environments configured.',
    );
  }
  return { environments, signingKey, apiKeys: secrets.data.apiKeys, rejectedProductive };
}
