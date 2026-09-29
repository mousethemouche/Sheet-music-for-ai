/**
 * Runtime configuration of the MCP server process, read once from the
 * environment and validated before anything starts (MCP_SERVER.md §7).
 * A problem is reported by variable name only: values (a database password,
 * a project URL) never appear in an error message or a log line.
 */
import { canonicalResourceUri, supabaseAuthEndpoints } from '@sheet-music/auth-jwt';
import { MCP_PATH } from './app';

/**
 * How the MCP verifier checks `aud` (AUTH_MCP_OAUTH.md §4):
 * - `resource` (default, the only conformant mode): `aud` must contain the
 *   canonical MCP resource URI;
 * - `interim-authenticated`: `aud` must contain `authenticated`. It violates
 *   the MCP audience MUST and is only the explicit, signed-off override of
 *   §4; it is never a fallback, and every start logs a warning.
 */
export const AUDIENCE_MODES = ['resource', 'interim-authenticated'] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

/** What the production composition (`createMcpApp`) needs besides its adapters. */
export interface McpAppConfig {
  /** Canonical public URL of the MCP endpoint (the protected resource), path `/mcp`. */
  readonly publicUrl: string;
  /** Supabase project URL; issuer and JWKS URL are derived from it. */
  readonly supabaseUrl: string;
  /** Exact browser origins allowed to call `/mcp`; empty: none. */
  readonly allowedOrigins: readonly string[];
  readonly audienceMode: AudienceMode;
  /** Proxy hops in front of the server (Express `trust proxy`); 0: the socket address is the client. */
  readonly trustProxyHops: number;
}

export interface McpConfig extends McpAppConfig {
  /** Server login role (member of score_owner). Secret: never logged. */
  readonly databaseUrl: string;
  readonly port: number;
  /** The built single-file View; undefined: `dist/view/index.html` next to the bundle. */
  readonly viewHtmlPath?: string;
}

export type McpEnvironment = Readonly<Record<string, string | undefined>>;

export const DEFAULT_PORT = 3001;

/** The configuration is invalid; `problems` name the variables, never their values. */
export class McpConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid MCP server configuration: ${problems.join(' ')}`);
    this.name = 'McpConfigError';
    this.problems = Object.freeze([...problems]);
  }
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]{0,5})$/;

function isSecureOrigin(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  return secure && url.origin === value;
}

function isPostgresUrl(value: string): boolean {
  return URL.canParse(value) && ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
}

function present(env: McpEnvironment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Reads and validates the whole configuration; throws McpConfigError listing every problem. */
export function loadMcpConfig(env: McpEnvironment): McpConfig {
  const problems: string[] = [];
  const required = (name: string): string | undefined => {
    const value = present(env, name);
    if (value === undefined) {
      problems.push(`${name} is required.`);
    }
    return value;
  };

  let publicUrl = '';
  const rawPublicUrl = required('MCP_PUBLIC_URL');
  if (rawPublicUrl !== undefined) {
    try {
      publicUrl = canonicalResourceUri(rawPublicUrl);
      if (new URL(publicUrl).pathname !== MCP_PATH) {
        throw new TypeError('wrong path');
      }
    } catch {
      problems.push(
        `MCP_PUBLIC_URL must be the public https URL of the endpoint (http only on a loopback host), with path ${MCP_PATH} and no query or fragment.`,
      );
    }
  }

  const supabaseUrl = required('SUPABASE_URL') ?? '';
  if (supabaseUrl !== '') {
    try {
      supabaseAuthEndpoints(supabaseUrl);
    } catch {
      problems.push(
        'SUPABASE_URL must be the https origin of the Supabase project (http only on a loopback host), without path.',
      );
    }
  }

  const databaseUrl = required('DATABASE_URL') ?? '';
  if (databaseUrl !== '' && !isPostgresUrl(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgres:// or postgresql:// URL.');
  }

  const allowedOrigins = (present(env, 'MCP_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  if (!allowedOrigins.every(isSecureOrigin)) {
    problems.push(
      'MCP_ALLOWED_ORIGINS must list exact https origins (http only on a loopback host), comma-separated, without path.',
    );
  }

  const mode = present(env, 'MCP_AUTH_AUDIENCE_MODE') ?? 'resource';
  const audienceMode = AUDIENCE_MODES.find((candidate) => candidate === mode);
  if (audienceMode === undefined) {
    problems.push(`MCP_AUTH_AUDIENCE_MODE must be one of: ${AUDIENCE_MODES.join(', ')}.`);
  }

  const rawPort = present(env, 'PORT') ?? String(DEFAULT_PORT);
  const port = NON_NEGATIVE_INTEGER.test(rawPort) ? Number(rawPort) : Number.NaN;
  if (!(port <= 65_535)) {
    problems.push('PORT must be an integer from 0 to 65535.');
  }

  const rawHops = present(env, 'MCP_TRUST_PROXY_HOPS') ?? '0';
  const trustProxyHops = NON_NEGATIVE_INTEGER.test(rawHops) ? Number(rawHops) : Number.NaN;
  if (!(trustProxyHops <= 10)) {
    problems.push('MCP_TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  }

  if (problems.length > 0 || audienceMode === undefined) {
    throw new McpConfigError(problems);
  }
  const viewHtmlPath = present(env, 'MCP_VIEW_HTML_PATH');
  return {
    publicUrl,
    supabaseUrl,
    databaseUrl,
    allowedOrigins,
    audienceMode,
    trustProxyHops,
    port,
    ...(viewHtmlPath === undefined ? {} : { viewHtmlPath }),
  };
}
