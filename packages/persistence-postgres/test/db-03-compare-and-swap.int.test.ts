/**
 * DB-03 compare-and-swap on the real database (issue #9), for both storage
 * paths (drafts and saved scores use separate statements).
 *
 * The race uses two adapter instances with their own pools, like two server
 * instances. A third connection holds the row so that both writes are in
 * flight at the same time (both observed waiting on the row lock), then lets
 * them go: exactly one reports 'updated', the other 'stale', and the stored
 * row moved by exactly one revision, with the winner's document. Writes that
 * cannot match (wrong revision, another owner, missing row) are 'stale' and
 * change nothing. Mapping 'stale' to REVISION_CONFLICT is #13's.
 */
import type { WriteOutcome } from '@sheet-music/music-application';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type PostgresPersistence, createPostgresPersistence } from '../src';
import { type TestDatabase, createTestDatabase, seedTestUsers } from '../testing';
import { Coordinator } from './support/coordination';
import {
  A,
  B,
  at,
  draftRecord,
  emptyScoreTables,
  f01Spec,
  insertSavedRow,
  storedDrafts,
  storedSaved,
} from './support/fixtures';

const ID = 'scr_db03';
const CREATED = at('2026-09-28T10:00:00.000Z');
const EDITED = at('2026-09-28T10:05:00.000Z');
const TITLE = 'Compare and swap';

let db: TestDatabase;
let coordinator: Coordinator;
let first: PostgresPersistence;
let second: PostgresPersistence;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
  coordinator = new Coordinator(db.admin);
  first = createPostgresPersistence({ connectionString: db.url, max: 1 });
  second = createPostgresPersistence({ connectionString: db.url, max: 1 });
});

beforeEach(async () => {
  await emptyScoreTables(db.admin);
});

afterEach(async () => {
  await coordinator.reset();
});

afterAll(async () => {
  await first?.close();
  await second?.close();
  await db?.close();
});

interface StoragePath {
  readonly name: string;
  readonly table: 'score_drafts' | 'scores';
  /** Stores the score at revision 1 (tempo 120) for A. */
  seed(): Promise<void>;
  /** Writes revision `expectedRevision + 1` with tempo `bpm` through `store`. */
  write(
    store: PostgresPersistence,
    owner: string,
    id: string,
    expectedRevision: number,
    bpm: number,
  ): Promise<WriteOutcome>;
  stored(id: string): Promise<{ revision: number; score_spec: Record<string, unknown> }[]>;
}

const PATHS: readonly StoragePath[] = [
  {
    name: 'draft',
    table: 'score_drafts',
    seed: () => first.drafts.create(A, draftRecord(f01Spec(ID), CREATED)),
    write: (store, owner, id, expectedRevision, bpm) =>
      store.drafts.update(
        owner,
        draftRecord(f01Spec(id, expectedRevision + 1, bpm), EDITED, CREATED),
        expectedRevision,
      ),
    stored: (id) => storedDrafts(db.admin, id),
  },
  {
    name: 'saved score',
    table: 'scores',
    seed: () =>
      insertSavedRow(db.admin, { id: ID, owner: A, title: TITLE, tags: [], updatedAt: CREATED }),
    write: (store, owner, id, expectedRevision, bpm) =>
      store.saved.update(
        owner,
        {
          spec: f01Spec(id, expectedRevision + 1, bpm),
          title: TITLE,
          tags: [],
          createdAt: CREATED,
          updatedAt: EDITED,
        },
        expectedRevision,
      ),
    stored: (id) => storedSaved(db.admin, id),
  },
];

describe.each(PATHS)('DB-03 $name compare-and-swap', (path) => {
  it('two instances writing the same revision at once: one commits, one is stale, one increment', async () => {
    await path.seed();

    const holder = await db.admin.connect();
    let writes: Promise<WriteOutcome>[];
    try {
      await holder.query('begin');
      await holder.query(`select 1 from public.${path.table} where id = $1 for update`, [ID]);
      writes = [path.write(first, A, ID, 1, 90), path.write(second, A, ID, 1, 60)];
      // Both writers are now blocked on the same row, at the same expected revision.
      await coordinator.lockWaiters(2);
      await holder.query('commit');
    } finally {
      // A no-op after the commit; ends the transaction if the test failed before it.
      await holder.query('rollback');
      holder.release();
    }
    const outcomes = await Promise.all(writes);

    expect([...outcomes].sort()).toEqual(['stale', 'updated']);
    const winnerTempo = outcomes[0] === 'updated' ? 90 : 60;
    const rows = await path.stored(ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      revision: 2,
      score_spec: { revision: 2, tempo: { bpm: winnerTempo } },
    });
  });

  it.each([
    { name: 'an older expected revision', owner: A, id: ID, expectedRevision: 0 },
    { name: 'a future expected revision', owner: A, id: ID, expectedRevision: 2 },
    {
      name: "another owner's write at the current revision",
      owner: B,
      id: ID,
      expectedRevision: 1,
    },
    { name: 'a missing score', owner: A, id: 'scr_db03_missing', expectedRevision: 1 },
  ])('$name is stale and changes nothing', async ({ owner, id, expectedRevision }) => {
    await path.seed();
    const before = await path.stored(ID);

    expect(await path.write(first, owner, id, expectedRevision, 90)).toBe('stale');

    expect(await path.stored(ID)).toEqual(before);
    expect(await path.stored('scr_db03_missing')).toEqual([]);
  });
});
