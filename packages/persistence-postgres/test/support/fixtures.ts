/**
 * Shared inputs of the repository (#9) and draft lifecycle (#22) suites:
 * ScoreSpec documents with a given ID and revision, port records, stored-row
 * seeding and inspection through the privileged pool, and the real use cases
 * composed over the Postgres adapter.
 */
import {
  type Clock,
  type IdGenerator,
  type SavedScore,
  type ScoreDraft,
  CreateScore,
  EditScore,
  GetScore,
  SaveScore,
  createDraftExpiryPolicy,
} from '@sheet-music/music-application';
import type { ScoreSpec } from '@sheet-music/music-domain';
import { F01, cloneFixture, parseFixture } from '@sheet-music/test-fixtures';
import type { Pool } from 'pg';
import type { PostgresPersistence } from '../../src';
import { TEST_USER_A, TEST_USER_B } from '../../testing';

export const A = TEST_USER_A.id;
export const B = TEST_USER_B.id;
export const PRINCIPAL_A = Object.freeze({ userId: A });
export const PRINCIPAL_B = Object.freeze({ userId: B });

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
/** The production TTL (7 days), the one the use cases get below. */
export const TTL = createDraftExpiryPolicy().ttlMs;

/** F01 (a valid, canonical ScoreSpec v1) carrying `id` and `revision`. */
export function f01Spec(id: string, revision = 1, tempo = 120): ScoreSpec {
  return parseFixture({ ...cloneFixture(F01), id, revision, tempo: { bpm: tempo } });
}

/** A draft written at `writtenAt` (created then) with the production TTL. */
export function draftRecord(spec: ScoreSpec, writtenAt: Date, createdAt = writtenAt): ScoreDraft {
  return {
    spec,
    createdAt,
    updatedAt: writtenAt,
    expiresAt: new Date(writtenAt.getTime() + TTL),
  };
}

/** A draft whose expiry is exactly `expiresAt` (written one TTL earlier). */
export function draftExpiringAt(spec: ScoreSpec, expiresAt: Date): ScoreDraft {
  return draftRecord(spec, new Date(expiresAt.getTime() - TTL));
}

export function at(instant: string): Date {
  return new Date(instant);
}

export function clockAt(instant: Date): Clock {
  return { now: () => new Date(instant.getTime()) };
}

/** Issues `scr_<prefix>_1`, `scr_<prefix>_2`, ... */
export function sequentialIds(prefix: string): IdGenerator {
  let next = 0;
  return { newScoreId: () => `scr_${prefix}_${String((next += 1))}` };
}

/** The production use cases over the adapter, at a fixed request instant. */
export function useCasesAt(
  stores: Pick<PostgresPersistence, 'drafts' | 'saved' | 'promotion'>,
  now: Date,
  ids: IdGenerator = sequentialIds('unused'),
) {
  const deps = {
    drafts: stores.drafts,
    saved: stores.saved,
    promotion: stores.promotion,
    clock: clockAt(now),
    ids,
    expiry: createDraftExpiryPolicy(),
  };
  return {
    create: new CreateScore(deps),
    edit: new EditScore(deps),
    save: new SaveScore(deps),
    get: new GetScore(deps),
  };
}

/** One set_tempo edit command (a real ScoreOperation) at `expectedRevision`. */
export function tempoEdit(scoreId: string, expectedRevision: number, bpm: number) {
  return { scoreId, expectedRevision, operations: [{ type: 'set_tempo', bpm }] };
}

// ---------------------------------------------------------------------------
// Privileged seeding and inspection (bypasses RLS; never the code under test)
// ---------------------------------------------------------------------------

export interface SavedSeed {
  readonly id: string;
  readonly owner: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly updatedAt: Date;
  readonly createdAt?: Date;
  readonly spec?: unknown;
}

/** Inserts a saved score row as stored by a promotion (F01 content unless `spec` is given). */
export async function insertSavedRow(admin: Pool, seed: SavedSeed): Promise<void> {
  const spec = (seed.spec ?? f01Spec(seed.id)) as { version: number; revision: number };
  await admin.query(
    `insert into public.scores
       (id, owner_user_id, score_spec, score_spec_version, revision, title, tags, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      seed.id,
      seed.owner,
      JSON.stringify(spec),
      spec.version,
      spec.revision,
      seed.title,
      [...seed.tags],
      seed.createdAt ?? seed.updatedAt,
      seed.updatedAt,
    ],
  );
}

/** Inserts a draft row directly (for documents the adapter would never write). */
export async function insertDraftRow(
  admin: Pool,
  owner: string,
  spec: { readonly id: string; readonly version: number; readonly revision: number },
  expiresAt: Date,
): Promise<void> {
  const writtenAt = new Date(expiresAt.getTime() - TTL);
  await admin.query(
    `insert into public.score_drafts
       (id, owner_user_id, score_spec, score_spec_version, revision, created_at, updated_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [spec.id, owner, JSON.stringify(spec), spec.version, spec.revision, writtenAt, expiresAt],
  );
}

export interface StoredDraftRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly score_spec: Record<string, unknown>;
  readonly score_spec_version: number;
  readonly revision: number;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly expires_at: Date;
}

export interface StoredSavedRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly score_spec: Record<string, unknown>;
  readonly score_spec_version: number;
  readonly revision: number;
  readonly title: string;
  readonly tags: string[];
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** Every stored draft with this ID (0 or 1 row), whatever its owner. */
export async function storedDrafts(admin: Pool, id: string): Promise<StoredDraftRow[]> {
  const { rows } = await admin.query<StoredDraftRow>(
    'select * from public.score_drafts where id = $1',
    [id],
  );
  return rows;
}

/** Every stored saved score with this ID (0 or 1 row), whatever its owner. */
export async function storedSaved(admin: Pool, id: string): Promise<StoredSavedRow[]> {
  const { rows } = await admin.query<StoredSavedRow>('select * from public.scores where id = $1', [
    id,
  ]);
  return rows;
}

export async function emptyScoreTables(admin: Pool): Promise<void> {
  await admin.query('truncate public.score_drafts, public.scores');
}

/** The saved record a promotion of `spec` at `now` must produce. */
export function savedRecord(
  spec: ScoreSpec,
  title: string,
  tags: readonly string[],
  now: Date,
): SavedScore {
  return { spec, title, tags, createdAt: now, updatedAt: now };
}
