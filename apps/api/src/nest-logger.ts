/**
 * Routes Nest's own log calls (bootstrap, route mapping, framework errors)
 * through the structured, redacting logger of server-common (issue #19), so
 * the process writes one JSON format only. Framework chatter (`log`,
 * `verbose`) is debug; warnings and errors keep their level.
 */
import type { LoggerService } from '@nestjs/common';
import type { LogLevel, Logger } from '@sheet-music/server-common';

export function nestLogger(logger: Logger): LoggerService {
  const write =
    (level: LogLevel) =>
    (message: unknown, ...context: unknown[]): void =>
      logger[level]('nest.log', context.length === 0 ? { message } : { message, context });
  return {
    log: write('debug'),
    verbose: write('debug'),
    debug: write('debug'),
    warn: write('warn'),
    error: write('error'),
    fatal: write('error'),
  };
}
