/**
 * OAuth 2.1 client-side pieces of the OAUTH-04 smoke: PKCE (RFC 7636, S256),
 * RFC 8414 metadata location, authorize URL, token requests, and reading the
 * claims of a token the smoke just received. Reading claims is not
 * verification: the deployed MCP server's verifier is what accepts or
 * refuses the token.
 */
import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { type HttpResult, request } from './http';
import type { RandomBytes } from './identity';

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

/** S256 code challenge of a verifier (RFC 7636 §4.2). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** A 43-character verifier from 32 random bytes, and its S256 challenge. */
export function newPkce(randomBytes: RandomBytes = nodeRandomBytes): Pkce {
  const verifier = Buffer.from(randomBytes(32)).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function newState(randomBytes: RandomBytes = nodeRandomBytes): string {
  return Buffer.from(randomBytes(16)).toString('base64url');
}

/** RFC 8414 §3.1: the well-known segment goes between the host and the issuer path. */
export function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.origin}/.well-known/oauth-authorization-server${path}`;
}

export interface AuthorizeRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
  /** RFC 8707 resource indicator; MCP clients always send it. */
  readonly resource: string | null;
  readonly scope: string | null;
}

export function authorizeUrl(endpoint: string, authorize: AuthorizeRequest): string {
  const url = new URL(endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', authorize.clientId);
  url.searchParams.set('redirect_uri', authorize.redirectUri);
  url.searchParams.set('code_challenge', authorize.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', authorize.state);
  if (authorize.resource !== null) url.searchParams.set('resource', authorize.resource);
  if (authorize.scope !== null) url.searchParams.set('scope', authorize.scope);
  return url.href;
}

export interface TokenClient {
  readonly id: string;
  readonly secret: string | null;
}

/** Form-encoded token request; a confidential client authenticates with HTTP Basic, a public one sends client_id. */
export function tokenRequest(
  endpoint: string,
  client: TokenClient,
  parameters: Readonly<Record<string, string>>,
): Promise<HttpResult> {
  const body = new URLSearchParams(parameters);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (client.secret === null) body.set('client_id', client.id);
  else {
    const basic = `${encodeURIComponent(client.id)}:${encodeURIComponent(client.secret)}`;
    headers['authorization'] = `Basic ${Buffer.from(basic).toString('base64')}`;
  }
  return request(endpoint, { method: 'POST', headers, body: body.toString() });
}

/** The payload of a compact JWS, decoded without verification. */
export function jwtClaims(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('Not a compact JWS');
  const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('JWS payload is not a JSON object');
  }
  return payload as Record<string, unknown>;
}

/** `aud` as a list (RFC 7519 allows a string or an array of strings). */
export function audiences(claims: Readonly<Record<string, unknown>>): string[] {
  const aud = claims['aud'];
  if (typeof aud === 'string') return [aud];
  return Array.isArray(aud)
    ? aud.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
