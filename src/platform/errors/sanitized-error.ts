/**
 * Error codes shared with ssff-mcp (POV 4.4). The last four are platform-level additions.
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'ENV_REQUIRED',
  'ENV_FORBIDDEN',
  'RATE_LIMITED',
  'QUESTION_IS_SQL',
  'CONTEXT_INVALID',
  'SQL_PARSE',
  'SQL_NOT_SELECT',
  'SQL_ENTITY_NOT_IN_CONTEXT',
  'SQL_ENTITY_UNAVAILABLE',
  'SQL_UNKNOWN_COLUMN',
  'SQL_AMBIGUOUS_COLUMN',
  'SQL_FORBIDDEN',
  'DB_TIMEOUT',
  'DB_ERROR',
  'NOT_IMPLEMENTED',
  'INPUT_INVALID',
  'CONFIG_INVALID',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SanitizedErrorShape {
  code: ErrorCode;
  message: string;
}

const MAX_MESSAGE_LENGTH = 300;

function toOneLine(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim();
  return line.length > MAX_MESSAGE_LENGTH ? `${line.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : line;
}

/**
 * The only error shape allowed to reach a client: a code and a one-line message that already
 * carries the cause and the fix. Callers must never put credentials, hosts or row values in it.
 */
export class SanitizedError extends Error implements SanitizedErrorShape {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(toOneLine(message));
    this.name = 'SanitizedError';
    this.code = code;
  }

  toJSON(): SanitizedErrorShape {
    return { code: this.code, message: this.message };
  }
}

export const errors = {
  authRequired: () => new SanitizedError('AUTH_REQUIRED', 'Missing or invalid API key.'),
  envRequired: (available: readonly string[]) =>
    new SanitizedError('ENV_REQUIRED', `environment required: ${available.join(', ')}`),
  envForbidden: (environment: string) =>
    new SanitizedError('ENV_FORBIDDEN', `No access to environment ${environment}.`),
  noEnvironmentAccess: () =>
    new SanitizedError('ENV_FORBIDDEN', 'No access to any environment. Ask an administrator.'),
  rateLimited: (retryAfterSeconds: number) =>
    new SanitizedError('RATE_LIMITED', `Too many requests. Retry in ${retryAfterSeconds}s.`),
  questionIsSql: () =>
    new SanitizedError(
      'QUESTION_IS_SQL',
      'hana_context expects a natural-language question, not SQL.',
    ),
  contextInvalid: () =>
    new SanitizedError(
      'CONTEXT_INVALID',
      'context_id expired or invalid. Call hana_context again.',
    ),
  dbTimeout: (seconds: number) =>
    new SanitizedError(
      'DB_TIMEOUT',
      `Query exceeded ${seconds}s. Narrow the filters or aggregate.`,
    ),
  dbError: (detail: string) => new SanitizedError('DB_ERROR', detail),
  invalidInput: (detail: string) => new SanitizedError('INPUT_INVALID', detail),
  notImplemented: (tool: string, phase: number) =>
    new SanitizedError(
      'NOT_IMPLEMENTED',
      `${tool} is not available yet (planned for phase ${phase}).`,
    ),
  configInvalid: (detail: string) =>
    new SanitizedError('CONFIG_INVALID', `Invalid configuration: ${detail}`),
  internal: () =>
    new SanitizedError(
      'INTERNAL_ERROR',
      'Internal error. Retry later or contact an administrator.',
    ),
};

export function toSanitizedError(error: unknown): SanitizedError {
  return error instanceof SanitizedError ? error : errors.internal();
}

export function formatForClient(error: SanitizedErrorShape): string {
  return `${error.code}: ${error.message}`;
}
