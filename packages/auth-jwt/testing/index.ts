/**
 * @sheet-music/auth-jwt/testing
 *
 * Local test issuer for unit and integration suites (docs/testing/HARNESS.md).
 * Test code only: never import it from production code.
 *
 * - createTestIssuer: an ES256 key pair generated in memory, its public JWKS
 *   and an in-memory key source; mints access tokens shaped like the ones
 *   Supabase Auth issues (AUTH_MCP_OAUTH.md §1), including deliberately bad
 *   variants (wrong key, unknown kid, HS256, `none`, expired, wrong claims).
 * - startTestIssuer: the same, plus a loopback HTTP server (127.0.0.1, port
 *   0) serving the JWKS at the Supabase path of its project URL, so an app
 *   under test is composed exactly as in production:
 *   `supabaseAuthEndpoints(projectUrl)` -> `createRemoteJwks(jwksUrl)`.
 * - sessionVerifierConfig / mcpVerifierConfig: the verifier configurations of
 *   apps/api and apps/mcp (AUTH_MCP_OAUTH.md §4, §6) for these keys.
 *
 * Nothing here accepts a token: tokens are only ever checked by the
 * production verifier (`createAccessTokenVerifier`).
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type CryptoKey,
  type JSONWebKeySet,
  type JWK,
  type JWTPayload,
  SignJWT,
  base64url,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import {
  type AccessTokenVerifierConfig,
  type ClientBinding,
  type KeySource,
  canonicalResourceUri,
  createRemoteJwks,
  supabaseAuthEndpoints,
} from '../src/index';

/** `aud` and `role` Supabase puts in every signed-in user's access token. */
export const SESSION_AUDIENCE = 'authenticated';
/** `client_id` of MCP tokens minted by `mcpToken` (a dynamically registered MCP host in production). */
export const TEST_OAUTH_CLIENT_ID = 'test-mcp-client';
/** `kid` of the issuer's signing key unless `TestIssuerOptions.kid` says otherwise. */
export const TEST_KEY_ID = 'test-es256-key';
/** Supabase's default access-token lifetime: one hour. */
export const TEST_TOKEN_LIFETIME_SECONDS = 3600;
/** Project URL of an in-memory issuer (reserved `.test` domain; nothing is served there). */
export const TEST_PROJECT_URL = 'https://auth.example.test';

/** The JWKS path Supabase serves under any project URL: `/auth/v1/.well-known/jwks.json`. */
const JWKS_PATH = new URL(supabaseAuthEndpoints(TEST_PROJECT_URL).jwksUrl).pathname;
const LOOPBACK = '127.0.0.1';

/** `ES256` signs with a key pair; `HS256` with a random shared secret; `none` is an unsecured JWT. */
export type TestTokenAlgorithm = 'ES256' | 'HS256' | 'none';

export interface MintOptions {
  /** `sub`: the user ID. */
  readonly sub: string;
  /** Default: the issuer. */
  readonly iss?: string;
  /** Default `'authenticated'`. */
  readonly aud?: string | readonly string[];
  /** Default `'authenticated'`. */
  readonly role?: string;
  /** `client_id`; absent by default (a first-party session token). */
  readonly clientId?: string;
  /** Epoch seconds. Default: the issuer clock. */
  readonly iat?: number;
  /** Epoch seconds. Default: `iat + expiresInSeconds`. */
  readonly exp?: number;
  /** `exp - iat` when `exp` is not given; negative for an already expired token. Default one hour. */
  readonly expiresInSeconds?: number;
  /** Epoch seconds. Absent by default, as in Supabase tokens. */
  readonly nbf?: number;
  /** Header `kid`. Default: the issuer key's `kid`. */
  readonly kid?: string;
  /** Header `alg`. Default `'ES256'`. */
  readonly alg?: TestTokenAlgorithm;
  /** ES256 only: `'untrusted'` signs with a key pair absent from the JWKS (wrong key). Default `'trusted'`. */
  readonly signingKey?: 'trusted' | 'untrusted';
  /** Extra or replacement claims, applied last; an `undefined` value removes the claim. */
  readonly claims?: Readonly<Record<string, unknown>>;
}

/** Options of `sessionToken` and `mcpToken`: everything but the subject. */
export type TokenOptions = Omit<MintOptions, 'sub'>;

export interface McpVerifierOptions {
  /** Pre-registered OAuth clients; omitted means any `client_id` (dynamic registration). */
  readonly allowedClientIds?: readonly string[];
}

export interface TestIssuer {
  /** `iss` of minted tokens: `<projectUrl>/auth/v1`, as `supabaseAuthEndpoints` derives it. */
  readonly issuer: string;
  /** The Supabase project URL the issuer stands for. */
  readonly projectUrl: string;
  /** `kid` of the trusted signing key. */
  readonly kid: string;
  /** The public key set, as the JWKS endpoint serves it. Holds no private key material. */
  readonly jwks: JSONWebKeySet;
  /** In-memory key source over `jwks` (jose local JWK set). */
  readonly keys: KeySource;
  /** The clock of the default `iat`/`exp` and of the verifier configurations. */
  now(): Date;
  mint(options: MintOptions): Promise<string>;
  /** A first-party web session token (apps/api): `aud` `'authenticated'`, no `client_id`. */
  sessionToken(userId: string, options?: TokenOptions): Promise<string>;
  /**
   * An OAuth access token for the MCP resource: `aud` is `'authenticated'`
   * plus the canonical resource URI (the Custom Access Token Hook of
   * AUTH_MCP_OAUTH.md §4) and `client_id` is TEST_OAUTH_CLIENT_ID.
   */
  mcpToken(userId: string, resource: string, options?: TokenOptions): Promise<string>;
  /** apps/api: exact issuer, audience `'authenticated'`, session binding (no `client_id`). */
  sessionVerifierConfig(): AccessTokenVerifierConfig;
  /** apps/mcp, resource-bound (the default of AUTH_MCP_OAUTH.md §4): audience = canonical resource, OAuth binding. */
  mcpVerifierConfig(resource: string, options?: McpVerifierOptions): AccessTokenVerifierConfig;
}

export interface ServedTestIssuer extends TestIssuer {
  /** `http://127.0.0.1:<port>`: the Supabase project URL to configure an app under test with. */
  readonly projectUrl: string;
  /** `<projectUrl>/auth/v1/.well-known/jwks.json`, served by the loopback server. */
  readonly jwksUrl: string;
  /** Closes the server and its connections. Idempotent; call it in afterAll. */
  stop(): Promise<void>;
}

export interface TestIssuerOptions {
  /** `kid` of the signing key. Default TEST_KEY_ID. */
  readonly kid?: string;
  /** Clock of the default `iat`/`exp` and of the verifier configurations. Default: system time. */
  readonly now?: () => Date;
}

interface KeyMaterial {
  readonly kid: string;
  readonly trusted: CryptoKey;
  readonly untrusted: CryptoKey;
  readonly jwks: JSONWebKeySet;
}

async function generateKeys(kid: string): Promise<KeyMaterial> {
  const trusted = await generateKeyPair('ES256');
  const untrusted = await generateKeyPair('ES256');
  const publicJwk: JWK = { ...(await exportJWK(trusted.publicKey)), kid, alg: 'ES256', use: 'sig' };
  const jwks: JSONWebKeySet = { keys: [publicJwk] };
  // Shared with every test through `issuer.jwks`: a test cannot alter the published keys.
  Object.freeze(publicJwk);
  Object.freeze(jwks.keys);
  Object.freeze(jwks);
  return { kid, trusted: trusted.privateKey, untrusted: untrusted.privateKey, jwks };
}

function unsecuredJwt(header: Record<string, unknown>, payload: JWTPayload): string {
  const encode = (value: unknown) => base64url.encode(JSON.stringify(value));
  return `${encode(header)}.${encode(payload)}.`;
}

/**
 * `remoteJwksUrl` given: the verifier configurations use the production
 * remote key source on it (a fresh cache per configuration); otherwise they
 * use the in-memory `keys`.
 */
function buildIssuer(
  material: KeyMaterial,
  projectUrl: string,
  now: () => Date,
  remoteJwksUrl?: string,
): TestIssuer {
  const { issuer } = supabaseAuthEndpoints(projectUrl);
  const keys: KeySource = createLocalJWKSet(material.jwks);
  const configKeys = (): KeySource =>
    remoteJwksUrl === undefined ? keys : createRemoteJwks(remoteJwksUrl);

  async function mint(options: MintOptions): Promise<string> {
    const iat = options.iat ?? Math.floor(now().getTime() / 1000);
    const aud = options.aud ?? SESSION_AUDIENCE;
    const merged: Record<string, unknown> = {
      iss: options.iss ?? issuer,
      aud: typeof aud === 'string' ? aud : [...aud],
      sub: options.sub,
      role: options.role ?? SESSION_AUDIENCE,
      iat,
      exp: options.exp ?? iat + (options.expiresInSeconds ?? TEST_TOKEN_LIFETIME_SECONDS),
      is_anonymous: false,
      ...(options.nbf === undefined ? {} : { nbf: options.nbf }),
      ...(options.clientId === undefined ? {} : { client_id: options.clientId }),
      ...options.claims,
    };
    const payload: JWTPayload = Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined),
    );
    const alg = options.alg ?? 'ES256';
    const header = { alg, kid: options.kid ?? material.kid, typ: 'JWT' };
    switch (alg) {
      case 'none':
        return unsecuredJwt(header, payload);
      case 'HS256':
        return new SignJWT(payload)
          .setProtectedHeader(header)
          .sign(crypto.getRandomValues(new Uint8Array(32)));
      case 'ES256':
        return new SignJWT(payload)
          .setProtectedHeader(header)
          .sign(options.signingKey === 'untrusted' ? material.untrusted : material.trusted);
    }
  }

  return {
    issuer,
    projectUrl,
    kid: material.kid,
    jwks: material.jwks,
    keys,
    now,
    mint,
    sessionToken: (userId, options = {}) => mint({ ...options, sub: userId }),
    mcpToken: (userId, resource, options = {}) =>
      mint({
        aud: [SESSION_AUDIENCE, canonicalResourceUri(resource)],
        clientId: TEST_OAUTH_CLIENT_ID,
        ...options,
        sub: userId,
      }),
    sessionVerifierConfig: () => ({
      issuer,
      audiences: [SESSION_AUDIENCE],
      client: { kind: 'session' },
      keys: configKeys(),
      now,
    }),
    mcpVerifierConfig: (resource, options = {}) => {
      const client: ClientBinding =
        options.allowedClientIds === undefined
          ? { kind: 'oauth' }
          : { kind: 'oauth', allowedClientIds: [...options.allowedClientIds] };
      return {
        issuer,
        audiences: [canonicalResourceUri(resource)],
        client,
        keys: configKeys(),
        now,
      };
    },
  };
}

const systemTime = (): Date => new Date();

/**
 * An issuer with in-memory keys: tokens for `TEST_PROJECT_URL`, verifier
 * configurations over the in-memory key source. No network.
 */
export async function createTestIssuer(options: TestIssuerOptions = {}): Promise<TestIssuer> {
  const material = await generateKeys(options.kid ?? TEST_KEY_ID);
  return buildIssuer(material, TEST_PROJECT_URL, options.now ?? systemTime);
}

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK, () => {
      server.off('error', reject);
      resolve(server.address() as AddressInfo);
    });
  });
}

/**
 * An issuer whose JWKS is served over loopback HTTP. Its verifier
 * configurations use the production remote key source
 * (`createRemoteJwks(jwksUrl)`, a fresh cache per call); `keys` stays the
 * in-memory source. Only `GET <jwks path>` answers 200; anything else is 404.
 */
export async function startTestIssuer(options: TestIssuerOptions = {}): Promise<ServedTestIssuer> {
  const material = await generateKeys(options.kid ?? TEST_KEY_ID);
  const body = JSON.stringify(material.jwks);
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === JWKS_PATH) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404).end();
  });
  const { port } = await listen(server);
  const projectUrl = `http://${LOOPBACK}:${port}`;
  const { jwksUrl } = supabaseAuthEndpoints(projectUrl);
  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopped ??= new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
      // jose's fetch keeps connections alive; close them so close() completes.
      server.closeAllConnections();
    });
    return stopped;
  };
  const issuer = buildIssuer(material, projectUrl, options.now ?? systemTime, jwksUrl);
  return { ...issuer, jwksUrl, stop };
}
