/**
 * Opt-in gate and configuration of the cloud suites.
 *
 * The suites reach real services (the Supabase project and the deployed web,
 * API and MCP apps), so they run only when the runner sets `CLOUD_E2E=1`
 * explicitly; they are also outside every default Vitest project (only
 * `--project cloud` selects them). Values come from the runner's process
 * environment only: nothing is read from a file, and a problem is reported by
 * variable name, never with its value.
 *
 *   off      CLOUD_E2E is not "1": the suite is skipped
 *   invalid  opted in, but a variable is missing or unusable: the suite fails
 *   ready    opted in and complete
 */
import { canonicalResourceUri, supabaseAuthEndpoints } from './workspace';

export const OPT_IN_VARIABLE = 'CLOUD_E2E';

/** Default OAuth redirect URI of the smoke client: loopback, intercepted by the browser, never served. */
export const DEFAULT_OAUTH_REDIRECT_URI = 'http://127.0.0.1:53682/callback';

export type Gate<T> =
  | { readonly kind: 'off'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'ready'; readonly config: T };

export interface Mailbox {
  readonly local: string;
  readonly domain: string;
}

export interface CloudConfig {
  /** Supabase project origin. */
  readonly supabaseUrl: string;
  /** `<supabaseUrl>/auth/v1`: Auth API base and token issuer. */
  readonly issuer: string;
  readonly publishableKey: string;
  /** `sb_secret_...` or a legacy service_role JWT: server-only, used for the admin API. */
  readonly adminKey: string;
  /** Web app origin (the Supabase Site URL). */
  readonly webBaseUrl: string;
  /** Saved-library API base, without a trailing slash. */
  readonly apiBaseUrl: string;
  /** Mail-sink mailbox; synthetic users get `<local>+<tag>@<domain>`. */
  readonly mailbox: Mailbox;
}

export interface OAuthClientConfig {
  readonly id: string;
  /** Present for a confidential client (client_secret_basic). */
  readonly secret: string | null;
}

export interface OAuthSmokeConfig extends CloudConfig {
  /** Canonical MCP resource URI, as the MCP server computes it from MCP_PUBLIC_URL. */
  readonly mcpUrl: string;
  /** Used instead of dynamic registration when set. */
  readonly preRegisteredClient: OAuthClientConfig | null;
  readonly redirectUri: string;
  /** Requested scope; null lets the suite request what a host following our metadata requests. */
  readonly scope: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;
type Read<T> =
  { readonly ok: true; readonly config: T } | { readonly ok: false; readonly problems: string[] };

/**
 * Hosts Supabase Auth refuses to mail (supabase/auth, internal/mailer/validateclient:
 * invalidHostMap and invalidHostSuffixes) and the IANA reserved names; a
 * synthetic address there cannot receive the confirmation or recovery mail.
 */
const RESERVED_HOSTS = new Set([
  'test',
  'example',
  'invalid',
  'local',
  'localhost',
  'test.com',
  'example.com',
  'example.net',
  'example.org',
  'email.com',
  'anonymous.com',
  'gamil.com',
  'gamai.com',
]);
const RESERVED_SUFFIXES = [
  '.test',
  '.example',
  '.invalid',
  '.local',
  '.localhost',
  // RFC 2606 second-level names reserve their subdomains too (no MX anywhere).
  '.example.com',
  '.example.net',
  '.example.org',
];

export function isReservedEmailDomain(domain: string): boolean {
  const host = domain.toLowerCase();
  return RESERVED_HOSTS.has(host) || RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

/** https (http only on a loopback host), without credentials, query or fragment. */
function httpUrl(raw: string, name: string, problems: string[]): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push(`${name} is not a URL`);
    return null;
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure) problems.push(`${name} must use https (http only on a loopback host)`);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    raw.includes('?') ||
    raw.includes('#')
  ) {
    problems.push(`${name} must not carry credentials, a query or a fragment`);
  }
  return secure ? url : null;
}

function readMailbox(raw: string, problems: string[]): Mailbox | null {
  const match = /^([a-z0-9._-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(raw.toLowerCase());
  if (!match) {
    problems.push('CLOUD_E2E_EMAIL must be a plain mailbox address (no "+tag"): local@domain');
    return null;
  }
  const [, local = '', domain = ''] = match;
  if (isReservedEmailDomain(domain)) {
    problems.push(
      'CLOUD_E2E_EMAIL uses a reserved or test domain that Supabase Auth does not mail',
    );
    return null;
  }
  return { local, domain };
}

function readCloudConfig(env: Env): Read<CloudConfig> {
  const problems: string[] = [];
  const required = [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'WEB_BASE_URL',
    'API_BASE_URL',
    'CLOUD_E2E_EMAIL',
  ];
  for (const name of required) {
    if (!value(env, name)) problems.push(`${name} is not set`);
  }

  let supabaseUrl = '';
  let issuer = '';
  const supabaseRaw = value(env, 'SUPABASE_URL');
  if (supabaseRaw) {
    try {
      issuer = supabaseAuthEndpoints(supabaseRaw).issuer;
      supabaseUrl = new URL(supabaseRaw).origin;
    } catch {
      problems.push('SUPABASE_URL must be the project origin (https, no path or query)');
    }
  }

  const publishableKey = value(env, 'SUPABASE_PUBLISHABLE_KEY') ?? '';
  if (publishableKey && !publishableKey.startsWith('sb_publishable_')) {
    problems.push('SUPABASE_PUBLISHABLE_KEY must be a publishable key (sb_publishable_...)');
  }

  const secretKey = value(env, 'SUPABASE_SECRET_KEY');
  const serviceRoleKey = value(env, 'SUPABASE_SERVICE_ROLE_KEY');
  let adminKey = '';
  if (secretKey) {
    if (secretKey.startsWith('sb_secret_')) adminKey = secretKey;
    else problems.push('SUPABASE_SECRET_KEY must be a secret key (sb_secret_...)');
  } else if (serviceRoleKey) {
    if (JWT_SHAPE.test(serviceRoleKey)) adminKey = serviceRoleKey;
    else problems.push('SUPABASE_SERVICE_ROLE_KEY must be the legacy service_role JWT');
  } else {
    problems.push('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  let webBaseUrl = '';
  const webRaw = value(env, 'WEB_BASE_URL');
  const web = webRaw ? httpUrl(webRaw, 'WEB_BASE_URL', problems) : null;
  if (web) {
    if (web.pathname !== '/')
      problems.push('WEB_BASE_URL must be the web app origin, without a path');
    webBaseUrl = web.origin;
  }

  let apiBaseUrl = '';
  const apiRaw = value(env, 'API_BASE_URL');
  const api = apiRaw ? httpUrl(apiRaw, 'API_BASE_URL', problems) : null;
  if (api) apiBaseUrl = `${api.origin}${api.pathname.replace(/\/+$/, '')}`;

  const mailboxRaw = value(env, 'CLOUD_E2E_EMAIL');
  const mailbox = mailboxRaw ? readMailbox(mailboxRaw, problems) : null;

  if (problems.length > 0 || !mailbox) return { ok: false, problems };
  return {
    ok: true,
    config: { supabaseUrl, issuer, publishableKey, adminKey, webBaseUrl, apiBaseUrl, mailbox },
  };
}

function readOAuthSmokeConfig(env: Env): Read<OAuthSmokeConfig> {
  const base = readCloudConfig(env);
  const problems = base.ok ? [] : [...base.problems];

  let mcpUrl = '';
  const mcpRaw = value(env, 'MCP_URL');
  if (!mcpRaw) problems.push('MCP_URL is not set');
  else {
    try {
      mcpUrl = canonicalResourceUri(mcpRaw);
    } catch {
      problems.push('MCP_URL must be the public MCP endpoint URL (https, no query)');
    }
  }

  const clientId = value(env, 'CLOUD_E2E_OAUTH_CLIENT_ID');
  const clientSecret = value(env, 'CLOUD_E2E_OAUTH_CLIENT_SECRET');
  if (clientId && !UUID.test(clientId))
    problems.push('CLOUD_E2E_OAUTH_CLIENT_ID must be a Supabase OAuth client ID (UUID)');
  if (clientSecret && !clientId)
    problems.push('CLOUD_E2E_OAUTH_CLIENT_SECRET needs CLOUD_E2E_OAUTH_CLIENT_ID');

  const redirectRaw = value(env, 'CLOUD_E2E_OAUTH_REDIRECT_URI') ?? DEFAULT_OAUTH_REDIRECT_URI;
  const redirect = httpUrl(redirectRaw, 'CLOUD_E2E_OAUTH_REDIRECT_URI', problems);

  if (!base.ok || problems.length > 0 || !redirect) return { ok: false, problems };
  return {
    ok: true,
    config: {
      ...base.config,
      mcpUrl,
      preRegisteredClient: clientId ? { id: clientId, secret: clientSecret ?? null } : null,
      redirectUri: redirect.href,
      scope: value(env, 'CLOUD_E2E_OAUTH_SCOPE') ?? null,
    },
  };
}

function gate<T>(env: Env, read: (env: Env) => Read<T>): Gate<T> {
  if (env[OPT_IN_VARIABLE] !== '1') {
    return { kind: 'off', reason: `${OPT_IN_VARIABLE} is not "1": cloud suites are opt-in` };
  }
  const result = read(env);
  return result.ok
    ? { kind: 'ready', config: result.config }
    : { kind: 'invalid', reason: `Cloud configuration: ${result.problems.join('; ')}.` };
}

/** AUTH-UI-I01 (#25). */
export function authUiGate(env: Env): Gate<CloudConfig> {
  return gate(env, readCloudConfig);
}

/** OAUTH-04 (#26). */
export function oauthSmokeGate(env: Env): Gate<OAuthSmokeConfig> {
  return gate(env, readOAuthSmokeConfig);
}

/** The configuration of a gate that tests only read once it is ready (hooks and bodies never run otherwise). */
export function readyConfig<T>(current: Gate<T>): T {
  if (current.kind !== 'ready')
    throw new Error(`Cloud suite used while ${current.kind}: ${current.reason}`);
  return current.config;
}
