/**
 * OAUTH-01 (issue #26): the real verifier with a controlled issuer, locally
 * generated keys and a fixed clock. It proves OUR configuration (issuer,
 * audience, algorithm allow-list, clock tolerance, identity and client
 * binding, bounded key refresh), not every upstream algorithm. Every token is
 * cryptographically verified; nothing is merely decoded.
 */
import { type JSONWebKeySet, createLocalJWKSet } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type AccessTokenVerifierConfig,
  type AsymmetricAlgorithm,
  type TokenRejectionReason,
  createAccessTokenVerifier,
  createRemoteJwks,
} from '../src/index';
import {
  ISSUER,
  MCP_RESOURCE,
  type SigningKey,
  T0,
  T0_SECONDS,
  USER_A,
  claims,
  sign,
  signHs256,
  signingKey,
  unsecured,
  withPayload,
} from './support/tokens';

const TOLERANCE = 30;

let trusted: SigningKey;
let impostor: SigningKey;
let unknown: SigningKey;
let rsa: SigningKey;

beforeAll(async () => {
  trusted = await signingKey('key-1');
  impostor = await signingKey('key-1');
  unknown = await signingKey('key-9');
  rsa = await signingKey('key-rsa', 'RS256');
});

function verifier(overrides: Partial<AccessTokenVerifierConfig> = {}) {
  return createAccessTokenVerifier({
    issuer: ISSUER,
    audiences: ['authenticated'],
    client: { kind: 'oauth' },
    keys: createLocalJWKSet({ keys: [trusted.publicJwk, rsa.publicJwk] }),
    clockToleranceSeconds: TOLERANCE,
    now: () => T0,
    ...overrides,
  });
}

describe('OAUTH-01 accepted tokens', () => {
  const cases: readonly {
    name: string;
    token: () => Promise<string>;
    config?: Partial<AccessTokenVerifierConfig>;
  }[] = [
    { name: 'a valid OAuth access token', token: () => sign(trusted) },
    {
      name: 'exp one second inside the clock tolerance',
      token: () => sign(trusted, claims({ exp: T0_SECONDS - TOLERANCE + 1 })),
    },
    {
      name: 'nbf and iat exactly at the tolerance edge',
      token: () =>
        sign(trusted, claims({ nbf: T0_SECONDS + TOLERANCE, iat: T0_SECONDS + TOLERANCE })),
    },
    {
      name: 'an audience array holding the MCP resource (custom access token hook)',
      token: () => sign(trusted, claims({ aud: ['authenticated', MCP_RESOURCE] })),
      config: { audiences: [MCP_RESOURCE] },
    },
    {
      name: 'an allow-listed OAuth client',
      token: () => sign(trusted),
      config: { client: { kind: 'oauth', allowedClientIds: ['mcp-client-1'] } },
    },
    {
      name: 'a first-party web session token on a session boundary',
      token: () => sign(trusted, claims({ client_id: undefined })),
      config: { client: { kind: 'session' } },
    },
  ];

  it.each(cases)('accepts $name', async ({ token, config }) => {
    const result = await verifier(config).verify(await token());

    expect(result).toEqual({ ok: true, principal: { userId: USER_A } });
  });
});

describe('OAUTH-01 rejected tokens', () => {
  const cases: readonly {
    name: string;
    token: () => Promise<string>;
    reason: TokenRejectionReason;
    config?: Partial<AccessTokenVerifierConfig>;
  }[] = [
    {
      name: 'a signature by another key under the trusted kid',
      token: () => sign(impostor),
      reason: 'BAD_SIGNATURE',
    },
    {
      name: 'a payload swapped after signing (another subject)',
      token: async () => withPayload(await sign(trusted), claims({ sub: 'someone-else' })),
      reason: 'BAD_SIGNATURE',
    },
    {
      name: 'an attacker key embedded in the header (jwk, jku)',
      token: () =>
        sign(impostor, claims(), {
          jwk: {
            kty: impostor.publicJwk.kty ?? 'EC',
            crv: 'P-256',
            x: impostor.publicJwk.x ?? '',
            y: impostor.publicJwk.y ?? '',
          },
          jku: 'https://attacker.example.test/jwks.json',
        }),
      reason: 'BAD_SIGNATURE',
    },
    { name: 'an unknown kid', token: () => sign(unknown), reason: 'UNKNOWN_KEY' },
    {
      name: 'another issuer',
      token: () => sign(trusted, claims({ iss: 'https://other-project.supabase.co/auth/v1' })),
      reason: 'WRONG_ISSUER',
    },
    {
      name: 'no issuer',
      token: () => sign(trusted, claims({ iss: undefined })),
      reason: 'WRONG_ISSUER',
    },
    {
      name: 'the anon audience',
      token: () => sign(trusted, claims({ aud: 'anon' })),
      reason: 'WRONG_AUDIENCE',
    },
    {
      name: 'an audience without the MCP resource when the resource is required',
      token: () => sign(trusted, claims({ aud: ['authenticated', 'https://api.other.test'] })),
      reason: 'WRONG_AUDIENCE',
      config: { audiences: [MCP_RESOURCE] },
    },
    {
      name: 'exp exactly at the tolerance edge',
      token: () => sign(trusted, claims({ exp: T0_SECONDS - TOLERANCE })),
      reason: 'EXPIRED',
    },
    {
      name: 'nbf one second beyond the tolerance',
      token: () => sign(trusted, claims({ nbf: T0_SECONDS + TOLERANCE + 1 })),
      reason: 'NOT_YET_VALID',
    },
    {
      name: 'iat one second beyond the tolerance',
      token: () => sign(trusted, claims({ iat: T0_SECONDS + TOLERANCE + 1 })),
      reason: 'NOT_YET_VALID',
    },
    {
      name: 'no subject',
      token: () => sign(trusted, claims({ sub: undefined })),
      reason: 'INVALID_CLAIMS',
    },
    {
      name: 'a blank subject',
      token: () => sign(trusted, claims({ sub: ' ' })),
      reason: 'INVALID_CLAIMS',
    },
    {
      name: 'no expiry',
      token: () => sign(trusted, claims({ exp: undefined })),
      reason: 'INVALID_CLAIMS',
    },
    {
      name: 'no issued-at',
      token: () => sign(trusted, claims({ iat: undefined })),
      reason: 'INVALID_CLAIMS',
    },
    {
      name: 'the service_role role',
      token: () => sign(trusted, claims({ role: 'service_role' })),
      reason: 'INVALID_CLAIMS',
    },
    {
      name: 'an anonymous Supabase user',
      token: () => sign(trusted, claims({ is_anonymous: true })),
      reason: 'INVALID_CLAIMS',
    },
    {
      name: 'HS256 under the trusted kid',
      token: () => signHs256('key-1'),
      reason: 'ALGORITHM_NOT_ALLOWED',
    },
    {
      name: 'alg none',
      token: () => Promise.resolve(unsecured('key-1')),
      reason: 'ALGORITHM_NOT_ALLOWED',
    },
    {
      name: 'RS256 from a published key when only ES256 is allowed',
      token: () => sign(rsa),
      reason: 'ALGORITHM_NOT_ALLOWED',
    },
    {
      name: 'a string that is not a JWS',
      token: () => Promise.resolve('not-a-token'),
      reason: 'MALFORMED_TOKEN',
    },
    {
      name: 'a token longer than the cap',
      token: async () => `${await sign(trusted)}${'A'.repeat(16_384)}`,
      reason: 'MALFORMED_TOKEN',
    },
    {
      name: 'a first-party session token on an OAuth boundary',
      token: () => sign(trusted, claims({ client_id: undefined })),
      reason: 'CLIENT_NOT_ALLOWED',
    },
    {
      name: 'a client outside the allow-list',
      token: () => sign(trusted, claims({ client_id: 'other-client' })),
      reason: 'CLIENT_NOT_ALLOWED',
      config: { client: { kind: 'oauth', allowedClientIds: ['mcp-client-1'] } },
    },
    {
      name: 'an OAuth client token on a session boundary',
      token: () => sign(trusted),
      reason: 'CLIENT_NOT_ALLOWED',
      config: { client: { kind: 'session' } },
    },
  ];

  it.each(cases)('rejects $name as $reason', async ({ token, reason, config }) => {
    const result = await verifier(config).verify(await token());

    expect(result).toEqual({ ok: false, reason });
  });
});

describe('OAUTH-01 configuration', () => {
  const invalid: readonly { name: string; config: Partial<AccessTokenVerifierConfig> }[] = [
    { name: 'HS256 in the allow-list', config: { algorithms: ['HS256' as AsymmetricAlgorithm] } },
    { name: 'none in the allow-list', config: { algorithms: ['none' as AsymmetricAlgorithm] } },
    { name: 'an empty allow-list', config: { algorithms: [] } },
    { name: 'no audience', config: { audiences: [] } },
    { name: 'an issuer that is not a URL', config: { issuer: 'supabase' } },
    { name: 'a clock tolerance above 5 minutes', config: { clockToleranceSeconds: 301 } },
    {
      name: 'an empty client allow-list',
      config: { client: { kind: 'oauth', allowedClientIds: [] } },
    },
  ];

  it.each(invalid)('refuses $name', ({ config }) => {
    expect(() => verifier(config)).toThrow();
  });
});

describe('OAUTH-01 remote key set: bounded unknown-kid refresh', () => {
  const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A JWKS endpoint whose published keys the test changes; counts fetches. */
  function endpoint(initial: JSONWebKeySet) {
    let published = initial;
    let failing = false;
    const fetch = vi.fn((url: string) => {
      expect(url).toBe(JWKS_URL);
      return failing
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(Response.json(published));
    });
    return {
      fetch,
      publish(keys: JSONWebKeySet) {
        published = keys;
      },
      fail() {
        failing = true;
      },
    };
  }

  function remoteVerifier(fetch: ReturnType<typeof endpoint>['fetch']) {
    return verifier({
      keys: createRemoteJwks(JWKS_URL, { fetch, cooldownMs: 30_000, cacheMaxAgeMs: 600_000 }),
      now: () => new Date(),
    });
  }

  it('refetches at most once per cooldown and picks up a rotated key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const jwks = endpoint({ keys: [trusted.publicJwk] });
    const tokens = remoteVerifier(jwks.fetch);

    expect(await tokens.verify(await sign(trusted))).toMatchObject({ ok: true });
    expect(jwks.fetch).toHaveBeenCalledTimes(1);

    const rotated = await signingKey('key-2');
    const rotatedToken = await sign(rotated);
    jwks.publish({ keys: [trusted.publicJwk, rotated.publicJwk] });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await tokens.verify(rotatedToken)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    }
    expect(jwks.fetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0.getTime() + 30_001);
    expect(await tokens.verify(rotatedToken)).toMatchObject({ ok: true });
    expect(jwks.fetch).toHaveBeenCalledTimes(2);

    expect(await tokens.verify(await sign(unknown))).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    expect(jwks.fetch).toHaveBeenCalledTimes(2);
  });

  it('reports KEYS_UNAVAILABLE, not an accepted or invalid token, when the key set cannot be fetched', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const jwks = endpoint({ keys: [trusted.publicJwk] });
    jwks.fail();

    expect(await remoteVerifier(jwks.fetch).verify(await sign(trusted))).toEqual({
      ok: false,
      reason: 'KEYS_UNAVAILABLE',
    });
  });

  it('refuses a JWKS URL that is not https', () => {
    expect(() =>
      createRemoteJwks('http://test-project.supabase.co/auth/v1/.well-known/jwks.json'),
    ).toThrow(TypeError);
  });
});
