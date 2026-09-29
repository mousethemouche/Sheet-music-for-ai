/**
 * Authentication of the saved-library routes (issue #26, AUTH_MCP_OAUTH.md
 * §3.1 and §6.3).
 *
 * - The verifier is auth-jwt's, built from the Supabase project URL exactly
 *   as production does: issuer and JWKS URL from `supabaseAuthEndpoints`,
 *   keys from `createRemoteJwks`, audience `authenticated`, and the `session`
 *   client binding, so a token issued to an OAuth client (the MCP) is refused.
 * - The guard is global and default-deny: every route needs a valid session
 *   token unless it is marked `@Public()` (health, version).
 * - The principal comes from the verified token only (its `sub`); it is kept
 *   per request in a WeakMap and read by `@CurrentPrincipal()`. Nothing in
 *   the query, path or headers other than `Authorization` is identity.
 * - Missing token: 401 `WWW-Authenticate: Bearer`. Any token problem: the
 *   same 401 with the generic `invalid_token` challenge (the reason is only
 *   logged). Key source down: 503 DEPENDENCY_UNAVAILABLE, no challenge.
 */
import {
  type CanActivate,
  type ExecutionContext,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  type AccessTokenVerifier,
  INVALID_TOKEN_DESCRIPTION,
  createAccessTokenVerifier,
  createRemoteJwks,
  readBearerToken,
  supabaseAuthEndpoints,
} from '@sheet-music/auth-jwt';
import { type AuthenticatedPrincipal, applicationError } from '@sheet-music/music-application';
import type { Logger } from '@sheet-music/server-common';
import type { Request, Response } from 'express';
import { ApiFailure } from './errors';

/** `aud` of every Supabase user access token. */
export const SESSION_AUDIENCE = 'authenticated';

/** The session-token verifier of apps/api for a Supabase project URL (`https://<ref>.supabase.co`). */
export function createSessionVerifier(supabaseUrl: string): AccessTokenVerifier {
  const { issuer, jwksUrl } = supabaseAuthEndpoints(supabaseUrl);
  return createAccessTokenVerifier({
    issuer,
    audiences: [SESSION_AUDIENCE],
    client: { kind: 'session' },
    keys: createRemoteJwks(jwksUrl),
  });
}

const PUBLIC_ROUTE = 'sheet-music:public-route';

/** Marks a controller or handler as reachable without a token. */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(PUBLIC_ROUTE, true);

const principals = new WeakMap<Request, AuthenticatedPrincipal>();

/** The verified principal of this request, if the auth guard accepted a token. */
export function principalOf(req: Request): AuthenticatedPrincipal | undefined {
  return principals.get(req);
}

/** Handler parameter: the verified principal, or null (the use case then answers UNAUTHENTICATED). */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal | null =>
    principalOf(context.switchToHttp().getRequest<Request>()) ?? null,
);

export const MISSING_TOKEN_CHALLENGE = 'Bearer';
export const INVALID_TOKEN_CHALLENGE = `Bearer error="invalid_token", error_description="${INVALID_TOKEN_DESCRIPTION}"`;

export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly reflector: Reflector,
    private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    // A protected answer belongs to one principal: no shared cache may store or reuse it.
    res.setHeader('Cache-Control', 'private, no-store');
    res.appendHeader('Vary', 'Authorization');

    const bearer = readBearerToken(req.headers.authorization);
    const verification = bearer.ok ? await this.verifier.verify(bearer.token) : bearer;
    if (verification.ok) {
      principals.set(req, verification.principal);
      return true;
    }
    if (verification.reason === 'KEYS_UNAVAILABLE') {
      this.logger.error('auth.keys_unavailable', { reason: verification.reason });
      throw new ApiFailure(
        applicationError(
          'DEPENDENCY_UNAVAILABLE',
          [],
          'Authentication is temporarily unavailable. Retry later.',
        ),
      );
    }
    this.logger.info('auth.rejected', { reason: verification.reason });
    throw new ApiFailure(applicationError('UNAUTHENTICATED'), {
      'WWW-Authenticate':
        verification.reason === 'MISSING_TOKEN' ? MISSING_TOKEN_CHALLENGE : INVALID_TOKEN_CHALLENGE,
    });
  }
}
