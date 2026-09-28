/**
 * Structured JSON logger (issue #19, ERRORS_AND_SECURITY.md §2).
 *
 * One JSON object per line: `time`, `level`, `event`, `correlationId` and
 * `clientCorrelationId` (from the request context) and the redacted fields. JSON encoding keeps a field
 * value inside its line, so a newline in user text cannot forge log entries.
 * Logging never throws: a field that cannot be serialized, or a failing
 * output, degrades to a minimal line or to nothing, and the request goes on.
 */
import { currentRequestContext } from './context';
import { redact } from './redact';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Receives each line (without newline). Default: process.stdout. */
  readonly write?: (line: string) => void;
  /** Lowest level written. Default `info`. */
  readonly level?: LogLevel;
  /** Omits stack traces. Default: NODE_ENV === 'production'. */
  readonly production?: boolean;
  readonly now?: () => Date;
}

const RESERVED = new Set(['time', 'level', 'event', 'correlationId', 'clientCorrelationId']);
const EVENT = /^[A-Za-z0-9_.:-]{1,64}$/;

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? defaultWrite;
  const threshold = LOG_LEVELS.indexOf(options.level ?? 'info');
  const production = options.production ?? process.env['NODE_ENV'] === 'production';
  const now = options.now ?? (() => new Date());

  function line(level: LogLevel, event: string, fields: LogFields): string {
    // Null prototype: a redacted field named "__proto__" stays a plain key.
    const entry = Object.create(null) as Record<string, unknown>;
    entry['time'] = now().toISOString();
    entry['level'] = level;
    entry['event'] = EVENT.test(event) ? event : 'invalid_event_name';
    const context = currentRequestContext();
    if (context !== undefined) {
      entry['correlationId'] = context.correlationId;
      if (context.clientCorrelationId !== undefined) {
        entry['clientCorrelationId'] = context.clientCorrelationId;
      }
    }
    const redacted = redact(fields, { production }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(redacted)) {
      if (!RESERVED.has(key)) {
        entry[key] = value;
      }
    }
    return JSON.stringify(entry);
  }

  function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (LOG_LEVELS.indexOf(level) < threshold) {
      return;
    }
    let text: string;
    try {
      text = line(level, event, fields);
    } catch {
      text = JSON.stringify({ time: new Date().toISOString(), level, event: 'log.unserializable' });
    }
    try {
      write(text);
    } catch {
      // The log output failed; the request must not fail because of it.
    }
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
