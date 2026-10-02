/**
 * TLS of the servers' database connection (DATABASE.md §10.2). apps/api and
 * apps/mcp read the same two variables and validate them with
 * `databaseTlsProblems` at start:
 *
 * - DATABASE_CA_CERT: the PEM certificate of the CA that signed the database
 *   server's certificate (on Supabase, the project's root certificate). With
 *   it every connection is TLS, and the server certificate and host name are
 *   verified against that CA only: a server without TLS, or with another
 *   certificate, is refused, never used in plaintext or unverified.
 * - DATABASE_URL carries no TLS parameter (`sslmode`, `sslrootcert`, ...):
 *   node-postgres lets URL parameters override the `ssl` option.
 * - Without DATABASE_CA_CERT only a database on the loopback host (local
 *   development and tests) is accepted.
 *
 * Problems name the variables, never their values.
 */
import { X509Certificate } from 'node:crypto';
import type { PostgresPoolConfig } from './pool';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** node-postgres reads these URL parameters as TLS settings (pg-connection-string). */
function isTlsParameter(name: string): boolean {
  return name.startsWith('ssl') || name === 'uselibpqcompat';
}

/** The host node-postgres connects to: a `host` parameter wins; empty or a socket path is local. */
function isLoopback(url: URL): boolean {
  const host = url.searchParams.get('host') ?? url.hostname;
  return host === '' || host.startsWith('/') || LOOPBACK_HOSTS.has(host.toLowerCase());
}

function isPemCertificate(value: string): boolean {
  try {
    new X509Certificate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Problems of the TLS settings for `databaseUrl` (a `postgres://` URL the
 * caller has already validated) and the optional CA certificate; empty when
 * the pair is acceptable.
 */
export function databaseTlsProblems(
  databaseUrl: string,
  caCertificate: string | undefined,
): string[] {
  if (!URL.canParse(databaseUrl)) {
    return [];
  }
  const url = new URL(databaseUrl);
  const problems: string[] = [];
  if ([...url.searchParams.keys()].some(isTlsParameter)) {
    problems.push(
      'DATABASE_URL must not carry TLS parameters (sslmode, sslrootcert, ...): TLS is set by DATABASE_CA_CERT, which URL parameters would override.',
    );
  }
  if (caCertificate === undefined) {
    if (!isLoopback(url)) {
      problems.push(
        'DATABASE_CA_CERT is required for a database outside the loopback host: the PEM certificate of the database CA, for verified TLS.',
      );
    }
  } else if (!isPemCertificate(caCertificate)) {
    problems.push('DATABASE_CA_CERT must be a PEM certificate.');
  }
  return problems;
}

/**
 * The pool's TLS option for a validated CA certificate: TLS required, server
 * certificate and host name verified against that CA. Without one: no TLS
 * option (a loopback database).
 */
export function databaseTls(caCertificate: string | undefined): Pick<PostgresPoolConfig, 'ssl'> {
  return caCertificate === undefined
    ? {}
    : { ssl: { ca: caCertificate, rejectUnauthorized: true } };
}
