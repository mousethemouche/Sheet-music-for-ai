/**
 * DB-01 round-trip (issue #9), through the real migrations and the
 * production adapter on the user path.
 *
 * - The rich wire fixture is stored as exactly its canonical ScoreSpec (every
 *   inner ID, no derived SVG/MIDI/audio data) and read back unchanged, with
 *   the intended revision and timestamps, as a draft, after an edit, after a
 *   promotion and after a saved-score edit.
 * - A stored document this build cannot read (unknown version, invalid
 *   version-1 document) is rejected as StoredScoreUnreadableError and never
 *   rewritten. ScoreSpec v1 is the only version so far, so there is no
 *   old-version upgrade test yet.
 *
 * Oracle: the rich fixture is written in canonical form, so the expected
 * document is the fixture itself with the row's ID and revision.
 */
import { StoredScoreUnreadableError } from '@sheet-music/music-application';
import { F01, RICH_WIRE_FIXTURE, cloneFixture, parseFixture } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type PostgresPersistence, createPostgresPersistence } from '../src';
import { type TestDatabase, createTestDatabase, seedTestUsers } from '../testing';
import {
  A,
  TTL,
  at,
  draftRecord,
  emptyScoreTables,
  insertDraftRow,
  insertSavedRow,
  storedDrafts,
  storedSaved,
} from './support/fixtures';

const ID = 'scr_db01_rich';
const CREATED = at('2026-09-28T10:00:00.000Z');
const EDITED = at('2026-09-29T11:30:00.250Z');
const PROMOTED = at('2026-09-30T08:00:00.125Z');
const SAVED_EDIT = at('2026-10-01T09:15:00.500Z');
const later = (instant: Date) => new Date(instant.getTime() + TTL);

/** The canonical rich document carrying the row's ID, `revision` and tempo. */
function richDocument(revision: number, bpm = 132) {
  return { ...cloneFixture(RICH_WIRE_FIXTURE), id: ID, revision, tempo: { bpm } };
}

let db: TestDatabase;
let store: PostgresPersistence;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
  store = createPostgresPersistence({ connectionString: db.url });
});

beforeEach(async () => {
  await emptyScoreTables(db.admin);
});

afterAll(async () => {
  await store?.close();
  await db?.close();
});

async function createRichDraft(): Promise<void> {
  await store.drafts.create(A, draftRecord(parseFixture(richDocument(1)), CREATED));
}

describe('DB-01 draft round-trip', () => {
  it('stores a new draft as exactly its canonical document and reads every field back', async () => {
    await createRichDraft();

    expect(await store.drafts.get(A, ID)).toEqual({
      spec: richDocument(1),
      createdAt: CREATED,
      updatedAt: CREATED,
      expiresAt: later(CREATED),
    });
    expect(await storedDrafts(db.admin, ID)).toEqual([
      {
        id: ID,
        owner_user_id: A,
        score_spec: richDocument(1),
        score_spec_version: 1,
        revision: 1,
        created_at: CREATED,
        updated_at: CREATED,
        expires_at: later(CREATED),
      },
    ]);
  });

  it('replaces document, revision, update time and expiry on an edit, and keeps the creation time', async () => {
    await createRichDraft();

    const edited = draftRecord(parseFixture(richDocument(2, 90)), EDITED, CREATED);
    expect(await store.drafts.update(A, edited, 1)).toBe('updated');

    expect(await store.drafts.get(A, ID)).toEqual({
      spec: richDocument(2, 90),
      createdAt: CREATED,
      updatedAt: EDITED,
      expiresAt: later(EDITED),
    });
    const [row] = await storedDrafts(db.admin, ID);
    expect(row).toMatchObject({
      revision: 2,
      score_spec: richDocument(2, 90),
      created_at: CREATED,
    });
  });

  it('deletes only the named draft, and deleting it again is harmless', async () => {
    await createRichDraft();
    await store.drafts.create(
      A,
      draftRecord(parseFixture({ ...richDocument(1), id: 'scr_db01_other' }), CREATED),
    );

    await store.drafts.delete(A, ID);
    await store.drafts.delete(A, ID);

    expect(await store.drafts.get(A, ID)).toBeNull();
    expect(await storedDrafts(db.admin, 'scr_db01_other')).toHaveLength(1);
  });
});

describe('DB-01 saved-score round-trip', () => {
  async function promoteRichDraft(): Promise<void> {
    await createRichDraft();
    const outcome = await store.promotion.promote(A, {
      id: ID,
      expectedRevision: 1,
      title: 'Rich wire fixture — library',
      tags: ['Jazz', 'ii-V-I'],
      now: PROMOTED,
    });
    expect(outcome.status).toBe('promoted');
  }

  it('reads back the promoted document, revision, library title, tags and promotion time', async () => {
    await promoteRichDraft();

    expect(await store.saved.get(A, ID)).toEqual({
      spec: richDocument(1),
      title: 'Rich wire fixture — library',
      tags: ['Jazz', 'ii-V-I'],
      createdAt: PROMOTED,
      updatedAt: PROMOTED,
    });
    expect(await storedSaved(db.admin, ID)).toEqual([
      {
        id: ID,
        owner_user_id: A,
        score_spec: richDocument(1),
        score_spec_version: 1,
        revision: 1,
        title: 'Rich wire fixture — library',
        tags: ['Jazz', 'ii-V-I'],
        created_at: PROMOTED,
        updated_at: PROMOTED,
      },
    ]);
  });

  it('replaces document, revision and update time on an edit, and keeps title, tags and creation time', async () => {
    await promoteRichDraft();

    const edited = {
      spec: parseFixture(richDocument(2, 72)),
      title: 'Rich wire fixture — library',
      tags: ['Jazz', 'ii-V-I'],
      createdAt: PROMOTED,
      updatedAt: SAVED_EDIT,
    };
    expect(await store.saved.update(A, edited, 1)).toBe('updated');

    expect(await store.saved.get(A, ID)).toEqual({ ...edited, spec: richDocument(2, 72) });
    const [row] = await storedSaved(db.admin, ID);
    expect(row).toMatchObject({ revision: 2, score_spec: richDocument(2, 72) });
  });
});

describe('DB-01 unreadable stored documents fail safely and are never rewritten', () => {
  const BAD_ID = 'scr_db01_unreadable';
  const EXPIRES = at('2027-01-01T00:00:00.000Z');

  const UNREADABLE = [
    {
      name: 'an unknown ScoreSpec version',
      document: { ...cloneFixture(F01), id: BAD_ID, revision: 1, version: 2 },
    },
    {
      name: 'an invalid version-1 document',
      document: { ...cloneFixture(F01), id: BAD_ID, revision: 1, staves: 'rh' },
    },
  ];

  it.each(UNREADABLE)(
    'rejects a draft holding $name, and neither promotes nor rewrites it',
    async ({ document }) => {
      await insertDraftRow(db.admin, A, document, EXPIRES);
      const before = await storedDrafts(db.admin, BAD_ID);

      await expect(store.drafts.get(A, BAD_ID)).rejects.toBeInstanceOf(StoredScoreUnreadableError);
      await expect(
        store.promotion.promote(A, {
          id: BAD_ID,
          expectedRevision: 1,
          title: 'Unreadable',
          tags: [],
          now: CREATED,
        }),
      ).rejects.toBeInstanceOf(StoredScoreUnreadableError);

      expect(await storedDrafts(db.admin, BAD_ID)).toEqual(before);
      expect(await storedSaved(db.admin, BAD_ID)).toEqual([]);
    },
  );

  it.each(UNREADABLE)(
    'rejects a saved score holding $name, and does not rewrite it',
    async ({ document }) => {
      await insertSavedRow(db.admin, {
        id: BAD_ID,
        owner: A,
        title: 'Unreadable',
        tags: [],
        updatedAt: CREATED,
        spec: document,
      });
      const before = await storedSaved(db.admin, BAD_ID);

      await expect(store.saved.get(A, BAD_ID)).rejects.toBeInstanceOf(StoredScoreUnreadableError);

      expect(await storedSaved(db.admin, BAD_ID)).toEqual(before);
    },
  );
});
