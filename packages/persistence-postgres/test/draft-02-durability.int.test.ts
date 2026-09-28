/**
 * DRAFT-02 durability (issue #22, ADR-006): a draft committed by one
 * application instance (the production use cases over their own Postgres
 * pool) survives that instance's disposal. A fresh instance sharing only the
 * database reads it and edits it; a third one reads the edit. Nothing is kept
 * in process memory: the disposed instance can no longer answer at all.
 *
 * This is the one process-lifecycle test; CreateScore, MCP and deployment
 * suites do not repeat it.
 */
import type { AuthenticatedPrincipal } from '@sheet-music/music-application';
import { RICH_WIRE_FIXTURE, cloneFixture } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresPersistence } from '../src';
import { type TestDatabase, createTestDatabase, seedTestUsers } from '../testing';
import { PRINCIPAL_A, TTL, at, sequentialIds, tempoEdit, useCasesAt } from './support/fixtures';

const CREATED = at('2026-09-28T10:00:00.000Z');
const EDITED = at('2026-09-29T09:30:00.000Z');
const READ = at('2026-09-30T12:00:00.000Z');
const SCORE_ID = 'scr_durable_1';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
});

afterAll(async () => {
  await db?.close();
});

/** One application instance: its own pool and the production use cases at `now`. */
function startInstance(now: Date) {
  const persistence = createPostgresPersistence({ connectionString: db.url });
  return { persistence, ...useCasesAt(persistence, now, sequentialIds('durable')) };
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error(`Expected success, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe('DRAFT-02 drafts survive the application instance that wrote them', () => {
  it('create on instance 1, dispose it; get and edit on instance 2; read the edit on instance 3', async () => {
    // create_score input: the rich fixture without the server-assigned ID and revision.
    const score: Record<string, unknown> = cloneFixture(RICH_WIRE_FIXTURE);
    delete score['id'];
    delete score['revision'];
    const principal: AuthenticatedPrincipal = PRINCIPAL_A;

    const first = startInstance(CREATED);
    const created = ok(await first.create.execute(principal, { score }));
    await first.persistence.close();

    // The disposed instance holds nothing it could still serve.
    const afterDisposal = await first.get.execute(principal, { scoreId: SCORE_ID });
    expect(afterDisposal).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE' } });

    const second = startInstance(EDITED);
    try {
      const reread = ok(await second.get.execute(principal, { scoreId: SCORE_ID }));
      expect(reread.artifact).toEqual(created.artifact);
      expect(reread.artifact).toEqual({
        state: 'draft',
        scoreId: SCORE_ID,
        revision: 1,
        score: { ...cloneFixture(RICH_WIRE_FIXTURE), id: SCORE_ID, revision: 1 },
        createdAt: CREATED.toISOString(),
        updatedAt: CREATED.toISOString(),
        expiresAt: new Date(CREATED.getTime() + TTL).toISOString(),
      });

      const edited = ok(await second.edit.execute(principal, tempoEdit(SCORE_ID, 1, 96)));
      expect(edited.artifact).toMatchObject({ scoreId: SCORE_ID, revision: 2 });
    } finally {
      await second.persistence.close();
    }

    const third = startInstance(READ);
    try {
      const final = ok(await third.get.execute(principal, { scoreId: SCORE_ID }));
      expect(final.artifact).toEqual({
        state: 'draft',
        scoreId: SCORE_ID,
        revision: 2,
        score: {
          ...cloneFixture(RICH_WIRE_FIXTURE),
          id: SCORE_ID,
          revision: 2,
          tempo: { bpm: 96 },
        },
        createdAt: CREATED.toISOString(),
        updatedAt: EDITED.toISOString(),
        expiresAt: new Date(EDITED.getTime() + TTL).toISOString(),
      });
    } finally {
      await third.persistence.close();
    }
  });
});
