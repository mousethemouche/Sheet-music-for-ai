/**
 * OAuth protection of the MCP resource (issue #26, AUTH_MCP_OAUTH.md §4-§6):
 * the token verifier for the configured audience mode, the public RFC 9728
 * metadata document, and the bearer guard that runs for every method of
 * `/mcp` before any MCP processing.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { applicationError } from '@sheet-music/music-application';
import {
  type AccessTokenVerifier,
  type ProtectedResourceMetadata,
  createAccessTokenVerifier,
  createRemoteJwks,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  readBearerToken,
  rejectionResponse,
  supabaseAuthEndpoints,
} from '@sheet-music/auth-jwt';
import { type Logger, sendError } from '@sheet-music/server-common';
import type { Request, RequestHandler } from 'express';
import type { AudienceMode } from './config';

/** `aud` of every Supabase user token; the interim mode's only accepted audience. */
const SUPABASE_USER_AUDIENCE = 'authenticated';

const RESOURCE_NAME = 'Sheet Music for AI';

export interface McpAuthConfig {
  /** Canonical MCP resource URI (the configured MCP_PUBLIC_URL). */
  readonly resource: string;
  readonly supabaseUrl: string;
  readonly audienceMode: AudienceMode;
}

export interface McpAuth {
  readonly verifier: AccessTokenVerifier;
  /** Where the metadata document is published, and its content. */
  readonly metadataUrl: string;
  readonly metadata: ProtectedResourceMetadata;
}

/**
 * The verifier of AUTH_MCP_OAUTH.md §4: exact Supabase issuer, keys from the
 * project JWKS (bounded remote cache), OAuth client binding (`client_id`
 * required, so a first-party web session token is refused), and the audience
 * of `audienceMode`. Tokens are verified with the system clock.
 */
export function createMcpAuth(config: McpAuthConfig, logger: Logger): McpAuth {
  const { issuer, jwksUrl } = supabaseAuthEndpoints(config.supabaseUrl);
  if (config.audienceMode === 'interim-authenticated') {
    logger.warn('auth.interim_audience_mode', {
      message:
        'MCP_AUTH_AUDIENCE_MODE=interim-authenticated: tokens are not bound to this resource. This violates the MCP audience requirement and needs the owner sign-off of AUTH_MCP_OAUTH.md §4.',
    });
  }
  return {
    verifier: createAccessTokenVerifier({
      issuer,
      audiences: [config.audienceMode === 'resource' ? config.resource : SUPABASE_USER_AUDIENCE],
      client: { kind: 'oauth' },
      keys: createRemoteJwks(jwksUrl),
    }),
    metadataUrl: protectedResourceMetadataUrl(config.resource),
    metadata: protectedResourceMetadata({
      resource: config.resource,
      authorizationServers: [issuer],
      resourceName: RESOURCE_NAME,
    }),
  };
}

/**
 * `GET <metadata path>`: public, no authentication. The document holds no
 * secret, so any origin may read it (browser-based MCP clients discover it
 * cross-origin).
 */
export function protectedResourceMetadataHandler(
  metadata: ProtectedResourceMetadata,
): RequestHandler {
  const body = JSON.stringify(metadata);
  return (_req, res) => {
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(body);
  };
}

type AuthenticatedRequest = Request & { auth?: AuthInfo };

/** The SDK `AuthInfo` a request carries once the guard has verified its token. */
export function authInfoOf(req: Request): AuthInfo | undefined {
  return (req as AuthenticatedRequest).auth;
}

/**
 * Bearer guard for every method of `/mcp` (AUTH_MCP_OAUTH.md §2, §6):
 * the token is read from the Authorization header only and checked by the
 * production verifier.
 * - Missing or refused: 401 with the `WWW-Authenticate` challenge
 *   (`resource_metadata`; generic `invalid_token` for any token problem) and
 *   an UNAUTHENTICATED envelope. The reason is logged, never sent.
 * - Key source down: 503 DEPENDENCY_UNAVAILABLE without challenge, so hosts
 *   do not start a re-authorization loop.
 * - Accepted: `req.auth` carries the verified subject in `extra.userId`,
 *   which the transport hands to the tool handlers as `extra.authInfo`
 *   (`principalFromAuthInfo`). Only the subject is passed on: the token and
 *   its client are checked here and never handed to handlers or forwarded.
 */
export function mcpBearerGuard(auth: McpAuth, logger: Logger): RequestHandler {
  return async (req, res, next) => {
    const bearer = readBearerToken(req.headers.authorization);
    const verification = bearer.ok ? await auth.verifier.verify(bearer.token) : bearer;
    if (verification.ok) {
      const authInfo: AuthInfo = {
        token: '',
        clientId: '',
        scopes: [],
        extra: { userId: verification.principal.userId },
      };
      (req as AuthenticatedRequest).auth = authInfo;
      next();
      return;
    }
    const { reason } = verification;
    const rejection = rejectionResponse(reason, { resourceMetadataUrl: auth.metadataUrl });
    if (rejection.status === 503) {
      logger.error('auth.keys_unavailable', { reason });
      sendError(
        res,
        applicationError(
          'DEPENDENCY_UNAVAILABLE',
          [],
          'Token verification is temporarily unavailable. Retry later.',
        ),
      );
      return;
    }
    logger.info('auth.rejected', { reason, method: req.method });
    sendError(res, applicationError('UNAUTHENTICATED'), {
      'WWW-Authenticate': rejection.wwwAuthenticate,
    });
  };
}
