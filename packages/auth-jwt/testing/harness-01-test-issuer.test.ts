/**
 * HARNESS-01 (issue #18), test issuer: tokens minted by
 * @sheet-music/auth-jwt/testing are checked ONLY by the production verifier
 * (createAccessTokenVerifier), and are accepted or refused for the reasons
 * AUTH_MCP_OAUTH.md §3 gives. Covers the in-memory key source and the
 * loopback JWKS endpoint read by the production remote key source. The full
 * token matrix stays OAUTH-01 (packages/auth-jwt/test); this only proves the
 * harness produces what integration suites expect of it.
 */
import { type JWTPayload, base64url, decodeJwt } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TokenRejectionReason, createAccessTokenVerifier } from '../src/index';
import { type ServedTestIssuer, type TestIssuer, createTestIssuer, startTestIssuer } from './index';

/** 2026-09-28T12:00:00.000Z */
const T0 = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));
const T0_SECONDS = T0.getTime() / 1000;
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RESOURCE = 'https://mcp.example.test/mcp';

/** Replaces the payload segment of a signed token, keeping its header and signature. */
function tampered(token: string, payload: JWTPayload): string {
  const [header = '', , signature = ''] = token.split('.');
  return `${header}.${base64url.encode(JSON.stringify(payload))}.${signature}`;
}

describe('HARNESS-01 test issuer with in-memory keys', () => {
  let issuer: TestIssuer;

  beforeAll(async () => {
    issuer = await createTestIssuer({ now: () => T0 });
  });

  it('publishes one public ES256 key and no private key material', () => {
    expect(issuer.jwks.keys).toHaveLength(1);
    const [key] = issuer.jwks.keys;
    expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', kid: issuer.kid });
    expect(key).not.toHaveProperty('d');
  });

  it('mints a session token with the Supabase claims of a signed-in user', async () => {
    const claims = decodeJwt(await issuer.sessionToken(USER_A));

    expect(claims).toEqual({
      iss: 'https://auth.example.test/auth/v1',
      aud: 'authenticated',
      sub: USER_A,
      role: 'authenticated',
      iat: T0_SECONDS,
      exp: T0_SECONDS + 3600,
      is_anonymous: false,
    });
  });

  it('a session token verifies to its user with the apps/api configuration', async () => {
    const verifier = createAccessTokenVerifier(issuer.sessionVerifierConfig());

    await expect(verifier.verify(await issuer.sessionToken(USER_A))).resolves.toEqual({
      ok: true,
      principal: { userId: USER_A },
    });
  });

  it('an MCP token carries the resource audience and client_id and verifies with the apps/mcp configuration', async () => {
    const token = await issuer.mcpToken(USER_B, 'HTTPS://MCP.Example.test/mcp/');
    const verifier = createAccessTokenVerifier(issuer.mcpVerifierConfig(RESOURCE));

    expect(decodeJwt(token)).toMatchObject({
      aud: ['authenticated', RESOURCE],
      client_id: 'test-mcp-client',
    });
    await expect(verifier.verify(token)).resolves.toEqual({
      ok: true,
      principal: { userId: USER_B },
    });
  });

  const refused: readonly {
    name: string;
    token: (issuer: TestIssuer) => Promise<string>;
    config: 'session' | 'mcp';
    reason: TokenRejectionReason;
  }[] = [
    {
      name: 'a tampered payload (sub swapped to B, signature of A kept)',
      token: async (i) => {
        const token = await i.sessionToken(USER_A);
        return tampered(token, { ...decodeJwt(token), sub: USER_B });
      },
      config: 'session',
      reason: 'BAD_SIGNATURE',
    },
    {
      name: 'a token signed by a key absent from the JWKS under the trusted kid',
      token: (i) => i.sessionToken(USER_A, { signingKey: 'untrusted' }),
      config: 'session',
      reason: 'BAD_SIGNATURE',
    },
    {
      name: 'an unknown kid',
      token: (i) => i.sessionToken(USER_A, { kid: 'rotated-away' }),
      config: 'session',
      reason: 'UNKNOWN_KEY',
    },
    {
      name: 'an HS256 token under the trusted kid',
      token: (i) => i.sessionToken(USER_A, { alg: 'HS256' }),
      config: 'session',
      reason: 'ALGORITHM_NOT_ALLOWED',
    },
    {
      name: 'an unsecured (alg none) token',
      token: (i) => i.mcpToken(USER_A, RESOURCE, { alg: 'none' }),
      config: 'mcp',
      reason: 'ALGORITHM_NOT_ALLOWED',
    },
    {
      name: 'a token expired one hour ago',
      token: (i) => i.sessionToken(USER_A, { expiresInSeconds: -3600 }),
      config: 'session',
      reason: 'EXPIRED',
    },
    {
      name: 'a token not valid before one hour from now',
      token: (i) => i.sessionToken(USER_A, { nbf: T0_SECONDS + 3600 }),
      config: 'session',
      reason: 'NOT_YET_VALID',
    },
    {
      name: 'another issuer',
      token: (i) => i.sessionToken(USER_A, { iss: 'https://other.example.test/auth/v1' }),
      config: 'session',
      reason: 'WRONG_ISSUER',
    },
    {
      name: 'an anon role',
      token: (i) => i.sessionToken(USER_A, { role: 'anon' }),
      config: 'session',
      reason: 'INVALID_CLAIMS',
    },
    {
      name: 'a session token at the MCP resource',
      token: (i) => i.sessionToken(USER_A),
      config: 'mcp',
      reason: 'WRONG_AUDIENCE',
    },
    {
      name: 'an MCP token of another resource',
      token: (i) => i.mcpToken(USER_A, 'https://other.example.test/mcp'),
      config: 'mcp',
      reason: 'WRONG_AUDIENCE',
    },
    {
      name: 'an MCP token at the REST API',
      token: (i) => i.mcpToken(USER_A, RESOURCE),
      config: 'session',
      reason: 'CLIENT_NOT_ALLOWED',
    },
  ];

  it.each(refused)('$name is refused: $reason', async ({ token, config, reason }) => {
    const verifier = createAccessTokenVerifier(
      config === 'session' ? issuer.sessionVerifierConfig() : issuer.mcpVerifierConfig(RESOURCE),
    );

    await expect(verifier.verify(await token(issuer))).resolves.toEqual({ ok: false, reason });
  });

  it('an MCP configuration with pre-registered clients refuses another client_id', async () => {
    const verifier = createAccessTokenVerifier(
      issuer.mcpVerifierConfig(RESOURCE, { allowedClientIds: ['registered-host'] }),
    );

    await expect(verifier.verify(await issuer.mcpToken(USER_A, RESOURCE))).resolves.toEqual({
      ok: false,
      reason: 'CLIENT_NOT_ALLOWED',
    });
  });
});

describe('HARNESS-01 test issuer served over loopback HTTP', () => {
  let served: ServedTestIssuer;

  beforeAll(async () => {
    served = await startTestIssuer();
  });

  afterAll(() => served.stop());

  it('derives issuer and JWKS URL from its loopback project URL as Supabase does', () => {
    expect(served.projectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(served.issuer).toBe(`${served.projectUrl}/auth/v1`);
    expect(served.jwksUrl).toBe(`${served.projectUrl}/auth/v1/.well-known/jwks.json`);
  });

  it('serves exactly its public JWKS at the JWKS URL and nothing elsewhere', async () => {
    const jwks = await fetch(served.jwksUrl);
    const other = await fetch(`${served.projectUrl}/auth/v1/token`);

    expect(jwks.status).toBe(200);
    expect(await jwks.json()).toEqual(served.jwks);
    expect(other.status).toBe(404);
  });

  it('an MCP token verifies through the production remote key source', async () => {
    const verifier = createAccessTokenVerifier(served.mcpVerifierConfig(RESOURCE));

    await expect(verifier.verify(await served.mcpToken(USER_A, RESOURCE))).resolves.toEqual({
      ok: true,
      principal: { userId: USER_A },
    });
  });

  it('once stopped, a verifier without cached keys reports KEYS_UNAVAILABLE, not a 401 reason', async () => {
    const verifier = createAccessTokenVerifier(served.sessionVerifierConfig());
    const token = await served.sessionToken(USER_A);
    await served.stop();

    await expect(verifier.verify(token)).resolves.toEqual({
      ok: false,
      reason: 'KEYS_UNAVAILABLE',
    });
  });
});
