/**
 * Process entry point of the MCP server (MCP_SERVER.md §7): reads and
 * validates the environment (config.ts), opens the Postgres pool, composes
 * the production app (composition.ts), listens on PORT, and shuts down
 * gracefully on SIGTERM/SIGINT (stop accepting, finish in-flight requests,
 * then close the pool). A configuration or startup problem exits with code 1
 * and a log line that names the variable, never its value.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresPersistence } from '@sheet-music/persistence-postgres';
import { type Logger, createLogger } from '@sheet-music/server-common';
import { createMcpApp } from './composition';
import { type McpConfig, McpConfigError, loadMcpConfig } from './config';
import { createViewAssetsRouter } from './static-assets';

/** In-flight requests get this long after a stop signal before their connections are closed. */
const SHUTDOWN_GRACE_MS = 10_000;

/** The built View: dist/view/index.html next to this bundle unless MCP_VIEW_HTML_PATH says otherwise. */
function viewHtmlPath(config: McpConfig): string {
  return config.viewHtmlPath === undefined
    ? fileURLToPath(new URL('../view/index.html', import.meta.url))
    : resolve(config.viewHtmlPath);
}

function start(logger: Logger): void {
  const config = loadMcpConfig(process.env);
  const viewPath = viewHtmlPath(config);
  // Both fail fast when the View was not built; createMcpApp then refuses a
  // document without the asset-origin placeholder (a foreign or stale build).
  const viewHtml = readFileSync(viewPath, 'utf8');
  const assets = createViewAssetsRouter(join(dirname(viewPath), 'assets'));
  const persistence = createPostgresPersistence({
    connectionString: config.databaseUrl,
    onIdleError: (error) => logger.warn('db.idle_connection_error', { error }),
  });
  const { app, resource, metadataUrl } = createMcpApp({
    config,
    stores: persistence,
    viewHtml,
    assets,
    logger,
  });

  const server = app.listen(config.port, () => {
    logger.info('server.started', {
      port: config.port,
      resource,
      metadataUrl,
      audienceMode: config.audienceMode,
    });
  });
  server.on('error', (error) => {
    logger.error('server.failed', { error });
    void persistence.close();
    process.exitCode = 1;
  });

  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info('server.stopping', { signal });
    server.close((error) => {
      void persistence.close().then(
        () => {
          logger.info('server.stopped');
          process.exitCode = error === undefined ? 0 : 1;
        },
        (closeError: unknown) => {
          logger.error('server.stop_failed', { error: closeError });
          process.exitCode = 1;
        },
      );
    });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

const logger = createLogger();
try {
  start(logger);
} catch (error) {
  if (error instanceof McpConfigError) {
    logger.error('config.invalid', { problems: error.problems });
  } else {
    logger.error('server.start_failed', { error });
  }
  process.exitCode = 1;
}
