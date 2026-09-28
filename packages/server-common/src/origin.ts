/**
 * Origin policy and CORS (issue #24, ERRORS_AND_SECURITY.md §3.2).
 *
 * - `Origin` present and in the allow-list: the request continues, with
 *   `Access-Control-Allow-Origin` for that exact origin; a CORS preflight
 *   (OPTIONS with `Access-Control-Request-Method`) is answered 204 here.
 * - `Origin` present and not allowed (including "null"): 403, no CORS
 *   headers, and the request goes no further (also required by the MCP
 *   Streamable HTTP transport against DNS rebinding).
 * - No `Origin`: not a browser cross-origin call. The request continues as a
 *   server-to-server call (MCP host backends, the platform's health checks);
 *   it still needs authentication wherever the route requires it.
 * CORS is not authentication: an allowed origin grants no access by itself,
 * and no credentialed CORS is offered (tokens travel in Authorization).
 */
import type { RequestHandler } from 'express';
import { transportError } from './errors';
import { sendError } from './http';

export interface OriginPolicyOptions {
  /** Exact origins, for example `https://app.example.com` (scheme, host, optional port; no path). */
  readonly allowedOrigins: readonly string[];
  /** Methods announced to preflights, for example `['GET', 'POST', 'DELETE']`. */
  readonly allowedMethods: readonly string[];
  /** Request headers announced to preflights, for example `['authorization', 'content-type']`. */
  readonly allowedHeaders: readonly string[];
  /** Response headers readable by the browser, for example `['www-authenticate', 'x-correlation-id']`. */
  readonly exposedHeaders?: readonly string[];
  /** Preflight cache lifetime. Default 600 seconds. */
  readonly maxAgeSeconds?: number;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function checkOrigin(origin: string): string {
  const url = URL.canParse(origin) ? new URL(origin) : undefined;
  const secure =
    url !== undefined &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)));
  if (url === undefined || !secure || url.origin !== origin) {
    throw new TypeError(
      'allowedOrigins must hold exact https origins (http only on a loopback host), without path or trailing slash.',
    );
  }
  return origin;
}

function tokenList(values: readonly string[], name: string): string {
  if (values.some((value) => !TOKEN.test(value))) {
    throw new TypeError(`${name} must hold HTTP tokens.`);
  }
  return values.join(', ');
}

export function originPolicy(options: OriginPolicyOptions): RequestHandler {
  const allowed: ReadonlySet<string> = new Set(options.allowedOrigins.map(checkOrigin));
  const methods = tokenList(options.allowedMethods, 'allowedMethods');
  const headers = tokenList(options.allowedHeaders, 'allowedHeaders');
  const exposed =
    options.exposedHeaders === undefined || options.exposedHeaders.length === 0
      ? undefined
      : tokenList(options.exposedHeaders, 'exposedHeaders');
  const maxAge = options.maxAgeSeconds ?? 600;
  if (!Number.isSafeInteger(maxAge) || maxAge < 0) {
    throw new RangeError('maxAgeSeconds must be a non-negative integer.');
  }

  return (req, res, next) => {
    res.appendHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin === undefined) {
      next();
      return;
    }
    if (!allowed.has(origin)) {
      sendError(res, transportError('FORBIDDEN_ORIGIN'));
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method'] !== undefined) {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Methods', methods);
      res.setHeader('Access-Control-Allow-Headers', headers);
      res.setHeader('Access-Control-Max-Age', String(maxAge));
      res.setHeader('Content-Length', '0');
      res.end();
      return;
    }
    if (exposed !== undefined) {
      res.setHeader('Access-Control-Expose-Headers', exposed);
    }
    next();
  };
}
