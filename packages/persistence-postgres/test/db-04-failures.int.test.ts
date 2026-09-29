/**
 * DB-04 failures (issue #9): a failed statement or commit never corrupts the
 * previous row, and a storage failure is an explicit rejection
 * (PersistenceError, reported as DEPENDENCY_UNAVAILABLE by the use cases),
 * never a null row, a 'stale' outcome or an empty page. A broken connection
 * is discarded, so the next call works. A pool that requires verified TLS
 * never falls back to plaintext. Promotion rollback is DRAFT-04 (#22).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PersistenceError,
  type PostgresPersistence,
  createExpiredDraftCleanup,
  createPostgresPersistence,
  createPostgresPool,
  databaseTls,
} from '../src';
import {
  TEST_DATABASE_CA_CERT,
  type TestDatabase,
  createTestDatabase,
  seedTestUsers,
} from '../testing';
import { Coordinator } from './support/coordination';
import {
  A,
  at,
  draftRecord,
  emptyScoreTables,
  f01Spec,
  insertSavedRow,
  storedDrafts,
  storedSaved,
} from './support/fixtures';

const ID = 'scr_db04';
const CREATED = at('2026-09-28T10:00:00.000Z');
const EDITED = at('2026-09-28T11:00:00.000Z');

let db: TestDatabase;
let coordinator: Coordinator;
/** One connection only: a broken connection returned to the pool would fail the next call. */
let store: PostgresPersistence;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
  coordinator = new Coordinator(db.admin);
  store = createPostgresPersistence({ connectionString: db.url, max: 1 });
});

beforeEach(async () => {
  await emptyScoreTables(db.admin);
  await store.drafts.create(A, draftRecord(f01Spec(ID), CREATED));
});

afterEach(async () => {
  await coordinator.reset();
});

afterAll(async () => {
  await store?.close();
  await db?.close();
});

const editedDraft = () => draftRecord(f01Spec(ID, 2, 90), EDITED, CREATED);

/** Matches the PersistenceError of `operation` carrying the SQLSTATE `code`. */
function persistenceError(operation: string, code: string): unknown {
  return expect.objectContaining({ name: 'PersistenceError', operation, code }) as unknown;
}

describe('DB-04 failed writes keep the previous row', () => {
  it('a draft edit violating a constraint rejects and changes nothing', async () => {
    const before = await storedDrafts(db.admin, ID);
    // expires_at must be later than updated_at.
    const invalid = { ...editedDraft(), expiresAt: EDITED };

    await expect(store.drafts.update(A, invalid, 1)).rejects.toEqual(
      persistenceError('drafts.update', '23514'),
    );

    expect(await storedDrafts(db.admin, ID)).toEqual(before);
  });

  it('a saved-score edit violating a constraint rejects and changes nothing', async () => {
    await insertSavedRow(db.admin, {
      id: 'scr_db04_saved',
      owner: A,
      title: 'Saved',
      tags: [],
      updatedAt: CREATED,
    });
    const before = await storedSaved(db.admin, 'scr_db04_saved');
    // updated_at may not precede created_at.
    const invalid = {
      spec: f01Spec('scr_db04_saved', 2),
      title: 'Saved',
      tags: [],
      createdAt: CREATED,
      updatedAt: at('2026-09-27T10:00:00.000Z'),
    };

    await expect(store.saved.update(A, invalid, 1)).rejects.toEqual(
      persistenceError('saved.update', '23514'),
    );

    expect(await storedSaved(db.admin, 'scr_db04_saved')).toEqual(before);
  });

  it('creating a draft with an existing ID rejects and keeps the first draft', async () => {
    const before = await storedDrafts(db.admin, ID);

    await expect(store.drafts.create(A, draftRecord(f01Spec(ID, 1, 60), EDITED))).rejects.toEqual(
      persistenceError('drafts.create', '23505'),
    );

    expect(await storedDrafts(db.admin, ID)).toEqual(before);
  });

  it("a commit that fails rejects instead of reporting 'updated', and keeps the previous row", async () => {
    const before = await storedDrafts(db.admin, ID);
    await coordinator.failCommitAfterUpdate('score_drafts', ID);

    await expect(store.drafts.update(A, editedDraft(), 1)).rejects.toEqual(
      persistenceError('drafts.update', 'P0001'),
    );
    expect(await storedDrafts(db.admin, ID)).toEqual(before);

    // The same (only) connection is healthy: the edit succeeds once commits work again.
    await coordinator.reset();
    expect(await store.drafts.update(A, editedDraft(), 1)).toBe('updated');
  });

  it('a connection lost in the middle of an edit rejects, and the next call opens a fresh one', async () => {
    const before = await storedDrafts(db.admin, ID);
    const holder = await db.admin.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from public.score_drafts where id = $1 for update', [ID]);
      const edit = store.drafts.update(A, editedDraft(), 1);
      const [pid] = await coordinator.lockWaiters(1);
      await db.admin.query('select pg_terminate_backend($1)', [pid]);

      await expect(edit).rejects.toBeInstanceOf(PersistenceError);
    } finally {
      await holder.query('rollback');
      holder.release();
    }

    expect(await storedDrafts(db.admin, ID)).toEqual(before);
    expect(await store.drafts.get(A, ID)).toMatchObject({ spec: { revision: 1 } });
  });
});

describe('DB-04 an unavailable store rejects every call', () => {
  // Nothing listens on port 1: every connection attempt is refused.
  const pool = createPostgresPool({
    connectionString: 'postgres://user@127.0.0.1:1/sheet_music_unreachable',
    connectionTimeoutMillis: 2_000,
  });
  const down = createPostgresPersistence({
    connectionString: 'postgres://user@127.0.0.1:1/sheet_music_unreachable',
    connectionTimeoutMillis: 2_000,
  });
  const cleanup = createExpiredDraftCleanup(pool);

  afterAll(async () => {
    await down.close();
    await pool.end();
  });

  it.each([
    {
      operation: 'drafts.create',
      call: () => down.drafts.create(A, draftRecord(f01Spec(ID), CREATED)),
    },
    { operation: 'drafts.get', call: () => down.drafts.get(A, ID) },
    { operation: 'drafts.update', call: () => down.drafts.update(A, editedDraft(), 1) },
    { operation: 'drafts.delete', call: () => down.drafts.delete(A, ID) },
    { operation: 'saved.get', call: () => down.saved.get(A, ID) },
    {
      operation: 'saved.update',
      call: () =>
        down.saved.update(
          A,
          { spec: f01Spec(ID, 2), title: 'T', tags: [], createdAt: CREATED, updatedAt: EDITED },
          1,
        ),
    },
    {
      operation: 'saved.search',
      call: () => down.saved.search(A, { tags: [], limit: 20, offset: 0 }),
    },
    {
      operation: 'promotion.promote',
      call: () =>
        down.promotion.promote(A, {
          id: ID,
          expectedRevision: 1,
          title: 'T',
          tags: [],
          now: EDITED,
        }),
    },
    { operation: 'rateLimit.hit', call: () => down.rateLimits.hit('mcp:test', 60_000, EDITED) },
    { operation: 'drafts.cleanup', call: () => cleanup.run(EDITED, 100) },
  ])('$operation rejects with a PersistenceError', async ({ operation, call }) => {
    await expect(call()).rejects.toEqual(
      expect.objectContaining({ name: 'PersistenceError', operation }),
    );
  });

  it('a server that refuses the database rejects a search with its SQLSTATE, not an empty page', async () => {
    const missing = createPostgresPersistence({
      connectionString: new URL('/sheet_music_missing_database', db.url).toString(),
    });
    try {
      await expect(missing.saved.search(A, { tags: [], limit: 20, offset: 0 })).rejects.toEqual(
        persistenceError('saved.search', '3D000'),
      );
    } finally {
      await missing.close();
    }
  });

  it('a pool that requires verified TLS rejects a server without it instead of falling back to plaintext', async () => {
    // Same server and database as the working store; the test servers offer no TLS.
    const verified = createPostgresPersistence({
      connectionString: db.url,
      ...databaseTls(TEST_DATABASE_CA_CERT),
    });
    try {
      await expect(verified.saved.search(A, { tags: [], limit: 20, offset: 0 })).rejects.toEqual(
        expect.objectContaining({
          name: 'PersistenceError',
          operation: 'saved.search',
          cause: expect.objectContaining({
            message: expect.stringMatching(/SSL|certificate/i) as unknown,
          }) as unknown,
        }),
      );
    } finally {
      await verified.close();
    }
  });
});

describe('DB-04 owner-scoped calls never fall back to the privileged connection', () => {
  // The pool's login role owns the tables; only the user-path role
  // `score_owner` depends on these grants. If a call ran without switching to
  // the user path (and its RLS), revoking them would not affect it.
  const REGRANT = `
    grant select, insert, delete on table public.score_drafts to score_owner;
    grant update (score_spec, score_spec_version, revision, updated_at, expires_at)
      on table public.score_drafts to score_owner;
    grant select, insert on table public.scores to score_owner;
    grant update (score_spec, score_spec_version, revision, updated_at)
      on table public.scores to score_owner;`;

  it.each([
    {
      operation: 'drafts.create',
      call: () => store.drafts.create(A, draftRecord(f01Spec('scr_db04_new'), CREATED)),
    },
    { operation: 'drafts.get', call: () => store.drafts.get(A, ID) },
    { operation: 'drafts.update', call: () => store.drafts.update(A, editedDraft(), 1) },
    { operation: 'drafts.delete', call: () => store.drafts.delete(A, ID) },
    { operation: 'saved.get', call: () => store.saved.get(A, ID) },
    {
      operation: 'saved.update',
      call: () =>
        store.saved.update(
          A,
          { spec: f01Spec(ID, 2), title: 'T', tags: [], createdAt: CREATED, updatedAt: EDITED },
          1,
        ),
    },
    {
      operation: 'saved.search',
      call: () => store.saved.search(A, { tags: [], limit: 20, offset: 0 }),
    },
    {
      operation: 'promotion.promote',
      call: () =>
        store.promotion.promote(A, {
          id: ID,
          expectedRevision: 1,
          title: 'T',
          tags: [],
          now: EDITED,
        }),
    },
  ])('$operation is denied when the user-path role has no grant', async ({ operation, call }) => {
    const before = await storedDrafts(db.admin, ID);
    await db.admin.query('revoke all on table public.score_drafts, public.scores from score_owner');
    try {
      await expect(call()).rejects.toEqual(persistenceError(operation, '42501'));
    } finally {
      await db.admin.query(REGRANT);
    }
    expect(await storedDrafts(db.admin, ID)).toEqual(before);
  });
});
