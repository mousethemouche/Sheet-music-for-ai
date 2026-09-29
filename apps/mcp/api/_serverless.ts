/**
 * Vercel Function adapter of the MCP server (docs/deploy/VERCEL.md, issue
 * #16). `vite build` bundles it into dist/server/serverless.js next to
 * main.js; api/index.js, the file Vercel turns into the function, re-exports
 * it. The leading underscore keeps Vercel from treating this source file as
 * a function of its own.
 *
 * Module evaluation composes the app ONCE per function instance (Fluid
 * compute reuses an instance for many requests), with the same steps as
 * main.ts minus `listen` and the signal handling: validated configuration,
 * the built View (its assets directory next to it), one Postgres pool opened
 * lazily, then `createMcpApp`. `trust proxy`: Vercel's edge is the one proxy
 * and overwrites X-Forwarded-For with the client address, so an unset
 * MCP_TRUST_PROXY_HOPS means 1 here (VERCEL_PROXY_HOPS, as the API adapter)
 * instead of main.ts's 0: `req.ip`, the per-IP rate-limit subject, is the
 * client, not the edge that all callers would share. An explicit value wins.
 *
 * The default export is the Express app: Vercel serves it as a Node request
 * handler and, because it is an Express app, adds no request helpers, so the
 * JSON-RPC body stream reaches the app's own parser and body cap untouched.
 * The View's /assets are served by Vercel's CDN from the static output
 * (vercel.json) with the headers of static-assets.ts; the router mounted here
 * answers what the CDN does not hold (a plain 404), as it does locally.
 *
 * A configuration or startup problem logs `config.invalid` /
 * `server.start_failed` as main.ts does (variable names, never values) and
 * fails the module evaluation: the platform answers 500 and tries again on
 * the next cold start.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresPersistence, databaseTls } from '@sheet-music/persistence-postgres';
import { createLogger } from '@sheet-music/server-common';
import type { Express } from 'express';
import { createMcpApp } from '../src/composition';
import { type McpConfig, McpConfigError, type McpEnvironment, loadMcpConfig } from '../src/config';
import { createViewAssetsRouter } from '../src/static-assets';

/** Proxy hops in front of a Vercel Function: the Vercel edge only. */
const VERCEL_PROXY_HOPS = 1;

const logger = createLogger();

/** The process environment, with MCP_TRUST_PROXY_HOPS defaulting to the Vercel edge. */
function vercelEnvironment(env: McpEnvironment): McpEnvironment {
  return env['MCP_TRUST_PROXY_HOPS']?.trim()
    ? env
    : { ...env, MCP_TRUST_PROXY_HOPS: String(VERCEL_PROXY_HOPS) };
}

/** The built View: dist/view/index.html next to this bundle unless MCP_VIEW_HTML_PATH says otherwise (as main.ts). */
function viewHtmlPath(config: McpConfig): string {
  return config.viewHtmlPath === undefined
    ? fileURLToPath(new URL('../view/index.html', import.meta.url))
    : resolve(config.viewHtmlPath);
}

function createHandler(): Express {
  try {
    const config = loadMcpConfig(vercelEnvironment(process.env));
    const viewPath = viewHtmlPath(config);
    const viewHtml = readFileSync(viewPath, 'utf8');
    const assets = createViewAssetsRouter(join(dirname(viewPath), 'assets'));
    const persistence = createPostgresPersistence({
      connectionString: config.databaseUrl,
      ...databaseTls(config.databaseCaCert),
      onIdleError: (error) => logger.warn('db.idle_connection_error', { error }),
    });
    const { app, resource, metadataUrl } = createMcpApp({
      config,
      stores: persistence,
      viewHtml,
      assets,
      logger,
    });
    logger.info('server.started', {
      runtime: 'vercel-function',
      resource,
      metadataUrl,
      audienceMode: config.audienceMode,
      trustProxyHops: config.trustProxyHops,
    });
    return app;
  } catch (error) {
    if (error instanceof McpConfigError) {
      logger.error('config.invalid', { problems: error.problems });
    } else {
      logger.error('server.start_failed', { error });
    }
    // Rethrown as is: a configuration error names variables only, and the
    // other startup errors carry no configuration value.
    throw error;
  }
}

export default createHandler();
