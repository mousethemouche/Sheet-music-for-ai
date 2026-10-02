/**
 * Reads the access token from the Authorization header (RFC 6750 §2.1).
 * Tokens are accepted in this header only: never from the query string, a
 * cookie or the request body (MCP authorization, "Token Requirements").
 */
import type { TokenRejectionReason } from './verifier';

/** `b64token` of RFC 6750 §2.1. */
const B64_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;
const BEARER = /^Bearer +(.*)$/i;

export type BearerToken =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false;
      readonly reason: Extract<TokenRejectionReason, 'MISSING_TOKEN' | 'MALFORMED_TOKEN'>;
    };

/**
 * No header, or another scheme (for example Basic), is `MISSING_TOKEN`: the
 * request carries no bearer credentials. A Bearer header whose value is not a
 * single b64token is `MALFORMED_TOKEN`.
 */
export function readBearerToken(
  authorization: string | readonly string[] | undefined,
): BearerToken {
  if (authorization === undefined || authorization === '') {
    return { ok: false, reason: 'MISSING_TOKEN' };
  }
  if (typeof authorization !== 'string') {
    return { ok: false, reason: 'MALFORMED_TOKEN' };
  }
  const match = BEARER.exec(authorization);
  if (match === null) {
    return /^Bearer$/i.test(authorization.trim())
      ? { ok: false, reason: 'MALFORMED_TOKEN' }
      : { ok: false, reason: 'MISSING_TOKEN' };
  }
  const token = match[1] ?? '';
  return B64_TOKEN.test(token) ? { ok: true, token } : { ok: false, reason: 'MALFORMED_TOKEN' };
}
