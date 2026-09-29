/**
 * @sheet-music/persistence-postgres/testing
 *
 * Test-database harness for integration suites (docs/architecture/DATABASE.md
 * "Test harness"). Test code only: never import it from production code.
 *
 * - createTestDatabase: drop and recreate a `sheet_music_*` database on the
 *   server of TEST_DATABASE_URL, apply the Supabase compatibility bootstrap,
 *   then every supabase/migrations file in order.
 * - asScoreOwner: run a callback in one transaction on the server's user
 *   path (role score_owner, owner setting), exactly as the adapter does.
 * - withRole / asUser / asAnon: run a callback in one transaction under a
 *   Supabase API role with JWT claims, the way PostgREST does for a Data API
 *   or GraphQL request.
 * - seedTestUsers: insert the F12 users A and B into auth.users.
 * - TEST_DATABASE_CA_CERT: a CA certificate for DATABASE_CA_CERT that no
 *   server can match (TLS refusal tests).
 */
import { readFile, readdir } from 'node:fs/promises';
import { Client, Pool, escapeIdentifier, type PoolClient } from 'pg';
import { OWNER_SETTING, USER_PATH_ROLE } from '../src/access';

/** Test databases are named `sheet_music_` + lowercase letters, digits or underscores (63 bytes max). */
const TEST_DATABASE_NAME = /^sheet_music_[a-z0-9_]{1,51}$/;

/** A database that exists on every PostgreSQL server, used to drop and create the test database. */
const MAINTENANCE_DATABASE = 'postgres';

const BOOTSTRAP_FILE = new URL('./supabase-bootstrap.sql', import.meta.url);
const MIGRATIONS_DIRECTORY = new URL('../../../supabase/migrations/', import.meta.url);

export interface TestDatabase {
  /** The database name (`sheet_music_*`). */
  readonly name: string;
  /** Connection URL of the database: same server and credentials as TEST_DATABASE_URL. */
  readonly url: string;
  /**
   * Pool connected as the TEST_DATABASE_URL role (a superuser locally and in
   * CI): the privileged path. It bypasses RLS; use it to seed and to check
   * data, and asScoreOwner/withRole/asUser/asAnon for the limited roles.
   */
  readonly admin: Pool;
  /** Ends the admin pool. Call it in afterAll. The database is kept for inspection. */
  close(): Promise<void>;
}

/**
 * Throws unless `name` is a valid test database name (`sheet_music_` prefix,
 * then lowercase letters, digits or underscores). Nothing else may be dropped.
 */
export function assertTestDatabaseName(name: string): void {
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(
      `Refusing to use database "${name}": test databases must match ${String(TEST_DATABASE_NAME)}.`,
    );
  }
}

/** The database name in TEST_DATABASE_URL (the integration project always sets it). */
export function testDatabaseNameFromEnv(): string {
  return new URL(requireTestDatabaseUrl()).pathname.replace(/^\//, '');
}

/**
 * Drops (terminating its connections) and recreates the test database `name`
 * on the server of TEST_DATABASE_URL, then applies the Supabase compatibility
 * bootstrap and every `supabase/migrations/*.sql` file in name order, each in
 * one transaction. Defaults to the database named by TEST_DATABASE_URL.
 */
export async function createTestDatabase(
  name: string = testDatabaseNameFromEnv(),
): Promise<TestDatabase> {
  assertTestDatabaseName(name);
  const serverUrl = requireTestDatabaseUrl();

  const maintenance = new Client({
    connectionString: urlWithDatabase(serverUrl, MAINTENANCE_DATABASE),
  });
  await maintenance.connect();
  try {
    await maintenance.query(`drop database if exists ${escapeIdentifier(name)} with (force)`);
    await maintenance.query(`create database ${escapeIdentifier(name)}`);
  } finally {
    await maintenance.end();
  }

  const url = urlWithDatabase(serverUrl, name);
  const admin = new Pool({ connectionString: url, max: 4 });
  try {
    await runSqlFile(admin, BOOTSTRAP_FILE);
    for (const file of await migrationFiles()) {
      await runSqlFile(admin, file);
    }
  } catch (error) {
    await admin.end();
    throw error;
  }
  return { name, url, admin, close: () => admin.end() };
}

/** A role a test can act as: the server's user-path role or a Supabase API role. */
export type TestRole = typeof USER_PATH_ROLE | 'anon' | 'authenticated';

/** JWT claims as PostgREST exposes them in `request.jwt.claims`. */
export type JwtClaims = Readonly<Record<string, unknown>>;

/** Transaction-local settings a test applies after switching role. */
export interface RoleSettings {
  /** `request.jwt.claims`, as PostgREST sets it for a Data API request. */
  readonly claims?: JwtClaims;
  /** The user-path owner (`sheet_music.owner_id`), as the adapter sets it. */
  readonly ownerId?: string;
}

const TEST_ROLES: readonly TestRole[] = [USER_PATH_ROLE, 'anon', 'authenticated'];

/**
 * Runs `work` in one transaction as `role` with `settings`: `set local role`
 * and `set_config(..., true)`, all reverted at the end of the transaction.
 * Commits when `work` resolves, rolls back and rethrows when it rejects.
 * After a failed statement the transaction is aborted: end the callback there
 * and check the data with the admin pool.
 */
export async function withRole<T>(
  pool: Pool,
  role: TestRole,
  settings: RoleSettings,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!TEST_ROLES.includes(role)) {
    throw new Error(`Unknown test role "${String(role)}".`);
  }
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('begin');
    await client.query(`set local role ${escapeIdentifier(role)}`);
    if (settings.claims !== undefined) {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(settings.claims),
      ]);
    }
    if (settings.ownerId !== undefined) {
      await client.query(`select set_config($1, $2, true)`, [OWNER_SETTING, settings.ownerId]);
    }
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw error;
  } finally {
    // A client whose rollback failed is destroyed instead of returned to the pool.
    client.release(broken);
  }
}

/** Runs `work` on the server's user path for `userId`: role score_owner, owner setting = `userId`. */
export function asScoreOwner<T>(
  pool: Pool,
  userId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withRole(pool, USER_PATH_ROLE, { ownerId: userId }, work);
}

/** The claims Supabase Auth puts in a signed-in user's access token (the subset PostgREST passes on). */
export function authenticatedClaims(userId: string): JwtClaims {
  return { sub: userId, role: 'authenticated', aud: 'authenticated' };
}

/** Runs `work` as a Data API request carrying `userId`'s own access token (role `authenticated`). */
export function asUser<T>(
  pool: Pool,
  userId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withRole(pool, 'authenticated', { claims: authenticatedClaims(userId) }, work);
}

/** Runs `work` as an anonymous Data API caller (role `anon`). */
export function asAnon<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withRole(pool, 'anon', { claims: { role: 'anon' } }, work);
}

export interface TestUser {
  readonly id: string;
  readonly email: string;
}

/** F12 user A. Fixed UUID; the email domain is reserved for tests (never a real tester). */
export const TEST_USER_A: TestUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'user-a@example.test',
};

/** F12 user B. */
export const TEST_USER_B: TestUser = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'user-b@example.test',
};

/**
 * A self-signed CA certificate for DATABASE_CA_CERT in tests. Its private key
 * was discarded when it was made, so no server certificate can chain to it: a
 * connection that verifies against it never succeeds, and the local test
 * servers offer no TLS at all.
 */
export const TEST_DATABASE_CA_CERT = `-----BEGIN CERTIFICATE-----
MIIB3jCCAYWgAwIBAgIUOQPrxXmBGROM1Z9ECrM1P+mhazswCgYIKoZIzj0EAwIw
RDFCMEAGA1UEAww5U2hlZXQgTXVzaWMgZm9yIEFJIHRlc3QgZGF0YWJhc2UgQ0Eg
KG5vIHByaXZhdGUga2V5IGtlcHQpMCAXDTI2MDkyOTEwMTY1NFoYDzIxMjYwOTA1
MTAxNjU0WjBEMUIwQAYDVQQDDDlTaGVldCBNdXNpYyBmb3IgQUkgdGVzdCBkYXRh
YmFzZSBDQSAobm8gcHJpdmF0ZSBrZXkga2VwdCkwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAQj/0u/jiAfv7uDduDh5s9mpCpbLpaemWLiWyYl0IBhaodt9wJGApOu
WoCoVVG7JWXMwLLQ+lkk8Z2cMI5Wr2teo1MwUTAdBgNVHQ4EFgQUmXlWHKc20TsA
bUDsnnQEMFYyA+QwHwYDVR0jBBgwFoAUmXlWHKc20TsAbUDsnnQEMFYyA+QwDwYD
VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiBo71x+1ABFPYLTmBcw4jEo
r6zfKpQEjBm8EulW816pAQIgG7jCgJp6ql2Z9RwrdndjrAhWKGpx0H69Q9zZdSnr
88c=
-----END CERTIFICATE-----
`;

/** Inserts `users` (default: A and B) into auth.users through the privileged pool. */
export async function seedTestUsers(
  pool: Pool,
  users: readonly TestUser[] = [TEST_USER_A, TEST_USER_B],
): Promise<void> {
  for (const user of users) {
    await pool.query('insert into auth.users (id, email) values ($1, $2)', [user.id, user.email]);
  }
}

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('TEST_DATABASE_URL is not set (the Vitest integration project sets it).');
  }
  return url;
}

function urlWithDatabase(serverUrl: string, database: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function migrationFiles(): Promise<URL[]> {
  const names = (await readdir(MIGRATIONS_DIRECTORY))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return names.map((name) => new URL(name, MIGRATIONS_DIRECTORY));
}

/** Runs one SQL file as a single multi-statement query: one implicit transaction. */
async function runSqlFile(pool: Pool, file: URL): Promise<void> {
  const sql = await readFile(file, 'utf8');
  try {
    await pool.query(sql);
  } catch (error) {
    throw new Error(`Applying ${file.pathname} failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
