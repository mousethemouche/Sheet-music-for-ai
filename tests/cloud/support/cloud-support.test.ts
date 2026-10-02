/**
 * The cloud suites' own decisions, without network: the opt-in gate and its
 * configuration checks, synthetic identities, PKCE, OAuth URLs, reading token
 * claims, step blocking and safe failure descriptions. Runs in the opt-in
 * `cloud` project with or without cloud variables.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OAUTH_REDIRECT_URI,
  authUiGate,
  isReservedEmailDomain,
  oauthSmokeGate,
  readyConfig,
} from './env';
import { problemOf } from './http';
import { newPassword, syntheticIdentity } from './identity';
import {
  audiences,
  authorizationServerMetadataUrl,
  authorizeUrl,
  jwtClaims,
  newPkce,
  pkceChallenge,
} from './oauth';
import { type StepOutcome, blockedReason } from './steps';
import { adminHeaders, errorCodeOf, mailProblemHint } from './supabase';
import { sessionStorageKey } from './web';

const COMPLETE = {
  CLOUD_E2E: '1',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  SUPABASE_SECRET_KEY: 'sb_secret_example',
  WEB_BASE_URL: 'https://web.example.org/',
  API_BASE_URL: 'https://api.example.org/v1/',
  CLOUD_E2E_EMAIL: 'Smoke@Release-Sink.dev',
  MCP_URL: 'https://MCP.Example.org/mcp/',
};

function reasonOf(gate: { readonly kind: string; readonly reason?: string }): string {
  expect(gate.kind).toBe('invalid');
  return gate.reason ?? '';
}

describe('cloud gate: opt-in', () => {
  it.each([
    ['unset', undefined],
    ['"true"', 'true'],
    ['"0"', '0'],
  ])('is off when CLOUD_E2E is %s, whatever else is set', (_case, optIn) => {
    expect(authUiGate({ ...COMPLETE, CLOUD_E2E: optIn }).kind).toBe('off');
    expect(oauthSmokeGate({ ...COMPLETE, CLOUD_E2E: optIn }).kind).toBe('off');
  });

  it('is off with an empty environment (the default local and CI runs)', () => {
    expect(authUiGate({}).kind).toBe('off');
    expect(oauthSmokeGate({}).kind).toBe('off');
  });

  it('refuses to hand out a configuration unless ready', () => {
    expect(() => readyConfig(authUiGate({}))).toThrow(/off/);
  });
});

describe('cloud gate: configuration', () => {
  it('normalizes a complete environment', () => {
    expect(readyConfig(authUiGate(COMPLETE))).toEqual({
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      issuer: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1',
      publishableKey: 'sb_publishable_example',
      adminKey: 'sb_secret_example',
      webBaseUrl: 'https://web.example.org',
      apiBaseUrl: 'https://api.example.org/v1',
      mailbox: { local: 'smoke', domain: 'release-sink.dev' },
    });
  });

  it('adds the canonical MCP resource and the default loopback redirect for OAUTH-04', () => {
    const config = readyConfig(oauthSmokeGate(COMPLETE));
    expect(config.mcpUrl).toBe('https://mcp.example.org/mcp');
    expect(config.redirectUri).toBe(DEFAULT_OAUTH_REDIRECT_URI);
    expect(config.preRegisteredClient).toBeNull();
    expect(config.scope).toBeNull();
  });

  it('takes a pre-registered confidential client and a scope', () => {
    const config = readyConfig(
      oauthSmokeGate({
        ...COMPLETE,
        CLOUD_E2E_OAUTH_CLIENT_ID: '0b7f6c1e-8a3d-4c55-9a51-2f0e6d7c9b10',
        CLOUD_E2E_OAUTH_CLIENT_SECRET: 'client-secret',
        CLOUD_E2E_OAUTH_SCOPE: 'openid email',
      }),
    );
    expect(config.preRegisteredClient).toEqual({
      id: '0b7f6c1e-8a3d-4c55-9a51-2f0e6d7c9b10',
      secret: 'client-secret',
    });
    expect(config.scope).toBe('openid email');
  });

  it('accepts the legacy service_role JWT as the admin key', () => {
    const config = readyConfig(
      authUiGate({
        ...COMPLETE,
        SUPABASE_SECRET_KEY: undefined,
        SUPABASE_SERVICE_ROLE_KEY: 'aaa.bbb.ccc',
      }),
    );
    expect(config.adminKey).toBe('aaa.bbb.ccc');
  });

  it('fails an opted-in run by variable name, never echoing a value', () => {
    const reason = reasonOf(
      authUiGate({
        ...COMPLETE,
        SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_secret_leaked-value',
        WEB_BASE_URL: 'https://web.example.org/app?x=1',
        API_BASE_URL: undefined,
      }),
    );
    expect(reason).toContain('SUPABASE_URL');
    expect(reason).toContain('SUPABASE_PUBLISHABLE_KEY must be a publishable key');
    expect(reason).toContain('WEB_BASE_URL must not carry credentials, a query or a fragment');
    expect(reason).toContain('API_BASE_URL is not set');
    expect(reason).not.toContain('leaked-value');
    expect(reason).not.toContain('abcdefghijklmnopqrst');
  });

  it.each([
    ['a reserved domain', 'smoke@example.com', 'reserved or test domain'],
    ['a .test domain', 'smoke@sink.test', 'reserved or test domain'],
    ['a plus tag', 'smoke+tag@release-sink.dev', 'plain mailbox address'],
    ['a subdomain of example.org', 'smoke@sink.example.org', 'reserved or test domain'],
  ])('refuses CLOUD_E2E_EMAIL with %s', (_case, email, expected) => {
    expect(reasonOf(authUiGate({ ...COMPLETE, CLOUD_E2E_EMAIL: email }))).toContain(expected);
  });

  it.each([
    [
      'a client secret without a client ID',
      { CLOUD_E2E_OAUTH_CLIENT_SECRET: 's' },
      'needs CLOUD_E2E_OAUTH_CLIENT_ID',
    ],
    [
      'a client ID that is not a UUID',
      { CLOUD_E2E_OAUTH_CLIENT_ID: 'claude' },
      'CLOUD_E2E_OAUTH_CLIENT_ID must be',
    ],
    [
      'a plain-http remote redirect',
      { CLOUD_E2E_OAUTH_REDIRECT_URI: 'http://smoke.example.org/cb' },
      'CLOUD_E2E_OAUTH_REDIRECT_URI must use https',
    ],
    ['no MCP URL', { MCP_URL: undefined }, 'MCP_URL is not set'],
  ])('refuses OAUTH-04 settings with %s', (_case, change, expected) => {
    expect(reasonOf(oauthSmokeGate({ ...COMPLETE, ...change }))).toContain(expected);
  });

  it.each([
    ['example.com', true],
    ['example.net', true],
    ['test.com', true],
    ['sink.test', true],
    ['mail.localhost', true],
    ['corp.invalid', true],
    ['sink.example.org', true],
    ['release-sink.dev', false],
    ['mailbox.org', false],
  ])('treats %s as reserved: %s', (domain, reserved) => {
    expect(isReservedEmailDomain(domain)).toBe(reserved);
  });
});

describe('synthetic identities', () => {
  const counting = (size: number) => Uint8Array.from({ length: size }, (_, index) => index + 1);

  it('tags the mail-sink mailbox with the suite, the time and random hex', () => {
    const identity = syntheticIdentity(
      { local: 'smoke', domain: 'release-sink.dev' },
      'i01',
      new Date('2026-09-29T10:15:00.123Z'),
      counting,
    );
    expect(identity.tag).toBe('smfa-i01-20260929101500-010203');
    expect(identity.email).toBe('smoke+smfa-i01-20260929101500-010203@release-sink.dev');
  });

  it('makes long passwords with upper case, lower case, digits and a symbol, different each time', () => {
    const first = newPassword();
    expect(first).toMatch(/^Smfa-[\w-]{24}-9!$/);
    expect(first).not.toBe(newPassword());
  });

  it('refuses a suite label that would not fit an address tag', () => {
    expect(() => syntheticIdentity({ local: 'a', domain: 'b.org' }, 'I 01', new Date())).toThrow(
      TypeError,
    );
  });
});

describe('OAuth client pieces', () => {
  // RFC 7636 Appendix B: the octets, the verifier and the S256 challenge.
  const RFC_OCTETS = [
    116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77,
    105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
  ];

  it('derives the RFC 7636 Appendix B verifier and S256 challenge', () => {
    expect(newPkce(() => Uint8Array.from(RFC_OCTETS))).toEqual({
      verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it.each([
    [
      'https://abcdefghijklmnopqrst.supabase.co/auth/v1',
      'https://abcdefghijklmnopqrst.supabase.co/.well-known/oauth-authorization-server/auth/v1',
    ],
    ['https://as.example.org', 'https://as.example.org/.well-known/oauth-authorization-server'],
  ])('places the RFC 8414 metadata of %s at %s', (issuer, expected) => {
    expect(authorizationServerMetadataUrl(issuer)).toBe(expected);
  });

  it('builds the authorize URL a host sends, with resource and without scope', () => {
    const url = new URL(
      authorizeUrl('https://ref.supabase.co/auth/v1/oauth/authorize', {
        clientId: 'c1',
        redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
        challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        state: 's1',
        resource: 'https://mcp.example.org/mcp',
        scope: null,
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'c1',
      redirect_uri: 'http://127.0.0.1:53682/callback',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      state: 's1',
      resource: 'https://mcp.example.org/mcp',
    });
  });

  const token = (payload: unknown) =>
    [
      'eyJhbGciOiJFUzI1NiJ9',
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
      'c2ln',
    ].join('.');

  it('reads the claims and the audience list of a token', () => {
    const claims = jwtClaims(
      token({ sub: 'u1', aud: ['authenticated', 'https://mcp.example.org/mcp'] }),
    );
    expect(claims['sub']).toBe('u1');
    expect(audiences(claims)).toEqual(['authenticated', 'https://mcp.example.org/mcp']);
    expect(audiences({ aud: 'authenticated' })).toEqual(['authenticated']);
    expect(audiences({})).toEqual([]);
  });

  it('refuses what is not a compact JWS with an object payload', () => {
    expect(() => jwtClaims('opaque-token')).toThrow('Not a compact JWS');
    expect(() => jwtClaims(token(['a']))).toThrow('not a JSON object');
  });
});

describe('steps and failure descriptions', () => {
  const outcomes = new Map<string, StepOutcome>([
    ['client', { passed: true }],
    ['details-readable', { passed: false, failedIn: 'authorization details (#2820)' }],
  ]);

  it.each([
    ['no prerequisites', [], null, null],
    ['passed prerequisites', ['client'], null, null],
    [
      'a failed prerequisite',
      ['client', 'details-readable'],
      null,
      'blocked: "details-readable" failed in "authorization details (#2820)"',
    ],
    [
      'a prerequisite that never ran',
      ['code'],
      null,
      'blocked: "code" did not pass (its step did not run)',
    ],
    [
      'an invalid configuration',
      [],
      'the cloud configuration is invalid',
      'blocked: the cloud configuration is invalid',
    ],
  ])('with %s', (_case, needs, suiteBlock, expected) => {
    expect(blockedReason(needs, outcomes, suiteBlock)).toBe(expected);
  });

  it('describes an Auth error by status, code and message, redacted', () => {
    const text = JSON.stringify({
      code: 400,
      error_code: 'refresh_token_not_found',
      msg: 'Invalid Refresh Token: eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.sig',
    });
    expect(problemOf(400, text)).toBe(
      'HTTP 400; error_code: refresh_token_not_found; code: 400; msg: Invalid Refresh Token: [redacted-jwt]',
    );
    expect(problemOf(502, '<html>Bad gateway</html>')).toBe('HTTP 502');
    expect(errorCodeOf(text)).toBe('refresh_token_not_found');
  });

  it('explains the default-SMTP refusal', () => {
    expect(mailProblemHint('email_address_not_authorized')).toContain('custom SMTP');
  });

  it('sends a secret key as apikey only, a legacy service_role JWT also as Bearer', () => {
    expect(adminHeaders('sb_secret_x')).toEqual({ apikey: 'sb_secret_x' });
    expect(adminHeaders('aaa.bbb.ccc')).toEqual({
      apikey: 'aaa.bbb.ccc',
      authorization: 'Bearer aaa.bbb.ccc',
    });
  });

  it("reads supabase-js's default storage key from the project URL", () => {
    expect(sessionStorageKey('https://abcdefghijklmnopqrst.supabase.co')).toBe(
      'sb-abcdefghijklmnopqrst-auth-token',
    );
  });
});
