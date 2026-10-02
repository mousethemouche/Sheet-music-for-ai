/**
 * Caller identity of a tool call. The HTTP auth middleware (#26) verifies the
 * bearer token and sets `req.auth` (the SDK `AuthInfo`); the Streamable HTTP
 * transport hands it to every handler as `extra.authInfo`. Tool arguments
 * never carry identity.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AuthenticatedPrincipal } from '@sheet-music/music-application';

/** Maps the verified auth info of a request to the application principal; null when unauthenticated. */
export type PrincipalResolver = (authInfo: AuthInfo | undefined) => AuthenticatedPrincipal | null;

/**
 * Default resolver: the verified subject is `authInfo.extra.userId` (the
 * convention the auth middleware of #26 follows). Anything else is
 * unauthenticated, and the use cases answer UNAUTHENTICATED before any read.
 */
export const principalFromAuthInfo: PrincipalResolver = (authInfo) => {
  const userId = authInfo?.extra?.['userId'];
  return typeof userId === 'string' && userId.trim() !== '' ? { userId } : null;
};
