/**
 * Connection pool factory (DATABASE.md "Connections"). One pool per process,
 * shared by the user path (owner-scoped repositories and promotion) and the
 * privileged path (rate limiting, cleanup runner).
 */
import { Pool, type PoolConfig } from 'pg';

export interface PostgresPoolConfig {
  /**
   * `postgres://` URL of the server's database role (DATABASE_URL). On
   * Supabase: the Supavisor transaction pooler URL (port 6543) for serverless
   * instances. Parameters in the URL (for example `sslmode`) override `ssl`.
   */
  readonly connectionString: string;
  /** Maximum connections held by this process. Default 5. */
  readonly max?: number;
  /** TLS options passed to node-postgres; the servers build them with `databaseTls` (tls.ts). */
  readonly ssl?: PoolConfig['ssl'];
  /** How long a call waits for a connection before it fails. Default 5000 ms. */
  readonly connectionTimeoutMillis?: number;
  /** How long an unused connection stays open. Default 10000 ms. */
  readonly idleTimeoutMillis?: number;
  /**
   * Receives errors of idle connections (server restart, network drop). The
   * pool has already discarded the connection; the next call opens a new one.
   * Without this option such errors are ignored instead of crashing the process.
   */
  readonly onIdleError?: (error: Error) => void;
}

const DEFAULT_MAX_CONNECTIONS = 5;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;

/** Creates the process's pool. End it with `pool.end()` (or PostgresPersistence.close) on shutdown. */
export function createPostgresPool(config: PostgresPoolConfig): Pool {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.max ?? DEFAULT_MAX_CONNECTIONS,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: config.idleTimeoutMillis ?? DEFAULT_IDLE_TIMEOUT_MS,
    ...(config.ssl === undefined ? {} : { ssl: config.ssl }),
  });
  // An 'error' event without a listener would crash the process.
  pool.on('error', (error) => config.onIdleError?.(error));
  return pool;
}
