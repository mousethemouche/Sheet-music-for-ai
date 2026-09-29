/**
 * Production composition: the API over PostgreSQL (persistence-postgres) for
 * a validated configuration. The pool opens connections lazily, so building
 * the app never waits on the database, and it is ended when the app closes.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPostgresPersistence } from '@sheet-music/persistence-postgres';
import { type Logger, createLogger } from '@sheet-music/server-common';
import { createApiApp } from './app';
import type { ApiConfig } from './config';

export async function bootstrapApi(
  config: ApiConfig,
  logger: Logger = createLogger(),
): Promise<NestExpressApplication> {
  const persistence = createPostgresPersistence({
    connectionString: config.databaseUrl,
    onIdleError: (error) => logger.warn('database.idle_connection_error', { error }),
  });
  if (config.allowedOrigins.length === 0) {
    logger.warn('api.no_allowed_origins', {
      message: 'API_ALLOWED_ORIGINS is empty: browsers cannot call the API cross-origin.',
    });
  }
  try {
    return await createApiApp({
      supabaseUrl: config.supabaseUrl,
      stores: { saved: persistence.saved, rateLimits: persistence.rateLimits },
      allowedOrigins: config.allowedOrigins,
      logger,
      onClose: () => persistence.close(),
    });
  } catch (error) {
    await persistence.close();
    throw error;
  }
}
