/**
 * Vercel Function adapter of apps/api (docs/deploy/VERCEL.md, issue #16).
 * `vite build` bundles it into dist/serverless.js; api/index.js, the file
 * Vercel turns into the function, re-exports it. The leading underscore keeps
 * Vercel from treating this source file as a function of its own.
 *
 * Module evaluation composes the app ONCE per function instance (Fluid
 * compute reuses an instance for many requests): the same configuration
 * validation and Postgres composition as main.ts (`loadApiConfig` ->
 * `bootstrapApi`), without `listen`. The Postgres pool opens connections
 * lazily and lives as long as the instance. The default export is the
 * Express instance under Nest: Vercel serves it as a Node request handler
 * and, because it is an Express app, adds no request helpers, so requests
 * reach the app exactly as they do locally.
 *
 * `trust proxy`: Vercel's edge is the one proxy in front of the function and
 * overwrites X-Forwarded-For with the client address, so with one trusted
 * hop `req.ip` (the per-IP rate-limit subject) is the client address.
 *
 * A configuration or startup problem logs `api.config_invalid` /
 * `api.start_failed` as main.ts does (variable names, never values) and fails
 * the module evaluation: the platform answers 500 and tries again on the next
 * cold start, and no request reaches a half-built app.
 */
import 'reflect-metadata';
import { createLogger } from '@sheet-music/server-common';
import type { Express } from 'express';
import { bootstrapApi } from '../src/composition';
import { ApiConfigError, loadApiConfig } from '../src/config';

/** Proxy hops in front of a Vercel Function: the Vercel edge only. */
export const VERCEL_PROXY_HOPS = 1;

const logger = createLogger();

async function createHandler(): Promise<Express> {
  try {
    const app = await bootstrapApi(loadApiConfig(process.env), logger);
    app.set('trust proxy', VERCEL_PROXY_HOPS);
    logger.info('api.started', { runtime: 'vercel-function' });
    return app.getHttpAdapter().getInstance();
  } catch (error) {
    if (error instanceof ApiConfigError) {
      logger.error('api.config_invalid', { problems: error.problems });
    } else {
      logger.error('api.start_failed', { error });
    }
    // Rethrown as is: a configuration error names variables only, and the
    // other startup errors carry no configuration value.
    throw error;
  }
}

export default await createHandler();
