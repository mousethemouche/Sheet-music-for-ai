/**
 * Process entry of the HTTP API: configuration from the environment
 * (config.ts), Postgres composition (composition.ts), then listen on PORT.
 * Any startup failure is logged without secrets (redacted JSON line; config
 * problems name variables, never values) and exits with code 1.
 *
 * Graceful shutdown on SIGTERM/SIGINT, like the MCP server: `api.stopping`,
 * then `app.close()` stops accepting connections, lets in-flight requests
 * finish (connections still open after SHUTDOWN_GRACE_MS are closed) and
 * runs the shutdown hook that ends the Postgres pool; `api.stopped` is
 * logged once the pool is closed and the process exits with code 0. The
 * signal is handled here rather than by Nest's `enableShutdownHooks`, which
 * re-raises it after closing, so the process would end "killed by signal"
 * (exit 143) without a trace of the pool being closed.
 */
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLogger } from '@sheet-music/server-common';
import { bootstrapApi } from './composition';
import { ApiConfigError, loadApiConfig } from './config';

/** In-flight requests get this long after a stop signal before their connections are closed. */
const SHUTDOWN_GRACE_MS = 10_000;

const logger = createLogger();
let app: NestExpressApplication | undefined;

function stopOnSignals(running: NestExpressApplication): void {
  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info('api.stopping', { signal });
    const server = running.getHttpServer();
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
    running.close().then(
      () => {
        logger.info('api.stopped');
        process.exitCode = 0;
      },
      (error: unknown) => {
        logger.error('api.stop_failed', { error });
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

try {
  const config = loadApiConfig(process.env);
  app = await bootstrapApi(config, logger);
  await app.listen(config.port);
  stopOnSignals(app);
  logger.info('api.started', { port: config.port });
} catch (error) {
  if (error instanceof ApiConfigError) {
    logger.error('api.config_invalid', { problems: error.problems });
  } else {
    logger.error('api.start_failed', { error });
  }
  await app?.close().catch(() => undefined);
  process.exitCode = 1;
}
