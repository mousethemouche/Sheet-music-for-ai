/**
 * The two database access paths of DATABASE.md §3 and the read-back of
 * stored ScoreSpecs.
 *
 * - User path (`asOwner`): every owner-scoped port call runs in ONE
 *   transaction as the role `score_owner`, with the owner in the
 *   `sheet_music.owner_id` setting, so Row Level Security applies to the
 *   server's own statements. No Supabase API role (anon, authenticated,
 *   service_role) can reach the score tables, and none can switch to
 *   score_owner. Both settings are transaction-local (`set_config(..., true)`),
 *   so nothing survives into the next user of a pooled connection, including
 *   behind Supavisor's transaction mode. Statements keep their explicit
 *   `owner_user_id` filter anyway.
 * - Privileged path (`privilegedQuery`): one statement as the pool's own role
 *   (the table owner), for server-only functions that touch no user row by
 *   owner (rate limiting, expired-draft cleanup).
 */
import {
  type ScoreId,
  type UserId,
  StoredScoreUnreadableError,
} from '@sheet-music/music-application';
import { type ScoreSpec, validateScoreSpec } from '@sheet-music/music-domain';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { PersistenceError } from './errors';

/** The role of the user path (supabase/migrations: `score_owner`). */
export const USER_PATH_ROLE = 'score_owner';
/** The transaction-local setting the RLS policies read the owner from (private.current_owner_id()). */
export const OWNER_SETTING = 'sheet_music.owner_id';

const ENTER_USER_PATH = `select set_config('role', '${USER_PATH_ROLE}', true),
  set_config('${OWNER_SETTING}', $1, true)`;

/**
 * Runs `work` in one transaction on the user path of `owner`. Commits when
 * `work` resolves; otherwise rolls back and rejects with a PersistenceError
 * (StoredScoreUnreadableError passes through unwrapped). A connection whose
 * rollback fails is discarded, not returned to the pool.
 */
export async function asOwner<T>(
  pool: Pool,
  operation: string,
  owner: UserId,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new PersistenceError(operation, error);
  }
  // A connection lost while checked out also emits 'error' on the client;
  // without a listener that event would crash the process. The pending query
  // rejects with the same error, which is handled below.
  const ignoreClientError = (): void => {};
  client.on('error', ignoreClientError);
  let broken: Error | undefined;
  try {
    await client.query('begin');
    await client.query(ENTER_USER_PATH, [owner]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw error instanceof StoredScoreUnreadableError
      ? error
      : new PersistenceError(operation, error);
  } finally {
    client.removeListener('error', ignoreClientError);
    client.release(broken);
  }
}

/** One statement on the privileged path; any failure rejects with a PersistenceError. */
export async function privilegedQuery<R extends QueryResultRow>(
  pool: Pool,
  operation: string,
  text: string,
  values: readonly unknown[],
): Promise<QueryResult<R>> {
  try {
    return await pool.query<R>(text, [...values]);
  } catch (error) {
    throw new PersistenceError(operation, error);
  }
}

/** The only row of a result that always has exactly one (a function call, an aggregate). */
export function singleRow<R>(operation: string, rows: readonly R[]): R {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new PersistenceError(operation, new Error(`Expected one row, got ${rows.length}.`));
  }
  return row;
}

/**
 * Reads a stored ScoreSpec back through domain validation (ADR-006). A
 * document this build cannot read (an unknown version, an invalid document)
 * throws StoredScoreUnreadableError; the row is never rewritten. ScoreSpec v1
 * is the only version so far, so there is no read-upgrade step yet.
 */
export function readStoredSpec(
  table: 'score_drafts' | 'scores',
  id: ScoreId,
  stored: unknown,
): ScoreSpec {
  const result = validateScoreSpec(stored);
  if (!result.ok) {
    const error = new StoredScoreUnreadableError();
    // For server logs only: the use cases never serialize the cause.
    error.cause = { table, id, error: result.error };
    throw error;
  }
  return result.value;
}
