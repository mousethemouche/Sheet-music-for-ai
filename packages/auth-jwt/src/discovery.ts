/**
 * OAuth discovery for the protected MCP resource (AUTH_MCP_OAUTH.md §2):
 * RFC 9728 Protected Resource Metadata, its well-known URL, and the RFC 6750
 * `WWW-Authenticate` Bearer challenge carrying `resource_metadata`
 * (MCP authorization, revisions 2025-11-25 and 2026-07-28). Pure builders; the
 * MCP app mounts them.
 */
import { canonicalResourceUri, requireServerUrl } from './urls';
import type { TokenRejectionReason } from './verifier';

export interface ProtectedResourceMetadataOptions {
  /** The MCP server URI, for example `https://mcp.example.com/mcp`; canonicalized. */
  readonly resource: string;
  /** Authorization server issuer identifiers, for Supabase `https://<ref>.supabase.co/auth/v1`. */
  readonly authorizationServers: readonly string[];
  readonly scopesSupported?: readonly string[];
  readonly resourceName?: string;
  readonly resourceDocumentation?: string;
}

/** RFC 9728 §2 document. Tokens are accepted in the Authorization header only. */
export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly bearer_methods_supported: readonly ['header'];
  readonly scopes_supported?: readonly string[];
  readonly resource_name?: string;
  readonly resource_documentation?: string;
}

const WELL_KNOWN = '/.well-known/oauth-protected-resource';
/** RFC 6750 §3 `scope-token` characters. */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

export function protectedResourceMetadata(
  options: ProtectedResourceMetadataOptions,
): ProtectedResourceMetadata {
  if (options.authorizationServers.length === 0) {
    throw new TypeError('authorizationServers must list at least one issuer.');
  }
  const authorizationServers = options.authorizationServers.map((issuer) =>
    requireServerUrl(issuer, 'authorization server').href.replace(/\/$/, ''),
  );
  if (options.scopesSupported?.some((scope) => !SCOPE_TOKEN.test(scope)) === true) {
    throw new TypeError('scopesSupported must hold RFC 6750 scope tokens.');
  }
  return {
    resource: canonicalResourceUri(options.resource),
    authorization_servers: authorizationServers,
    bearer_methods_supported: ['header'],
    ...(options.scopesSupported === undefined
      ? {}
      : { scopes_supported: [...options.scopesSupported] }),
    ...(options.resourceName === undefined ? {} : { resource_name: options.resourceName }),
    ...(options.resourceDocumentation === undefined
      ? {}
      : {
          resource_documentation: requireServerUrl(
            options.resourceDocumentation,
            'resourceDocumentation',
          ).href,
        }),
  };
}

/**
 * RFC 9728 §3.1: the well-known suffix goes between the host and the path of
 * the resource. `https://mcp.example.com/mcp` ->
 * `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`;
 * `https://mcp.example.com` -> `https://mcp.example.com/.well-known/oauth-protected-resource`.
 */
export function protectedResourceMetadataUrl(resource: string): string {
  const canonical = new URL(canonicalResourceUri(resource));
  const path = canonical.pathname === '/' ? '' : canonical.pathname;
  return `${canonical.origin}${WELL_KNOWN}${path}`;
}

export interface BearerChallengeOptions {
  readonly resourceMetadataUrl: string;
  /** RFC 6750 §3.1 error code. Omitted when the request carried no credentials. */
  readonly error?: 'invalid_request' | 'invalid_token' | 'insufficient_scope';
  readonly errorDescription?: string;
  readonly scope?: string;
}

/** RFC 6750 quoted-string value; server-chosen text only, so anything outside printable ASCII is a bug. */
function quoted(name: string, value: string): string {
  if (!/^[\x20\x21\x23-\x5B\x5D-\x7E]*$/.test(value)) {
    throw new TypeError(`${name} contains characters not allowed in a WWW-Authenticate parameter.`);
  }
  return `${name}="${value}"`;
}

/** `Bearer resource_metadata="...", error="...", error_description="...", scope="..."` */
export function bearerChallenge(options: BearerChallengeOptions): string {
  const parameters = [
    quoted(
      'resource_metadata',
      requireServerUrl(options.resourceMetadataUrl, 'resourceMetadataUrl').href,
    ),
  ];
  if (options.error !== undefined) {
    parameters.push(quoted('error', options.error));
  }
  if (options.errorDescription !== undefined) {
    parameters.push(quoted('error_description', options.errorDescription));
  }
  if (options.scope !== undefined) {
    if (!options.scope.split(' ').every((scope) => SCOPE_TOKEN.test(scope))) {
      throw new TypeError('scope must be space-separated RFC 6750 scope tokens.');
    }
    parameters.push(quoted('scope', options.scope));
  }
  return `Bearer ${parameters.join(', ')}`;
}

/** What the boundary answers for a refused token. */
export type RejectionResponse =
  | { readonly status: 401; readonly wwwAuthenticate: string }
  /** The key source is down: answer DEPENDENCY_UNAVAILABLE, do not ask the client to re-authenticate. */
  | { readonly status: 503 };

export const INVALID_TOKEN_DESCRIPTION = 'The access token is invalid or expired.';

/**
 * Maps a rejection reason to the HTTP answer. Every token problem gets the
 * same generic `invalid_token` challenge, so the response never tells a
 * caller which check failed; a request without credentials gets a challenge
 * without error code (RFC 6750 §3.1). Both carry `resource_metadata`.
 */
export function rejectionResponse(
  reason: TokenRejectionReason,
  options: { readonly resourceMetadataUrl: string; readonly scope?: string },
): RejectionResponse {
  if (reason === 'KEYS_UNAVAILABLE') {
    return { status: 503 };
  }
  const base = {
    resourceMetadataUrl: options.resourceMetadataUrl,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
  };
  return {
    status: 401,
    wwwAuthenticate: bearerChallenge(
      reason === 'MISSING_TOKEN'
        ? base
        : { ...base, error: 'invalid_token', errorDescription: INVALID_TOKEN_DESCRIPTION },
    ),
  };
}
