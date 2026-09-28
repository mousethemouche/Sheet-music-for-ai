/**
 * DRAFT-03 expired-draft cleanup (issue #22, ADR-006, DATABASE.md §5), with
 * the real SQL function through the cleanup runner. Cleanup is SQL-scheduled
 * (pg_cron), so there is no route to test.
 *
 * Dataset at the cleanup instant T: A's draft expired two days before, B's
 * draft expired one hour before, A's draft expiring exactly at T (dead from T
 * on), A's draft expiring 1 ms after T, and A's saved score.
 *
 * - An expired draft is unreachable (get, edit, save) from its expiry instant,
 *   while its row still exists.
 * - Cleanup deletes exactly the expired drafts of every owner, never a live
 *   draft or a saved score, is bounded by its batch size and is repeatable.
 * - Interleavings, coordinated with row locks (no sleeps): a refresh in
 *   flight makes cleanup skip the draft, which survives with its new expiry;
 *   a deletion in flight makes the concurrent edit fail with
 *   REVISION_CONFLICT, never a phantom success.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ExpiredDraftCleanup,
  type PostgresPersistence,
  createExpiredDraftCleanup,
  createPostgresPersistence,
  createPostgresPool,
} from '../src';
import { type TestDatabase, createTestDatabase, seedTestUsers } from '../testing';
import { Coordinator } from './support/coordination';
import {
  A,
  B,
  DAY,
  HOUR,
  PRINCIPAL_A,
  TTL,
  at,
  draftExpiringAt,
  emptyScoreTables,
  f01Spec,
  insertSavedRow,
  storedDrafts,
  storedSaved,
  tempoEdit,
  useCasesAt,
} from './support/fixtures';

const T = at('2026-10-10T00:00:00.000Z');
const before = (ms: number) => new Date(T.getTime() - ms);

let db: TestDatabase;
let coordinator: Coordinator;
let store: PostgresPersistence;
let cleanupPool: ReturnType<typeof createPostgresPool>;
let cleanup: ExpiredDraftCleanup;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
  coordinator = new Coordinator(db.admin);
  store = createPostgresPersistence({ connectionString: db.url });
  // The cleanup runs on the privileged path, like the pg_cron job, on its own connection.
  cleanupPool = createPostgresPool({ connectionString: db.url, max: 1 });
  cleanup = createExpiredDraftCleanup(cleanupPool);
});

beforeEach(async () => {
  await emptyScoreTables(db.admin);
  const drafts: [string, string, Date][] = [
    [A, 'scr_expired_old', before(2 * DAY)],
    [B, 'scr_expired_b', before(HOUR)],
    [A, 'scr_expired_at_t', T],
    [A, 'scr_live', new Date(T.getTime() + 1)],
  ];
  for (const [owner, id, expiresAt] of drafts) {
    await store.drafts.create(owner, draftExpiringAt(f01Spec(id), expiresAt));
  }
  await insertSavedRow(db.admin, {
    id: 'scr_saved',
    owner: A,
    title: 'Kept forever',
    tags: [],
    updatedAt: before(30 * DAY),
  });
});

afterEach(async () => {
  await coordinator.reset();
});

afterAll(async () => {
  await store?.close();
  await cleanupPool?.end();
  await db?.close();
});

async function draftIds(): Promise<string[]> {
  const { rows } = await db.admin.query<{ id: string }>(
    'select id from public.score_drafts order by id',
  );
  return rows.map((row) => row.id);
}

describe('DRAFT-03 expired drafts are unreachable before cleanup', () => {
  const useCases = () => useCasesAt(store, T);

  it.each([
    {
      name: 'get_score',
      call: () => useCases().get.execute(PRINCIPAL_A, { scoreId: 'scr_expired_at_t' }),
    },
    {
      name: 'edit_score',
      call: () => useCases().edit.execute(PRINCIPAL_A, tempoEdit('scr_expired_at_t', 1, 90)),
    },
    {
      name: 'save_score',
      call: () =>
        useCases().save.execute(PRINCIPAL_A, {
          scoreId: 'scr_expired_at_t',
          expectedRevision: 1,
          title: 'Too late',
        }),
    },
  ])(
    '$name at the expiry instant is NOT_FOUND and leaves the stored row as it was',
    async ({ call }) => {
      const stored = await storedDrafts(db.admin, 'scr_expired_at_t');

      expect(await call()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

      expect(await storedDrafts(db.admin, 'scr_expired_at_t')).toEqual(stored);
      expect(await storedSaved(db.admin, 'scr_expired_at_t')).toEqual([]);
    },
  );

  it('a draft expiring 1 ms after the request instant is still served', async () => {
    const result = await useCases().get.execute(PRINCIPAL_A, { scoreId: 'scr_live' });
    expect(result).toMatchObject({ ok: true, value: { artifact: { scoreId: 'scr_live' } } });
  });
});

describe('DRAFT-03 cleanup', () => {
  it('deletes exactly the drafts expired at its instant, whatever the owner, and a second run deletes nothing', async () => {
    const saved = await storedSaved(db.admin, 'scr_saved');

    expect(await cleanup.run(T, 100)).toBe(3);
    expect(await draftIds()).toEqual(['scr_live']);
    expect(await storedSaved(db.admin, 'scr_saved')).toEqual(saved);

    expect(await cleanup.run(T, 100)).toBe(0);
    expect(await draftIds()).toEqual(['scr_live']);
  });

  it('deletes at most the batch size per run, earliest expiry first', async () => {
    expect(await cleanup.run(T, 2)).toBe(2);
    expect(await draftIds()).toEqual(['scr_expired_at_t', 'scr_live']);
    expect(await cleanup.run(T, 2)).toBe(1);
    expect(await cleanup.run(T, 2)).toBe(0);
    expect(await draftIds()).toEqual(['scr_live']);
  });
});

describe('DRAFT-03 cleanup interleaved with a refresh of the same draft', () => {
  // The edit is decided 1 ms before expiry (live); cleanup runs at the expiry instant.
  const EDIT_AT = before(1);
  const edit = () =>
    useCasesAt(store, EDIT_AT).edit.execute(PRINCIPAL_A, tempoEdit('scr_expired_at_t', 1, 90));

  it('a refresh holding the draft makes cleanup skip it; the refreshed draft survives', async () => {
    const gate = await coordinator.pause('score_drafts', 'after update', 'scr_expired_at_t');
    const edited = edit();
    await coordinator.lockWaiters(1); // the refresh is written, not committed

    // Cleanup selects the draft on its old expiry, finds it locked and skips it.
    expect(await cleanup.run(T, 100)).toBe(2);
    await gate.open();

    expect(await edited).toMatchObject({ ok: true, value: { artifact: { revision: 2 } } });
    expect(await storedDrafts(db.admin, 'scr_expired_at_t')).toEqual([
      expect.objectContaining({ revision: 2, expires_at: new Date(EDIT_AT.getTime() + TTL) }),
    ]);
    expect(await cleanup.run(T, 100)).toBe(0);
    expect(await draftIds()).toEqual(['scr_expired_at_t', 'scr_live']);
  });

  it('a deletion holding the draft makes the refresh fail with REVISION_CONFLICT, never a phantom success', async () => {
    const gate = await coordinator.pause('score_drafts', 'before delete', 'scr_expired_at_t');
    const cleaned = cleanup.run(T, 100);
    await coordinator.lockWaiters(1); // cleanup holds the draft, its delete not yet done

    const edited = edit(); // reads the still-committed draft as live, then waits on its lock
    await coordinator.lockWaiters(2);
    await gate.open();

    expect(await cleaned).toBe(3);
    expect(await edited).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(await storedDrafts(db.admin, 'scr_expired_at_t')).toEqual([]);
    expect(await storedSaved(db.admin, 'scr_expired_at_t')).toEqual([]);
  });
});
