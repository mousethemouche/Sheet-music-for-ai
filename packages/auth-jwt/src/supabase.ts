/**
 * Supabase Auth endpoints derived from the project URL (AUTH_MCP_OAUTH.md §1).
 * For the cloud project `https://<ref>.supabase.co`:
 * - issuer (`iss` of every access token, and the OAuth authorization server
 *   identifier advertised in the protected resource metadata):
 *   `https://<ref>.supabase.co/auth/v1`;
 * - JWKS: `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`.
 * Plain http is accepted for a loopback Supabase CLI stack only.
 */
import { requireServerUrl } from './urls';

export interface SupabaseAuthEndpoints {
  readonly issuer: string;
  readonly jwksUrl: string;
}

export function supabaseAuthEndpoints(projectUrl: string): SupabaseAuthEndpoints {
  const url = requireServerUrl(projectUrl, 'projectUrl');
  if (url.pathname !== '/' || url.search !== '') {
    throw new TypeError('projectUrl must be the project origin, without path or query.');
  }
  const issuer = `${url.origin}/auth/v1`;
  return { issuer, jwksUrl: `${issuer}/.well-known/jwks.json` };
}
