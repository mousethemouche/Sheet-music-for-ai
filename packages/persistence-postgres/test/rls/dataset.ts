/**
 * Shared rows and SQL of the direct RLS suite (RLS-01..03, issue #27).
 *
 * F12 subset: users A and B, each with drafts and saved scores in different
 * numbers, so a leaked row or a leaked total shows up. Every statement targets
 * rows by ID only, never by owner, so any isolation observed comes from Row
 * Level Security and grants, not from the query.
 */
import { F01, cloneFixture } from '@sheet-music/test-fixtures';
import type { Pool, QueryResult } from 'pg';
import { TEST_USER_A, TEST_USER_B } from '../../testing';

export const A = TEST_USER_A.id;
export const B = TEST_USER_B.id;

const CREATED_AT = new Date('2026-09-28T10:00:00.000Z');
const EXPIRES_AT = new Date('2026-10-05T10:00:00.000Z');
const EDITED_AT = new Date('2026-09-29T10:00:00.000Z');
const EDITED_EXPIRES_AT = new Date('2026-10-06T10:00:00.000Z');

export interface DraftRow {
  readonly id: string;
  readonly owner: string;
  readonly revision: number;
}

export interface SavedRow extends DraftRow {
  readonly title: string;
  readonly tags: readonly string[];
}

export const DRAFTS: readonly DraftRow[] = [
  { id: 'scr_draft_a1', owner: A, revision: 1 },
  { id: 'scr_draft_b1', owner: B, revision: 2 },
  { id: 'scr_draft_b2', owner: B, revision: 1 },
];

export const SAVED: readonly SavedRow[] = [
  { id: 'scr_saved_a1', owner: A, revision: 3, title: 'Autumn Leaves', tags: ['jazz'] },
  { id: 'scr_saved_a2', owner: A, revision: 1, title: 'Etude in C', tags: [] },
  { id: 'scr_saved_b1', owner: B, revision: 2, title: 'Blue Monk', tags: ['jazz', 'blues'] },
];

/** A real ScoreSpec document (F01) carrying the row's ID and revision, as the constraints require. */
export function scoreSpec(id: string, revision: number): string {
  return JSON.stringify({ ...cloneFixture(F01), id, revision });
}

type Queryable = Pick<Pool, 'query'>;

export function insertDraft(db: Queryable, row: DraftRow): Promise<QueryResult> {
  return db.query(
    `insert into public.score_drafts
       (id, owner_user_id, score_spec, score_spec_version, revision, created_at, updated_at, expires_at)
     values ($1, $2, $3, 1, $4, $5, $5, $6)`,
    [row.id, row.owner, scoreSpec(row.id, row.revision), row.revision, CREATED_AT, EXPIRES_AT],
  );
}

export function insertSaved(db: Queryable, row: SavedRow): Promise<QueryResult> {
  return db.query(
    `insert into public.scores
       (id, owner_user_id, score_spec, score_spec_version, revision, title, tags, created_at, updated_at)
     values ($1, $2, $3, 1, $4, $5, $6, $7, $7)`,
    [
      row.id,
      row.owner,
      scoreSpec(row.id, row.revision),
      row.revision,
      row.title,
      row.tags,
      CREATED_AT,
    ],
  );
}

/** Compare-and-swap edit of a draft by ID and expected revision: the new revision, a new TTL. */
export function editDraft(
  db: Queryable,
  id: string,
  expectedRevision: number,
): Promise<QueryResult> {
  const revision = expectedRevision + 1;
  return db.query(
    `update public.score_drafts
     set score_spec = $3, revision = $4, updated_at = $5, expires_at = $6
     where id = $1 and revision = $2`,
    [id, expectedRevision, scoreSpec(id, revision), revision, EDITED_AT, EDITED_EXPIRES_AT],
  );
}

/** Compare-and-swap edit of a saved score by ID and expected revision. */
export function editSaved(
  db: Queryable,
  id: string,
  expectedRevision: number,
): Promise<QueryResult> {
  const revision = expectedRevision + 1;
  return db.query(
    `update public.scores
     set score_spec = $3, revision = $4, updated_at = $5
     where id = $1 and revision = $2`,
    [id, expectedRevision, scoreSpec(id, revision), revision, EDITED_AT],
  );
}

/** Empties both tables and inserts DRAFTS and SAVED through the privileged pool. */
export async function seedScores(admin: Pool): Promise<void> {
  await admin.query('truncate public.score_drafts, public.scores');
  for (const row of DRAFTS) await insertDraft(admin, row);
  for (const row of SAVED) await insertSaved(admin, row);
}

/** Every stored draft as { id, owner, revision }, read through the privileged pool. */
export async function storedDrafts(admin: Pool): Promise<DraftRow[]> {
  const { rows } = await admin.query<DraftRow>(
    'select id, owner_user_id as owner, revision from public.score_drafts order by id',
  );
  return rows;
}

/** Every stored saved score as { id, owner, revision, title, tags }, read through the privileged pool. */
export async function storedSaved(admin: Pool): Promise<SavedRow[]> {
  const { rows } = await admin.query<SavedRow>(
    'select id, owner_user_id as owner, revision, title, tags from public.scores order by id',
  );
  return rows;
}

/** The IDs a query returns, in order. */
export async function ids(result: Promise<QueryResult<{ id: string }>>): Promise<string[]> {
  return (await result).rows.map((row) => row.id);
}
