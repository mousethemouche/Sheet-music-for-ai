/**
 * Production composition of the MCP HTTP app (MCP_SERVER.md §2, §7). The
 * process entry point (main.ts) and the integration suites build the app
 * with this one function, so tests run exactly the production chain:
 *
 *   GET <metadata path>            RFC 9728 document, public (#26)
 *   /assets/*                      static View assets, public (static-assets.ts)
 *   every method on /mcp           correlation -> Origin -> body cap ->
 *                                  per-IP limit -> bearer guard -> per-owner limit
 *   POST /mcp                      stateless MCP transport, one server per request
 *   any other method on /mcp       405
 *
 * Tools receive the principal from the verified token only (never from their
 * arguments) and run the shared use cases over the given stores.
 */
import type { Clock, IdGenerator } from '@sheet-music/music-application';
import type { Logger, RateLimitStore } from '@sheet-music/server-common';
import type { Express, RequestHandler } from 'express';
import { createMcpHttpApp } from './app';
import { createMcpAuth, mcpBearerGuard, protectedResourceMetadataHandler } from './auth';
import type { McpAppConfig } from './config';
import { principalFromAuthInfo } from './principal';
import {
  DEFAULT_MCP_RATE_LIMITS,
  type McpRateLimitRules,
  mcpRequestProtection,
  perIpRateLimit,
  perOwnerRateLimit,
} from './protection';
import { createMcpServer } from './server';
import { type ScoreStores, createMcpUseCases, systemClock } from './use-cases';
import { prepareScoreView } from './view-resource';

/** Score stores plus the shared rate-limit store (PostgresPersistence satisfies it). */
export interface McpStores extends ScoreStores {
  readonly rateLimits: RateLimitStore;
}

export interface McpAppDependencies {
  readonly config: McpAppConfig;
  readonly stores: McpStores;
  /** Content of the built single-file View (the `ui://` resource). */
  readonly viewHtml: string;
  readonly logger: Logger;
  /** The View's static-assets router (`createViewAssetsRouter`); absent: no asset route. */
  readonly assets?: RequestHandler;
  /** Time of the use cases and of the rate-limit windows (never of token checks). Default: system. */
  readonly clock?: Clock;
  /** Score ID generator. Default: `scr_` + random UUID. */
  readonly ids?: IdGenerator;
  /** Default DEFAULT_MCP_RATE_LIMITS. */
  readonly rateLimits?: McpRateLimitRules;
}

export interface McpApp {
  readonly app: Express;
  /** Canonical MCP resource URI (MCP_PUBLIC_URL). */
  readonly resource: string;
  /** Public URL of the protected resource metadata. */
  readonly metadataUrl: string;
}

export function createMcpApp(deps: McpAppDependencies): McpApp {
  const { config, logger } = deps;
  const clock = deps.clock ?? systemClock;
  const auth = createMcpAuth(
    {
      resource: config.publicUrl,
      supabaseUrl: config.supabaseUrl,
      audienceMode: config.audienceMode,
    },
    logger,
  );
  const limits = {
    store: deps.stores.rateLimits,
    rules: deps.rateLimits ?? DEFAULT_MCP_RATE_LIMITS,
    logger,
    clock,
  };
  // The View loads its playback assets from this server (/assets), so the
  // resource CSP allows this server's own public origin. Prepared here, once:
  // a View build without the asset-origin placeholder fails the startup.
  const view = prepareScoreView({
    viewHtml: deps.viewHtml,
    assetOrigin: new URL(config.publicUrl).origin,
  });
  const useCases = createMcpUseCases(deps.stores, {
    clock,
    ...(deps.ids === undefined ? {} : { ids: deps.ids }),
  });
  const app = createMcpHttpApp({
    metadata: {
      path: new URL(auth.metadataUrl).pathname,
      handler: protectedResourceMetadataHandler(auth.metadata),
    },
    ...(deps.assets === undefined ? {} : { assets: deps.assets }),
    protection: [
      ...mcpRequestProtection({ allowedOrigins: config.allowedOrigins }),
      perIpRateLimit(limits),
      mcpBearerGuard(auth, logger),
      perOwnerRateLimit(limits),
    ],
    createServer: () =>
      createMcpServer({
        useCases,
        resolvePrincipal: principalFromAuthInfo,
        logger,
        view,
      }),
    trustProxyHops: config.trustProxyHops,
    logger,
  });
  return { app, resource: config.publicUrl, metadataUrl: auth.metadataUrl };
}
