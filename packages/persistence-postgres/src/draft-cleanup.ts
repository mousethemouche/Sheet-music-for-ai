/**
 * Expired-draft cleanup runner (ADR-006, issue #22, DATABASE.md §5).
 *
 * In production the pg_cron job calls private.cleanup_expired_drafts inside
 * the database; there is no HTTP route. This runner calls the same function
 * over a server connection (privileged path: the table owner), for tests and
 * manual maintenance. The function deletes at most `batchSize` drafts with
 * `expires_at <= now`, skips drafts locked by an in-flight edit or promotion,
 * re-checks expiry when it deletes, and never touches saved scores.
 */
import type { Pool } from 'pg';
import { privilegedQuery, singleRow } from './access';

export interface ExpiredDraftCleanup {
  /** Deletes up to `batchSize` drafts expired at `now`; resolves to the number deleted. */
  run(now: Date, batchSize: number): Promise<number>;
}

export function createExpiredDraftCleanup(pool: Pool): ExpiredDraftCleanup {
  return {
    async run(now, batchSize) {
      const { rows } = await privilegedQuery<{ deleted: number }>(
        pool,
        'drafts.cleanup',
        'select private.cleanup_expired_drafts($1, $2) as deleted',
        [now, batchSize],
      );
      return singleRow('drafts.cleanup', rows).deleted;
    },
  };
}
