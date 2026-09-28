/**
 * DRAFT-04 promotion (issue #22, ADR-006, APPLICATION_LAYER.md §3.6): the
 * only detailed promotion and race suite.
 *
 * - A live draft becomes exactly one saved score with the same ID, document
 *   and revision, the confirmed title and tags, and no draft remains.
 * - A draft that is not at the expected revision, not live at `now`, foreign,
 *   missing or already promoted is 'stale' and nothing changes.
 * - A failure injected between the saved insert and the draft delete, or an
 *   insert failure, rolls everything back: the draft is intact and can still
 *   be promoted.
 * - Save interleaved with an edit, another save or cleanup, coordinated with
 *   row locks (no sleeps): no committed revision is lost, no second library
 *   entry, no orphan, and the loser gets an explicit outcome.
 */
import type { PromotionRequest } from '@sheet-music/music-application';
import { F01, cloneFixture } from '@sheet-music/test-fixtures';
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
  PRINCIPAL_A,
  TTL,
  at,
  draftRecord,
  emptyScoreTables,
  f01Spec,
  insertSavedRow,
  storedDrafts,
  storedSaved,
  tempoEdit,
  useCasesAt,
} from './support/fixtures';

const ID = 'scr_promote';
const CREATED = at('2026-09-28T10:00:00.000Z');
const EDITED = at('2026-09-29T10:00:00.000Z');
/** Revision 2 was written at EDITED, so the draft is dead from EXPIRES on. */
const EXPIRES = new Date(EDITED.getTime() + TTL);
/** The save request instant: the draft is live by one millisecond. */
const NOW = new Date(EXPIRES.getTime() - 1);
const TITLE = 'Late-night ii-V-I';
const TAGS = ['jazz', 'Practice'];

/** The stored document of revision `revision` (F01 with the tempo the edits set). */
function document(revision: number, bpm: number) {
  return { ...cloneFixture(F01), id: ID, revision, tempo: { bpm } };
}

const request = (overrides: Partial<PromotionRequest> = {}): PromotionRequest => ({
  id: ID,
  expectedRevision: 2,
  title: TITLE,
  tags: TAGS,
  now: NOW,
  ...overrides,
});

const saveInput = { scoreId: ID, expectedRevision: 2, title: TITLE, tags: TAGS };

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
  cleanupPool = createPostgresPool({ connectionString: db.url, max: 1 });
  cleanup = createExpiredDraftCleanup(cleanupPool);
});

// A's draft at revision 2 (tempo 90), written at EDITED.
beforeEach(async () => {
  await emptyScoreTables(db.admin);
  await store.drafts.create(A, draftRecord(f01Spec(ID, 1, 120), CREATED));
  expect(await store.drafts.update(A, draftRecord(f01Spec(ID, 2, 90), EDITED, CREATED), 1)).toBe(
    'updated',
  );
});

afterEach(async () => {
  await coordinator.reset();
});

afterAll(async () => {
  await store?.close();
  await cleanupPool?.end();
  await db?.close();
});

/** The single saved row a successful promotion of revision 2 at `now` leaves. */
function promotedRow(now: Date) {
  return {
    id: ID,
    owner_user_id: A,
    score_spec: document(2, 90),
    score_spec_version: 1,
    revision: 2,
    title: TITLE,
    tags: TAGS,
    created_at: now,
    updated_at: now,
  };
}

describe('DRAFT-04 successful promotion', () => {
  it('keeps ID, document and revision, applies the confirmed title and tags, leaves one saved row and no draft', async () => {
    const saved = {
      spec: document(2, 90),
      title: TITLE,
      tags: TAGS,
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(await store.promotion.promote(A, request())).toEqual({ status: 'promoted', saved });

    expect(await storedDrafts(db.admin, ID)).toEqual([]);
    expect(await storedSaved(db.admin, ID)).toEqual([promotedRow(NOW)]);
    expect(await store.saved.get(A, ID)).toEqual(saved);
  });
});

describe('DRAFT-04 promotion with no matching live draft is stale and changes nothing', () => {
  it.each([
    { name: 'an older expected revision', owner: A, overrides: { expectedRevision: 1 } },
    { name: 'a newer expected revision', owner: A, overrides: { expectedRevision: 3 } },
    {
      name: 'a draft expiring exactly at the promotion instant',
      owner: A,
      overrides: { now: EXPIRES },
    },
    { name: "another owner's draft", owner: B, overrides: {} },
    { name: 'a missing draft', owner: A, overrides: { id: 'scr_promote_missing' } },
  ])('$name', async ({ owner, overrides }) => {
    const draft = await storedDrafts(db.admin, ID);

    expect(await store.promotion.promote(owner, request(overrides))).toEqual({ status: 'stale' });

    expect(await storedDrafts(db.admin, ID)).toEqual(draft);
    expect(await storedSaved(db.admin, ID)).toEqual([]);
    expect(await storedSaved(db.admin, 'scr_promote_missing')).toEqual([]);
  });

  it('a second promotion of the same draft is stale: still one library entry', async () => {
    expect((await store.promotion.promote(A, request())).status).toBe('promoted');

    expect(await store.promotion.promote(A, request())).toEqual({ status: 'stale' });

    expect(await storedSaved(db.admin, ID)).toEqual([promotedRow(NOW)]);
    expect(await storedDrafts(db.admin, ID)).toEqual([]);
  });
});

describe('DRAFT-04 a failed promotion rolls back completely', () => {
  it('a failure between the saved insert and the draft delete keeps the draft, which can be promoted afterwards', async () => {
    const draft = await storedDrafts(db.admin, ID);
    await coordinator.failDraftDeleteAfterSavedInsert(ID);

    await expect(store.promotion.promote(A, request())).rejects.toEqual(
      expect.objectContaining({
        name: 'PersistenceError',
        operation: 'promotion.promote',
        code: 'P0001',
      }),
    );
    expect(await storedDrafts(db.admin, ID)).toEqual(draft);
    expect(await storedSaved(db.admin, ID)).toEqual([]);

    await coordinator.reset();
    expect((await store.promotion.promote(A, request())).status).toBe('promoted');
    expect(await storedSaved(db.admin, ID)).toEqual([promotedRow(NOW)]);
    expect(await storedDrafts(db.admin, ID)).toEqual([]);
  });

  it('an insert failure (the ID is already in the library) keeps both rows as they were', async () => {
    await insertSavedRow(db.admin, {
      id: ID,
      owner: A,
      title: 'Existing',
      tags: [],
      updatedAt: CREATED,
    });
    const draft = await storedDrafts(db.admin, ID);
    const saved = await storedSaved(db.admin, ID);

    await expect(store.promotion.promote(A, request())).rejects.toEqual(
      expect.objectContaining({
        name: 'PersistenceError',
        operation: 'promotion.promote',
        code: '23505',
      }),
    );

    expect(await storedDrafts(db.admin, ID)).toEqual(draft);
    expect(await storedSaved(db.admin, ID)).toEqual(saved);
  });
});

describe('DRAFT-04 save interleaved with edit, save and cleanup of the same draft', () => {
  const useCases = () => useCasesAt(store, NOW);

  it('save holding the draft, then an edit: the edit is a REVISION_CONFLICT; one saved row at the promoted revision', async () => {
    const gate = await coordinator.pause('score_drafts', 'before delete', ID);
    const saving = useCases().save.execute(PRINCIPAL_A, saveInput);
    await coordinator.lockWaiters(1); // saved row inserted, draft not yet deleted

    const editing = useCases().edit.execute(PRINCIPAL_A, tempoEdit(ID, 2, 60));
    await coordinator.lockWaiters(2);
    await gate.open();

    expect(await saving).toMatchObject({
      ok: true,
      value: { outcome: 'saved', artifact: { revision: 2 } },
    });
    expect(await editing).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(await storedSaved(db.admin, ID)).toEqual([promotedRow(NOW)]);
    expect(await storedDrafts(db.admin, ID)).toEqual([]);
  });

  it('edit holding the draft, then a save: the save is a REVISION_CONFLICT; the edited draft keeps its new revision', async () => {
    const gate = await coordinator.pause('score_drafts', 'after update', ID);
    const editing = useCases().edit.execute(PRINCIPAL_A, tempoEdit(ID, 2, 60));
    await coordinator.lockWaiters(1); // revision 3 written, not committed

    const saving = useCases().save.execute(PRINCIPAL_A, saveInput);
    await coordinator.lockWaiters(2);
    await gate.open();

    expect(await editing).toMatchObject({ ok: true, value: { artifact: { revision: 3 } } });
    expect(await saving).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(await storedDrafts(db.admin, ID)).toEqual([
      expect.objectContaining({ revision: 3, score_spec: document(3, 60) }),
    ]);
    expect(await storedSaved(db.admin, ID)).toEqual([]);
  });

  it('two saves of the same draft: one library entry, the second replays as already_saved', async () => {
    const gate = await coordinator.pause('score_drafts', 'before delete', ID);
    const firstSave = useCases().save.execute(PRINCIPAL_A, saveInput);
    await coordinator.lockWaiters(1);

    const secondSave = useCases().save.execute(PRINCIPAL_A, saveInput);
    await coordinator.lockWaiters(2);
    await gate.open();

    const first = await firstSave;
    expect(first).toMatchObject({ ok: true, value: { outcome: 'saved' } });
    expect(await secondSave).toEqual({
      ok: true,
      value: { outcome: 'already_saved', artifact: first.ok ? first.value.artifact : undefined },
    });
    expect(await storedSaved(db.admin, ID)).toEqual([promotedRow(NOW)]);
    expect(await storedDrafts(db.admin, ID)).toEqual([]);
  });

  it('save holding the draft, then cleanup at its expiry: cleanup skips it; one saved row, no orphan', async () => {
    const gate = await coordinator.pause('score_drafts', 'before delete', ID);
    const saving = useCases().save.execute(PRINCIPAL_A, saveInput);
    await coordinator.lockWaiters(1);

    expect(await cleanup.run(EXPIRES, 100)).toBe(0);
    await gate.open();

    expect(await saving).toMatchObject({ ok: true, value: { outcome: 'saved' } });
    expect(await cleanup.run(EXPIRES, 100)).toBe(0);
    expect(await storedSaved(db.admin, ID)).toEqual([promotedRow(NOW)]);
    expect(await storedDrafts(db.admin, ID)).toEqual([]);
  });

  it('cleanup holding the expired draft, then a save decided just before expiry: nothing is saved, nothing half-done', async () => {
    const gate = await coordinator.pause('score_drafts', 'before delete', ID);
    const cleaning = cleanup.run(EXPIRES, 100);
    await coordinator.lockWaiters(1);

    const saving = useCases().save.execute(PRINCIPAL_A, saveInput);
    await coordinator.lockWaiters(2);
    await gate.open();

    expect(await cleaning).toBe(1);
    expect(await saving).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(await storedDrafts(db.admin, ID)).toEqual([]);
    expect(await storedSaved(db.admin, ID)).toEqual([]);
  });
});
