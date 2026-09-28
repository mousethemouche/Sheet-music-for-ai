/**
 * RLS-02 write (issue #27): on the server's user path (role score_owner), an
 * owner inserts and edits only their own drafts and saved scores. A forged
 * owner, a cross-user update or delete, an upsert over a foreign row, an
 * ownership transfer and an ID change fail, and the stored data is left
 * exactly as it was. Writes that no flow exposes (deleting or renaming a saved
 * score) are denied by missing privileges. A Data API request, even with the
 * owner's own token, can write nothing: no never-expiring draft, no saved
 * score without promotion, no squatting of another user's draft ID. The
 * owner is immutable on every path, each defense layer holding on its own.
 */
import type { PoolClient, QueryResult } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asAnon,
  asScoreOwner,
  asUser,
  createTestDatabase,
  seedTestUsers,
  type TestDatabase,
} from '../../testing';
import {
  A,
  B,
  DRAFTS,
  SAVED,
  editDraft,
  editSaved,
  insertDraft,
  insertSaved,
  seedScores,
  storedDrafts,
  storedSaved,
  type DraftRow,
  type SavedRow,
} from './dataset';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
});

beforeEach(async () => {
  await seedScores(db.admin);
});

afterAll(async () => {
  await db?.close();
});

/** A: the user path of A. A's token: a Data API request carrying A's own access token. */
type Caller = 'A' | "A's token" | 'anonymous';
type Work = (client: PoolClient) => Promise<QueryResult>;

/** Either the number of rows the statement affected, or the error it raised. */
type Outcome = { rowCount: number } | { error: { code: string; message: unknown } };

const RLS_VIOLATION = (table: string) => ({
  code: '42501',
  message: expect.stringMatching(
    new RegExp(`^new row violates row-level security policy .*"${table}"$`),
  ) as unknown,
});
const PERMISSION_DENIED = (table: string) => ({
  code: '42501',
  message: `permission denied for table ${table}`,
});
const DUPLICATE_ID = (table: string) => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${table}_pkey"`,
});

async function run(caller: Caller, work: Work): Promise<Outcome> {
  try {
    const result =
      caller === 'A'
        ? await asScoreOwner(db.admin, A, work)
        : caller === "A's token"
          ? await asUser(db.admin, A, work)
          : await asAnon(db.admin, work);
    return { rowCount: result.rowCount ?? 0 };
  } catch (error) {
    const { code, message } = error as { code: string; message: string };
    return { error: { code, message } };
  }
}

const draft = (id: string, owner: string, revision = 1): DraftRow => ({ id, owner, revision });
const saved = (id: string, owner: string, revision = 1): SavedRow => ({
  id,
  owner,
  revision,
  title: 'New Piece',
  tags: ['new'],
});
const byId = <T extends { id: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((left, right) => left.id.localeCompare(right.id));

describe('RLS-02 drafts', () => {
  const unchanged = DRAFTS;

  it.each<{
    name: string;
    caller: Caller;
    work: Work;
    outcome: Outcome;
    stored: readonly DraftRow[];
  }>([
    {
      name: 'A inserts an own draft',
      caller: 'A',
      work: (client) => insertDraft(client, draft('scr_new', A)),
      outcome: { rowCount: 1 },
      stored: byId([...DRAFTS, draft('scr_new', A)]),
    },
    {
      name: 'A inserts a draft owned by B (forged owner)',
      caller: 'A',
      work: (client) => insertDraft(client, draft('scr_new', B)),
      outcome: { error: RLS_VIOLATION('score_drafts') },
      stored: unchanged,
    },
    {
      name: "A inserts a draft reusing the ID of B's draft",
      caller: 'A',
      work: (client) => insertDraft(client, draft('scr_draft_b1', A)),
      outcome: { error: DUPLICATE_ID('score_drafts') },
      stored: unchanged,
    },
    {
      name: 'A edits its own draft at the expected revision',
      caller: 'A',
      work: (client) => editDraft(client, 'scr_draft_a1', 1),
      outcome: { rowCount: 1 },
      stored: [draft('scr_draft_a1', A, 2), ...DRAFTS.slice(1)],
    },
    {
      name: "A edits B's draft by ID",
      caller: 'A',
      work: (client) => editDraft(client, 'scr_draft_b1', 2),
      outcome: { rowCount: 0 },
      stored: unchanged,
    },
    {
      name: "A overwrites B's draft with an upsert",
      caller: 'A',
      work: (client) =>
        client.query(
          `insert into public.score_drafts
             (id, owner_user_id, score_spec, score_spec_version, revision, created_at, updated_at, expires_at)
           values ($1, $2, jsonb_build_object('version', 1, 'id', $1::text, 'revision', 9), 1, 9,
                   now(), now(), now() + interval '1 day')
           on conflict (id) do update set score_spec = excluded.score_spec, revision = excluded.revision`,
          ['scr_draft_b1', A],
        ),
      outcome: { error: RLS_VIOLATION('score_drafts') },
      stored: unchanged,
    },
    {
      name: 'A transfers its own draft to B',
      caller: 'A',
      work: (client) =>
        client.query('update public.score_drafts set owner_user_id = $2 where id = $1', [
          'scr_draft_a1',
          B,
        ]),
      outcome: { error: PERMISSION_DENIED('score_drafts') },
      stored: unchanged,
    },
    {
      name: "A changes its own draft's ID",
      caller: 'A',
      work: (client) =>
        client.query('update public.score_drafts set id = $2 where id = $1', [
          'scr_draft_a1',
          'scr_renamed',
        ]),
      outcome: { error: PERMISSION_DENIED('score_drafts') },
      stored: unchanged,
    },
    {
      name: 'A deletes its own draft',
      caller: 'A',
      work: (client) =>
        client.query('delete from public.score_drafts where id = $1', ['scr_draft_a1']),
      outcome: { rowCount: 1 },
      stored: DRAFTS.slice(1),
    },
    {
      name: "A deletes B's draft by ID",
      caller: 'A',
      work: (client) =>
        client.query('delete from public.score_drafts where id = $1', ['scr_draft_b1']),
      outcome: { rowCount: 0 },
      stored: unchanged,
    },
    {
      name: "A's token inserts an own draft that never expires (bypassing the TTL)",
      caller: "A's token",
      work: (client) =>
        client.query(
          `insert into public.score_drafts
             (id, owner_user_id, score_spec, score_spec_version, revision, created_at, updated_at, expires_at)
           values ($1, $2, jsonb_build_object('version', 1, 'id', $1::text, 'revision', 1), 1, 1,
                   now(), now(), '9999-01-01')`,
          ['scr_forever', A],
        ),
      outcome: { error: PERMISSION_DENIED('score_drafts') },
      stored: unchanged,
    },
    {
      name: "A's token extends the expiry of A's own draft",
      caller: "A's token",
      work: (client) =>
        client.query(`update public.score_drafts set expires_at = '9999-01-01' where id = $1`, [
          'scr_draft_a1',
        ]),
      outcome: { error: PERMISSION_DENIED('score_drafts') },
      stored: unchanged,
    },
    {
      name: "A's token deletes A's own draft",
      caller: "A's token",
      work: (client) =>
        client.query('delete from public.score_drafts where id = $1', ['scr_draft_a1']),
      outcome: { error: PERMISSION_DENIED('score_drafts') },
      stored: unchanged,
    },
    {
      name: 'anonymous inserts a draft for A',
      caller: 'anonymous',
      work: (client) => insertDraft(client, draft('scr_new', A)),
      outcome: { error: PERMISSION_DENIED('score_drafts') },
      stored: unchanged,
    },
    {
      name: "anonymous edits A's draft",
      caller: 'anonymous',
      work: (client) => editDraft(client, 'scr_draft_a1', 1),
      outcome: { error: PERMISSION_DENIED('score_drafts') },
      stored: unchanged,
    },
    {
      name: "anonymous deletes A's draft",
      caller: 'anonymous',
      work: (client) =>
        client.query('delete from public.score_drafts where id = $1', ['scr_draft_a1']),
      outcome: { error: PERMISSION_DENIED('score_drafts') },
      stored: unchanged,
    },
  ])('$name', async ({ caller, work, outcome, stored }) => {
    expect(await run(caller, work)).toEqual(outcome);
    expect(await storedDrafts(db.admin)).toEqual(stored);
  });
});

describe('RLS-02 saved scores', () => {
  const unchanged = SAVED;

  it.each<{
    name: string;
    caller: Caller;
    work: Work;
    outcome: Outcome;
    stored: readonly SavedRow[];
  }>([
    {
      name: 'A inserts an own saved score (the promotion insert)',
      caller: 'A',
      work: (client) => insertSaved(client, saved('scr_new', A)),
      outcome: { rowCount: 1 },
      stored: byId([...SAVED, saved('scr_new', A)]),
    },
    {
      name: 'A inserts a saved score owned by B (forged owner)',
      caller: 'A',
      work: (client) => insertSaved(client, saved('scr_new', B)),
      outcome: { error: RLS_VIOLATION('scores') },
      stored: unchanged,
    },
    {
      name: 'A edits its own saved score at the expected revision',
      caller: 'A',
      work: (client) => editSaved(client, 'scr_saved_a1', 3),
      outcome: { rowCount: 1 },
      stored: [{ ...SAVED[0]!, revision: 4 }, ...SAVED.slice(1)],
    },
    {
      name: "A edits B's saved score by ID",
      caller: 'A',
      work: (client) => editSaved(client, 'scr_saved_b1', 2),
      outcome: { rowCount: 0 },
      stored: unchanged,
    },
    {
      name: "A overwrites B's saved score with an upsert",
      caller: 'A',
      work: (client) =>
        client.query(
          `insert into public.scores
             (id, owner_user_id, score_spec, score_spec_version, revision, title, tags, created_at, updated_at)
           values ($1, $2, jsonb_build_object('version', 1, 'id', $1::text, 'revision', 9), 1, 9,
                   'Taken', '{}', now(), now())
           on conflict (id) do update set score_spec = excluded.score_spec, revision = excluded.revision`,
          ['scr_saved_b1', A],
        ),
      outcome: { error: RLS_VIOLATION('scores') },
      stored: unchanged,
    },
    {
      name: 'A transfers its own saved score to B',
      caller: 'A',
      work: (client) =>
        client.query('update public.scores set owner_user_id = $2 where id = $1', [
          'scr_saved_a1',
          B,
        ]),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
    {
      name: 'A renames its own saved score (library metadata is not editable in MVP)',
      caller: 'A',
      work: (client) =>
        client.query(`update public.scores set title = 'Renamed', tags = '{x}' where id = $1`, [
          'scr_saved_a1',
        ]),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
    {
      name: 'A deletes its own saved score (no flow deletes saved scores)',
      caller: 'A',
      work: (client) => client.query('delete from public.scores where id = $1', ['scr_saved_a1']),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
    {
      name: "A deletes B's saved score by ID",
      caller: 'A',
      work: (client) => client.query('delete from public.scores where id = $1', ['scr_saved_b1']),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
    {
      name: "A's token inserts an own saved score directly (no promotion, no validation)",
      caller: "A's token",
      work: (client) =>
        client.query(
          `insert into public.scores
             (id, owner_user_id, score_spec, score_spec_version, revision, title, tags, created_at, updated_at)
           values ($1, $2, jsonb_build_object('version', 1, 'id', $1::text, 'revision', 1, 'junk', true),
                   1, 1, 'Direct', '{}', now(), now())`,
          ['scr_direct', A],
        ),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
    {
      name: "A's token takes the ID of B's draft as a saved score, blocking B's save",
      caller: "A's token",
      work: (client) => insertSaved(client, saved('scr_draft_b1', A)),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
    {
      name: "A's token edits A's own saved score",
      caller: "A's token",
      work: (client) => editSaved(client, 'scr_saved_a1', 3),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
    {
      name: 'anonymous inserts a saved score for A',
      caller: 'anonymous',
      work: (client) => insertSaved(client, saved('scr_new', A)),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
    {
      name: "anonymous edits A's saved score",
      caller: 'anonymous',
      work: (client) => editSaved(client, 'scr_saved_a1', 3),
      outcome: { error: PERMISSION_DENIED('scores') },
      stored: unchanged,
    },
  ])('$name', async ({ caller, work, outcome, stored }) => {
    expect(await run(caller, work)).toEqual(outcome);
    expect(await storedSaved(db.admin)).toEqual(stored);
  });
});

describe('RLS-02 the owner is immutable, each layer on its own', () => {
  const TABLES = [
    {
      table: 'score_drafts',
      id: 'scr_draft_a1',
      trigger: 'score_drafts_identity_immutable',
      stored: storedDrafts,
    },
    {
      table: 'scores',
      id: 'scr_saved_a1',
      trigger: 'scores_identity_immutable',
      stored: storedSaved,
    },
  ] as const;

  it.each(TABLES)(
    "the UPDATE policy's WITH CHECK alone rejects a transfer of $table (column grant widened, trigger disabled)",
    async ({ table, id, trigger, stored }) => {
      const before = await stored(db.admin);
      const client = await db.admin.connect();
      try {
        await client.query('begin');
        // Remove the two other layers inside this transaction only.
        await client.query(`grant update (owner_user_id) on table public.${table} to score_owner`);
        await client.query(`alter table public.${table} disable trigger ${trigger}`);
        await client.query('set local role score_owner');
        await client.query(`select set_config('sheet_music.owner_id', $1, true)`, [A]);
        await expect(
          client.query(`update public.${table} set owner_user_id = $2 where id = $1`, [id, B]),
        ).rejects.toMatchObject(RLS_VIOLATION(table));
      } finally {
        await client.query('rollback');
        client.release();
      }
      expect(await stored(db.admin)).toEqual(before);
    },
  );

  it.each(TABLES)(
    'the identity trigger alone rejects an owner or ID change of $table on the privileged path',
    async ({ table, id, stored }) => {
      const before = await stored(db.admin);
      const denied = {
        code: '23000',
        message: 'The id and the owner of a stored score cannot change.',
      };
      await expect(
        db.admin.query(`update public.${table} set owner_user_id = $2 where id = $1`, [id, B]),
      ).rejects.toMatchObject(denied);
      await expect(
        db.admin.query(`update public.${table} set id = 'scr_renamed' where id = $1`, [id]),
      ).rejects.toMatchObject(denied);
      expect(await stored(db.admin)).toEqual(before);
    },
  );
});
