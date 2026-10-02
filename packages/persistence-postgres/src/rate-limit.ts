/**
 * Shared fixed-window rate-limit counters (issue #24, DATABASE.md §6).
 *
 * `RateLimitStore` is the structural contract shared with server-common, which
 * declares the same shape; neither package imports the other. The counters
 * live in private.rate_limit_windows, so a limit holds across every server
 * instance. Privileged path: the function is not reachable by client roles.
 * Ended windows of keys that are never hit again are deleted by the pg_cron
 * job calling private.prune_rate_limit_windows (DATABASE.md §6).
 */
import type { Pool } from 'pg';
import { privilegedQuery, singleRow } from './access';

export interface RateLimitWindow {
  /** Hits counted in the window containing `now`, this one included. */
  readonly count: number;
  readonly windowStartedAt: Date;
  /** End of the window: the counter restarts at this instant. */
  readonly resetAt: Date;
}

export interface RateLimitStore {
  /**
   * Atomically increments the counter of the fixed window containing `now`
   * for `key` and returns the post-increment count. Windows are aligned on
   * multiples of `windowMs` since the Unix epoch; `windowMs` is any positive
   * safe integer of milliseconds (a bigint in SQL). A key must always be used
   * with the same window length. Rejects with a PersistenceError when the
   * store is unavailable.
   */
  hit(key: string, windowMs: number, now: Date): Promise<RateLimitWindow>;
}

interface WindowRow {
  readonly count: number;
  readonly window_started_at: Date;
  readonly reset_at: Date;
}

export function createPostgresRateLimitStore(pool: Pool): RateLimitStore {
  return {
    async hit(key, windowMs, now) {
      const { rows } = await privilegedQuery<WindowRow>(
        pool,
        'rateLimit.hit',
        'select count, window_started_at, reset_at from private.rate_limit_hit($1, $2, $3)',
        [key, windowMs, now],
      );
      const row = singleRow('rateLimit.hit', rows);
      return { count: row.count, windowStartedAt: row.window_started_at, resetAt: row.reset_at };
    },
  };
}
