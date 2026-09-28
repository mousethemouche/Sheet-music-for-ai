/**
 * Request protection of `/mcp` (ERRORS_AND_SECURITY.md §3, issues #19 and
 * #24), mounted in the app's `protection` slot so that it runs for every
 * HTTP method, before the POST route and the 405 fallback:
 *
 * 1. correlation: a server-generated ID for logs and error envelopes;
 * 2. Origin policy: a request carrying an `Origin` outside `allowedOrigins`
 *    (by default: any `Origin`) is 403, as the MCP Streamable HTTP transport
 *    requires against DNS rebinding; a preflight from an allowed origin is
 *    answered 204; MCP host backends send no `Origin` and go on;
 * 3. body cap: a declared body over the limit is 413, a body without a
 *    declared length is 411, both before the transport reads anything.
 *
 * The per-IP rate limit joins this chain, and authentication plus the
 * per-owner limit the POST-only `middleware` slot, when the Postgres store and
 * the verifier are wired (#16, #26).
 */
import { PAYLOAD_LIMITS } from '@sheet-music/music-contracts';
import { bodySizeLimit, correlationMiddleware, originPolicy } from '@sheet-music/server-common';
import type { RequestHandler } from 'express';

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
