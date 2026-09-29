/**
 * Request protection of `/mcp` (ERRORS_AND_SECURITY.md §3, issues #19 and
 * #24), mounted in the app's `protection` slot so that it runs for every
 * HTTP method, before the POST route and the 405 fallback. Order:
 *
 * 1. correlation: a server-generated ID for logs and error envelopes;
 * 2. Origin policy: a request carrying an `Origin` outside `allowedOrigins`
 *    (by default: any `Origin`) is 403, as the MCP Streamable HTTP transport
 *    requires against DNS rebinding; a preflight from an allowed origin is
 *    answered 204; MCP host backends send no `Origin` and go on;
 * 3. body cap: a declared body over the limit is 413, a body without a
 *    declared length is 411, both before the transport reads anything;
 * 4. per-IP rate limit (`perIpRateLimit`), before token verification;
 * 5. bearer authentication (auth.ts), then the per-owner rate limit
 *    (`perOwnerRateLimit`).
 *
 * Both limits count in the shared Postgres store, so they hold across
 * instances; over the limit is 429 and the request goes no further.
 */
import type { Clock } from '@sheet-music/music-application';
import { PAYLOAD_LIMITS } from '@sheet-music/music-contracts';
import {
  type Logger,
  type RateLimitRule,
  type RateLimitStore,
  bodySizeLimit,
  clientAddress,
  correlationMiddleware,
  originPolicy,
  rateLimit,
} from '@sheet-music/server-common';
import type { RequestHandler } from 'express';
import { authInfoOf } from './auth';
import { principalFromAuthInfo } from './principal';

export interface McpRequestProtectionOptions {
  /**
   * Exact browser origins allowed to call `/mcp` cross-origin (https, or http
   * on a loopback host). Default: none.
   */
  readonly allowedOrigins?: readonly string[];
  /** Largest accepted request body in bytes. Default PAYLOAD_LIMITS.requestBodyBytes. */
  readonly maxRequestBodyBytes?: number;
}

export function mcpRequestProtection(options: McpRequestProtectionOptions = {}): RequestHandler[] {
  return [
    correlationMiddleware(),
    originPolicy({
      allowedOrigins: options.allowedOrigins ?? [],
      allowedMethods: ['POST'],
      allowedHeaders: ['authorization', 'content-type', 'accept', 'mcp-protocol-version'],
      exposedHeaders: ['www-authenticate', 'x-correlation-id'],
    }),
    bodySizeLimit({ maxBytes: options.maxRequestBodyBytes ?? PAYLOAD_LIMITS.requestBodyBytes }),
  ];
}

export interface McpRateLimitRules {
  /** Every request to `/mcp` from one client address, authenticated or not. */
  readonly perIp: RateLimitRule;
  /** Every authenticated request of one user. */
  readonly perOwner: RateLimitRule;
}

/**
 * Production limits, per minute. MCP host backends call from a few shared
 * addresses on behalf of many users, so the per-IP rule is only a flood
 * bound in front of token verification; the per-owner rule bounds one user.
 * Tune against real use (ERRORS_AND_SECURITY.md §3.3).
 */
export const DEFAULT_MCP_RATE_LIMITS: McpRateLimitRules = Object.freeze({
  perIp: Object.freeze({ name: 'mcp-ip', limit: 600, windowMs: 60_000 }),
  perOwner: Object.freeze({ name: 'mcp-owner', limit: 120, windowMs: 60_000 }),
});

export interface McpRateLimitOptions {
  readonly store: RateLimitStore;
  readonly rules: McpRateLimitRules;
  readonly logger: Logger;
  readonly clock: Clock;
}

export function perIpRateLimit(options: McpRateLimitOptions): RequestHandler {
  return rateLimit({
    store: options.store,
    rule: options.rules.perIp,
    subject: (req) => clientAddress(req),
    logger: options.logger,
    now: () => options.clock.now(),
  });
}

/** Mounted after the bearer guard: the subject is the verified user ID. */
export function perOwnerRateLimit(options: McpRateLimitOptions): RequestHandler {
  return rateLimit({
    store: options.store,
    rule: options.rules.perOwner,
    subject: (req) => principalFromAuthInfo(authInfoOf(req))?.userId,
    logger: options.logger,
    now: () => options.clock.now(),
  });
}
