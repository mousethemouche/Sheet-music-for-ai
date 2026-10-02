/**
 * Atomic draft -> saved promotion (ADR-006, APPLICATION_LAYER.md §3.6,
 * DATABASE.md §4), in ONE user-path transaction of the owner:
 *
 * 1. lock the owner's draft `id` that is at `expectedRevision` and live at
 *    `now` (`expires_at > now`), or return `stale` and change nothing;
 * 2. insert the saved score: same ID, same ScoreSpec copied in SQL (same
 *    revision), the confirmed title and tags, created_at = updated_at = now;
 * 3. delete the draft.
 *
 * Any failure rolls the transaction back and rejects: the draft stays intact
 * and no saved row exists. The row lock of step 1 makes concurrent edits,
 * saves and cleanup wait or skip the draft, then see it gone (`stale`).
 */
import type { PromotionOutcome, ScorePromotion } from '@sheet-music/music-application';
import type { Pool } from 'pg';
import { asOwner, readStoredSpec } from './access';

export function createScorePromotion(pool: Pool): ScorePromotion {
  return {
    promote: (owner, request) =>
      asOwner(pool, 'promotion.promote', owner, async (client): Promise<PromotionOutcome> => {
        const locked = await client.query<{ score_spec: unknown }>(
          `select score_spec
           from public.score_drafts
           where owner_user_id = $1 and id = $2 and revision = $3 and expires_at > $4
           for update`,
          [owner, request.id, request.expectedRevision, request.now],
        );
        const [draft] = locked.rows;
        if (draft === undefined) {
          return { status: 'stale' };
        }
        // An unreadable draft is not promoted: the rollback keeps it as it is.
        const spec = readStoredSpec('score_drafts', request.id, draft.score_spec);

        const inserted = await client.query(
          `insert into public.scores
             (id, owner_user_id, score_spec, score_spec_version, revision,
              title, tags, created_at, updated_at)
           select id, owner_user_id, score_spec, score_spec_version, revision,
                  $3::text, $4::text[], $5::timestamptz, $5::timestamptz
           from public.score_drafts
           where owner_user_id = $1 and id = $2`,
          [owner, request.id, request.title, [...request.tags], request.now],
        );
        const deleted = await client.query(
          'delete from public.score_drafts where owner_user_id = $1 and id = $2',
          [owner, request.id],
        );
        // Both rows are held by this transaction, so anything else is a bug: roll back.
        if (inserted.rowCount !== 1 || deleted.rowCount !== 1) {
          throw new Error(
            `Promotion inserted ${String(inserted.rowCount)} and deleted ${String(deleted.rowCount)} rows.`,
          );
        }
        return {
          status: 'promoted',
          saved: {
            spec,
            title: request.title,
            tags: [...request.tags],
            createdAt: request.now,
            updatedAt: request.now,
          },
        };
      }),
  };
}
