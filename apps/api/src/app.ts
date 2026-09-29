/**
 * Bootstrap of the HTTP API (issue #21): builds and initializes the Nest
 * application WITHOUT listening, so the same function serves `main.ts`
 * (which listens), the integration tests (which listen on a loopback port)
 * and a serverless handler (#16), which can pass
 * `app.getHttpAdapter().getInstance()` (the Express app) to the platform.
 *
 * Everything that decides a request is production code here: request
 * protection, the session-token verifier built from the Supabase project
 * URL, the auth and per-owner rate-limit guards, the contract pipes, the
 * exception filter and the shared use cases. Callers choose only the stores,
 * the logger and the limits.
 */
import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import {
  GetSavedScore,
  type SavedScoreRepository,
  SearchScores,
} from '@sheet-music/music-application';
import { type Logger, type RateLimitStore, createLogger } from '@sheet-music/server-common';
import express from 'express';
import { ApiModule } from './app.module';
import { SessionAuthGuard, createSessionVerifier } from './auth';
import { ApiExceptionFilter } from './errors';
import { nestLogger } from './nest-logger';
import {
  type ApiRateLimitOptions,
  OwnerRateLimitGuard,
  PRIVATE_PREFIX,
  apiRequestProtection,
  ipRateLimit,
} from './protection';

/** The stores the API reads: saved scores (never drafts) and the shared rate-limit counters. */
export interface ApiStores {
  readonly saved: SavedScoreRepository;
  readonly rateLimits: RateLimitStore;
}

export interface ApiAppOptions {
  /** Supabase project URL (`https://<ref>.supabase.co`): issuer and JWKS derive from it. */
  readonly supabaseUrl: string;
  readonly stores: ApiStores;
  /** Exact browser origins allowed to call the API (the web app). Default: none. */
  readonly allowedOrigins?: readonly string[];
  /** Default: the JSON logger of server-common on stdout. */
  readonly logger?: Logger;
  readonly rateLimits?: ApiRateLimitOptions;
  /** Express `trust proxy`: the proxy hops in front of the app (Vercel, #16). Default: none. */
  readonly trustProxy?: boolean | number;
  /** Called once when the app closes, after it stopped serving (for example to end the pool). */
  readonly onClose?: () => Promise<void>;
}

export async function createApiApp(options: ApiAppOptions): Promise<NestExpressApplication> {
  const logger = options.logger ?? createLogger();
  const verifier = createSessionVerifier(options.supabaseUrl);

  const server = express();
  server.disable('x-powered-by');
  // Private answers are never revalidated by ETag: every read is a full, uncached answer.
  server.set('etag', false);
  if (options.trustProxy !== undefined) {
    server.set('trust proxy', options.trustProxy);
  }
  server.use(...apiRequestProtection(options.allowedOrigins ?? []));
  server.use(PRIVATE_PREFIX, ipRateLimit(options.stores.rateLimits, logger, options.rateLimits));

  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.register({
      useCases: {
        searchScores: new SearchScores({ saved: options.stores.saved }),
        getSavedScore: new GetSavedScore({ saved: options.stores.saved }),
      },
      logger,
      onClose: options.onClose ?? (() => Promise.resolve()),
    }),
    new ExpressAdapter(server),
    // No body parser: the API has no request body to read. Errors surface to the caller.
    { bodyParser: false, abortOnError: false, logger: nestLogger(logger) },
  );
  app.useGlobalFilters(new ApiExceptionFilter(logger));
  app.useGlobalGuards(
    new SessionAuthGuard(verifier, app.get(Reflector), logger),
    new OwnerRateLimitGuard(options.stores.rateLimits, logger, options.rateLimits),
  );
  await app.init();
  return app;
}
