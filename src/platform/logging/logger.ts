import { systemClock, type Clock } from '../clock.js';

/** Only these keys can ever be written. Anything else is dropped at runtime. */
export const LOG_FIELDS = [
  'event',
  'tool',
  'user',
  'env',
  'sqlHash',
  'questionHash',
  'entities',
  'rows',
  'durationMs',
  'outcome',
  'bytes',
  'code',
  'transport',
  'port',
] as const;

export type LogField = (typeof LOG_FIELDS)[number];
export type LogFields = Partial<Record<LogField, string | number | boolean>>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuditEntry {
  user: string;
  env: string;
  sqlHash: string;
  rows: number;
  durationMs: number;
  outcome: string;
  bytes: number;
}

/** Port: where audit records go. The MVP adapter is the stderr logger. */
export interface AuditSink {
  audit(entry: AuditEntry): void;
}

export interface Logger extends AuditSink {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Receives one complete JSON line (with trailing newline). Defaults to stderr. */
  write?: (line: string) => void;
  clock?: Clock;
}

const MAX_VALUE_LENGTH = 200;
const allowed: ReadonlySet<string> = new Set(LOG_FIELDS);

function oneLine(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > MAX_VALUE_LENGTH ? `${line.slice(0, MAX_VALUE_LENGTH - 1)}…` : line;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => void process.stderr.write(line));
  const clock = options.clock ?? systemClock;

  const emit = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    const record: Record<string, string | number | boolean> = {
      ts: clock.now().toISOString(),
      level,
      msg: oneLine(msg),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.has(key)) continue;
      if (typeof value === 'string') record[key] = oneLine(value);
      else if (typeof value === 'number' || typeof value === 'boolean') record[key] = value;
    }
    write(`${JSON.stringify(record)}\n`);
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    audit: (entry) => emit('info', 'query audit', { event: 'audit', ...entry }),
  };
}
