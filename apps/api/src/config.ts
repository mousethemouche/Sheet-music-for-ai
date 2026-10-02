/**
 * Runtime configuration of apps/api, read from the environment (see
 * apps/api/.env.example):
 *
 * - SUPABASE_URL (required): the Supabase project URL; the token issuer and
 *   JWKS URL are derived from it. No secret is needed to verify tokens.
 * - DATABASE_URL (required): postgres URL of the server login role (a member
 *   of score_owner, DATABASE.md). A secret: never logged or echoed. It
 *   carries no TLS parameter (sslmode, ...).
 * - DATABASE_CA_CERT (required unless the database is on the loopback host):
 *   PEM certificate of the database CA (on Supabase, the project's root
 *   certificate). Every connection is then TLS, verified against it
 *   (DATABASE.md §10.2). Public, not a secret.
 * - API_ALLOWED_ORIGINS (optional): comma-separated exact browser origins
 *   allowed to call the API (the web app). Default: none.
 * - PORT (optional): listening port, default 3000.
 *
 * Invalid configuration fails before anything starts. Problems name the
 * variable and the rule, never the value, so a misplaced secret cannot leak
 * into the logs.
 */
import { supabaseAuthEndpoints } from '@sheet-music/auth-jwt';
import { databaseTlsProblems } from '@sheet-music/persistence-postgres';
import { originPolicy } from '@sheet-music/server-common';

export const DEFAULT_PORT = 3000;

export interface ApiConfig {
  readonly supabaseUrl: string;
  readonly databaseUrl: string;
  /** PEM CA of the database server: verified TLS. Absent: a loopback database. */
  readonly databaseCaCert?: string;
  readonly allowedOrigins: readonly string[];
  readonly port: number;
}

export class ApiConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid API configuration: ${problems.join(' ')}`);
    this.name = 'ApiConfigError';
  }
}

export type Environment = Readonly<Record<string, string | undefined>>;

function present(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function isValid(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

export function loadApiConfig(env: Environment): ApiConfig {
  const problems: string[] = [];

  const supabaseUrl = present(env, 'SUPABASE_URL');
  if (supabaseUrl === undefined) {
    problems.push('SUPABASE_URL is required.');
  } else if (!isValid(() => supabaseAuthEndpoints(supabaseUrl))) {
    problems.push(
      'SUPABASE_URL must be the Supabase project origin (https, or http on a loopback host), without path, query or credentials.',
    );
  }

  const databaseUrl = present(env, 'DATABASE_URL');
  const databaseCaCert = present(env, 'DATABASE_CA_CERT');
  if (databaseUrl === undefined) {
    problems.push('DATABASE_URL is required.');
  } else if (
    !URL.canParse(databaseUrl) ||
    !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)
  ) {
    problems.push('DATABASE_URL must be a postgres:// or postgresql:// connection URL.');
  } else {
    problems.push(...databaseTlsProblems(databaseUrl, databaseCaCert));
  }

  const allowedOrigins = (present(env, 'API_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  if (
    !isValid(() => originPolicy({ allowedOrigins, allowedMethods: ['GET'], allowedHeaders: [] }))
  ) {
    problems.push(
      'API_ALLOWED_ORIGINS must list exact origins (https, or http on a loopback host), comma-separated, without path or trailing slash.',
    );
  }

  const portText = present(env, 'PORT');
  const port = portText === undefined ? DEFAULT_PORT : Number(portText);
  if (!/^[0-9]{1,5}$/.test(portText ?? String(DEFAULT_PORT)) || port < 1 || port > 65_535) {
    problems.push('PORT must be an integer from 1 to 65535.');
  }

  if (problems.length > 0 || supabaseUrl === undefined || databaseUrl === undefined) {
    throw new ApiConfigError(problems);
  }
  return {
    supabaseUrl,
    databaseUrl,
    ...(databaseCaCert === undefined ? {} : { databaseCaCert }),
    allowedOrigins,
    port,
  };
}
