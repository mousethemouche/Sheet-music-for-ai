/**
 * Locally generated keys and tokens shaped like Supabase OAuth 2.1 access
 * tokens, signed with jose. No production issuer, key or credential is used.
 */
import {
  type CryptoKey,
  type JWK,
  type JWTHeaderParameters,
  type JWTPayload,
  SignJWT,
  base64url,
  exportJWK,
  generateKeyPair,
} from 'jose';

/** 2026-09-28T12:00:00.000Z, the verifier's controlled clock. */
export const T0 = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));
export const T0_SECONDS = T0.getTime() / 1000;

export const ISSUER = 'https://test-project.supabase.co/auth/v1';
export const MCP_RESOURCE = 'https://mcp.example.test/mcp';
export const USER_A = '6f1c1a52-3f1e-4a8e-9a57-0a3d2c1b0a01';
export const USER_B = '9b2d4c63-5e7f-4b91-8c68-1b4e3d2c1b02';

export interface SigningKey {
  readonly kid: string;
  readonly alg: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
}

export async function signingKey(
  kid: string,
  alg: 'ES256' | 'RS256' = 'ES256',
): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' };
  return { kid, alg, privateKey, publicJwk };
}

/** Claims of a valid OAuth access token for USER_A at T0; `undefined` removes a claim. */
export function claims(overrides: Readonly<Record<string, unknown>> = {}): JWTPayload {
  const merged: Record<string, unknown> = {
    iss: ISSUER,
    aud: 'authenticated',
    sub: USER_A,
    role: 'authenticated',
    iat: T0_SECONDS - 60,
    exp: T0_SECONDS + 3600,
    email: 'a@example.test',
    client_id: 'mcp-client-1',
    session_id: 'session-a',
    is_anonymous: false,
    aal: 'aal1',
    ...overrides,
  };
  for (const [name, value] of Object.entries(merged)) {
    if (value === undefined) {
      delete merged[name];
    }
  }
  return merged;
}

export function sign(
  key: SigningKey,
  payload: JWTPayload = claims(),
  header: Partial<JWTHeaderParameters> = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: key.alg, kid: key.kid, typ: 'JWT', ...header })
    .sign(key.privateKey);
}

/** An HS256 token under a trusted kid, as if the attacker knew or guessed a shared secret. */
export function signHs256(kid: string, payload: JWTPayload = claims()): Promise<string> {
  const secret = new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes!!');
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256', kid, typ: 'JWT' }).sign(secret);
}

/** An unsecured JWT (`alg: none`) with an empty signature. */
export function unsecured(kid: string, payload: JWTPayload = claims()): string {
  const encode = (value: unknown) => base64url.encode(JSON.stringify(value));
  return `${encode({ alg: 'none', kid, typ: 'JWT' })}.${encode(payload)}.`;
}

/** Replaces the payload segment of a signed token, keeping its header and signature. */
export function withPayload(token: string, payload: JWTPayload): string {
  const [header = '', , signature = ''] = token.split('.');
  return `${header}.${base64url.encode(JSON.stringify(payload))}.${signature}`;
}
