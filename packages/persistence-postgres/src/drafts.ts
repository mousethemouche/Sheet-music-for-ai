/**
 * ScoreDraftRepository over public.score_drafts (ADR-006,
 * APPLICATION_LAYER.md §3.4). Every call runs on the owner's user path.
 */
import type { ScoreDraft, ScoreDraftRepository } from '@sheet-music/music-application';
import type { Pool } from 'pg';
import { asOwner, readStoredSpec } from './access';

interface DraftRow {
  readonly score_spec: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly expires_at: Date;
}

export function createScoreDraftRepository(pool: Pool): ScoreDraftRepository {
  return {
    async create(owner, draft) {
      await asOwner(pool, 'drafts.create', owner, (client) =>
        client.query(
          `insert into public.score_drafts
             (id, owner_user_id, score_spec, score_spec_version, revision,
              created_at, updated_at, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            draft.spec.id,
            owner,
            JSON.stringify(draft.spec),
            draft.spec.version,
            draft.spec.revision,
            draft.createdAt,
            draft.updatedAt,
            draft.expiresAt,
          ],
        ),
      );
    },

    async get(owner, id) {
      const { rows } = await asOwner(pool, 'drafts.get', owner, (client) =>
        client.query<DraftRow>(
          `select score_spec, created_at, updated_at, expires_at
           from public.score_drafts
           where owner_user_id = $1 and id = $2`,
          [owner, id],
        ),
      );
      const [row] = rows;
      if (row === undefined) {
        return null;
      }
      const draft: ScoreDraft = {
        spec: readStoredSpec('score_drafts', id, row.score_spec),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      };
      return draft;
    },

    // Single compare-and-swap statement; created_at and the identity never change.
    async update(owner, draft, expectedRevision) {
      const { rowCount } = await asOwner(pool, 'drafts.update', owner, (client) =>
        client.query(
          `update public.score_drafts
           set score_spec = $4, score_spec_version = $5, revision = $6,
               updated_at = $7, expires_at = $8
           where owner_user_id = $1 and id = $2 and revision = $3`,
          [
            owner,
            draft.spec.id,
            expectedRevision,
            JSON.stringify(draft.spec),
            draft.spec.version,
            draft.spec.revision,
            draft.updatedAt,
            draft.expiresAt,
          ],
        ),
      );
      return rowCount === 1 ? 'updated' : 'stale';
    },

    async delete(owner, id) {
      await asOwner(pool, 'drafts.delete', owner, (client) =>
        client.query('delete from public.score_drafts where owner_user_id = $1 and id = $2', [
          owner,
          id,
        ]),
      );
    },
  };
}
