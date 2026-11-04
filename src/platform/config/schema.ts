import { z } from 'zod';
import { errors } from '../errors/sanitized-error.js';

export const limitsSchema = z
  .strictObject({
    pageSize: z.number().int().min(1).default(50),
    maxRows: z.number().int().min(1).default(500),
    timeoutSeconds: z.number().int().min(1).default(30),
    maxResponseBytes: z.number().int().min(1024).default(16384),
    rateLimitPerMinute: z.number().int().min(1).default(30),
    /** Maximum database connections of the environment's pool. */
    poolSize: z.number().int().min(1).max(50).default(4),
  })
  .refine((limits) => limits.pageSize <= limits.maxRows, {
    message: 'pageSize must not exceed maxRows',
    path: ['pageSize'],
  });

export const environmentSchema = z.strictObject({
  kind: z.literal('hana'),
  label: z.string().min(1).optional(),
  productive: z.boolean().default(false),
  /** Name of the user-provided service that holds the connection credentials. */
  service: z.string().min(1),
  /** Default HANA schema for the environment (the server fixes it, SQL never names it). */
  schema: z.string().min(1),
  catalog: z.string().min(1),
  groups: z.array(z.string().min(1)).min(1),
  limits: limitsSchema.default(() => limitsSchema.parse({})),
});

/** strahana.config.json (non-secret, versioned). */
export const configSchema = z.strictObject({
  $schema: z.string().optional(),
  environments: z
    .record(z.string().min(1), environmentSchema)
    .refine((envs) => Object.keys(envs).length > 0, {
      message: 'at least one environment is required',
    }),
});

export const KEY_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const apiKeyEntrySchema = z.strictObject({
  user: z.string().min(1),
  keyHash: z.string().regex(KEY_HASH_PATTERN, { message: 'must look like sha256:<64 hex chars>' }),
  groups: z.array(z.string().min(1)),
});

/** Credentials of the `strahana-secrets` user-provided service. */
export const secretsSchema = z
  .looseObject({
    signingKey: z.string().min(1),
    apiKeys: z.array(apiKeyEntrySchema).default([]),
  })
  .superRefine((secrets, ctx) => {
    const users = new Set<string>();
    const hashes = new Set<string>();
    secrets.apiKeys.forEach((entry, index) => {
      if (users.has(entry.user)) {
        ctx.addIssue({
          code: 'custom',
          path: ['apiKeys', index, 'user'],
          message: 'only one key per user',
        });
      }
      if (hashes.has(entry.keyHash)) {
        ctx.addIssue({
          code: 'custom',
          path: ['apiKeys', index, 'keyHash'],
          message: 'duplicated key hash',
        });
      }
      users.add(entry.user);
      hashes.add(entry.keyHash);
    });
  });

/** Credentials of a HANA connection service. Extra driver options are tolerated. */
export const hanaCredentialsSchema = z.looseObject({
  host: z.string().min(1),
  port: z.union([z.string().min(1), z.number().int()]),
  user: z.string().min(1),
  password: z.string().min(1),
  encrypt: z.boolean().default(true),
  sslValidateCertificate: z.boolean().default(true),
});

export type StrahanaConfig = z.infer<typeof configSchema>;
export type EnvironmentConfig = z.infer<typeof environmentSchema>;
export type EnvironmentLimits = z.infer<typeof limitsSchema>;
export type SecretsConfig = z.infer<typeof secretsSchema>;
export type ApiKeyEntry = z.infer<typeof apiKeyEntrySchema>;
export type HanaCredentials = z.infer<typeof hanaCredentialsSchema>;

/**
 * Turns a zod failure into a sanitized error. Only paths and zod messages are used: the
 * rejected input values (which may be secrets) are never echoed.
 */
export function configIssue(source: string, error: z.ZodError) {
  const shown = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  const more = error.issues.length > 3 ? ` (+${error.issues.length - 3} more)` : '';
  return errors.configInvalid(`${source} ${shown.join('; ')}${more}`);
}
