/**
 * EditScore orchestration (application part of #13). The operations
 * themselves are OPS-01..06 (#3); the real database compare-and-swap race is
 * DB-03 (#9); the wire-level stale edit is MCP-EDIT-02 (#13). Covered here:
 * draft and saved paths, domain rejections and lost compare-and-swap writes
 * leave the store untouched, store failures, owner scoping and input checks.
 * Expired drafts and TTL renewal are DRAFT-01.
 */
import { F01, F09, cloneFixture } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  ALICE,
  BOB,
  DAY,
  HOUR,
  at,
  draftRow,
  expectError,
  expectOk,
  iso,
  makeHarness,
  savedRow,
  storedSpec,
} from './support/harness';

const TEMPO_90 = [{ type: 'set_tempo', bpm: 90 }];

/** Alice has draft d1 at revision 4 (F01, written T0) and saved s1 at revision 2 (F09); the clock is T0 + 1h. */
function withScores() {
  const harness = makeHarness({ start: at(HOUR) });
  harness.store.putDraft(
    'user-a',
    draftRow(storedSpec(F01, 'd1', 4), { createdAt: at(0), expiresAt: at(7 * DAY) }),
  );
  harness.store.putSaved(
    'user-a',
    savedRow(storedSpec(F09, 's1', 2), { title: 'Triad', tags: ['theory'], createdAt: at(0) }),
  );
  return harness;
}

describe('EditScore on a draft', () => {
  it('stores the edited score at revision + 1 under the same ID and returns the draft artifact', async () => {
    const harness = withScores();

    const output = expectOk(
      await harness.editScore.execute(ALICE, {
        scoreId: 'd1',
        expectedRevision: 4,
        operations: TEMPO_90,
      }),
    );

    const expectedSpec = {
      ...cloneFixture(storedSpec(F01, 'd1', 4)),
      revision: 5,
      tempo: { bpm: 90 },
    };
    expect(output.artifact).toEqual({
      state: 'draft',
      scoreId: 'd1',
      revision: 5,
      score: expectedSpec,
      createdAt: iso(0),
      updatedAt: iso(HOUR),
      expiresAt: iso(HOUR + 7 * DAY),
    });
    expect(harness.store.draftOf('user-a', 'd1')?.spec).toEqual(expectedSpec);
    expect(harness.store.writeCalls()).toEqual(['drafts.update']);
    expect(harness.store.savedOf('user-a', 'd1')).toBeUndefined();
  });
});

describe('EditScore on a saved score', () => {
  it('updates the saved score in place: new revision, same title, tags and createdAt, no draft created', async () => {
    const harness = withScores();

    const output = expectOk(
      await harness.editScore.execute(ALICE, {
        scoreId: 's1',
        expectedRevision: 2,
        operations: TEMPO_90,
      }),
    );

    const expectedSpec = {
      ...cloneFixture(storedSpec(F09, 's1', 2)),
      revision: 3,
      tempo: { bpm: 90 },
    };
    expect(output.artifact).toEqual({
      state: 'saved',
      scoreId: 's1',
      revision: 3,
      score: expectedSpec,
      title: 'Triad',
      tags: ['theory'],
      createdAt: iso(0),
      updatedAt: iso(HOUR),
    });
    expect(harness.store.savedOf('user-a', 's1')?.spec).toEqual(expectedSpec);
    expect(harness.store.writeCalls()).toEqual(['saved.update']);
    expect(harness.store.draftOf('user-a', 's1')).toBeUndefined();
  });
});

describe('EditScore failures leave the stored score unchanged', () => {
  it.each([
    {
      name: 'a stale expectedRevision on a draft',
      scoreId: 'd1',
      expectedRevision: 3,
      operations: TEMPO_90,
      code: 'REVISION_CONFLICT',
    },
    {
      name: 'a stale expectedRevision on a saved score',
      scoreId: 's1',
      expectedRevision: 1,
      operations: TEMPO_90,
      code: 'REVISION_CONFLICT',
    },
    {
      name: 'a valid operation followed by a missing target',
      scoreId: 'd1',
      expectedRevision: 4,
      operations: [...TEMPO_90, { type: 'set_fingering', noteId: 'missing', fingering: 2 }],
      code: 'TARGET_NOT_FOUND',
    },
    {
      name: 'a second teaching color on an annotated note (P-03)',
      scoreId: 's1',
      expectedRevision: 2,
      operations: [
        {
          type: 'add_annotation',
          annotation: { id: 'a2', color: '#1e90ff', noteIds: ['f09-n3'], text: 'Fifth' },
        },
      ],
      code: 'SCORE_VALIDATION_FAILED',
    },
  ])(
    'rejects $name ($code) without writing',
    async ({ scoreId, expectedRevision, operations, code }) => {
      const harness = withScores();
      const draftBefore = harness.store.draftOf('user-a', 'd1');
      const savedBefore = harness.store.savedOf('user-a', 's1');

      const error = expectError(
        await harness.editScore.execute(ALICE, { scoreId, expectedRevision, operations }),
      );

      expect(error.code).toBe(code);
      expect(harness.store.writeCalls()).toEqual([]);
      expect(harness.store.draftOf('user-a', 'd1')).toBe(draftBefore);
      expect(harness.store.savedOf('user-a', 's1')).toBe(savedBefore);
    },
  );

  it('passes the P-03 conflict detail through unchanged', async () => {
    const harness = withScores();

    const error = expectError(
      await harness.editScore.execute(ALICE, {
        scoreId: 's1',
        expectedRevision: 2,
        operations: [
          {
            type: 'add_annotation',
            annotation: { id: 'a2', color: '#1e90ff', noteIds: ['f09-n3'], text: 'Fifth' },
          },
        ],
      }),
    );

    expect(error.details).toContainEqual(
      expect.objectContaining({
        code: 'ANNOTATION_COLOR_CONFLICT',
        path: ['annotations'],
        ids: ['f09-n3', 'a2', 'f09-a1'],
      }),
    );
  });

  it.each([
    { name: 'draft', scoreId: 'd1', expectedRevision: 4, method: 'drafts.update' as const },
    { name: 'saved score', scoreId: 's1', expectedRevision: 2, method: 'saved.update' as const },
  ])(
    'reports a lost compare-and-swap on a $name as REVISION_CONFLICT and keeps the concurrent write',
    async ({ scoreId, expectedRevision, method }) => {
      const harness = withScores();
      const concurrent = storedSpec(F01, scoreId, expectedRevision + 1);
      harness.store.interference.set(method, () => {
        if (method === 'drafts.update') {
          harness.store.putDraft(
            'user-a',
            draftRow(concurrent, { createdAt: at(0), expiresAt: at(8 * DAY) }),
          );
        } else {
          harness.store.putSaved(
            'user-a',
            savedRow(concurrent, { title: 'Triad', tags: [], createdAt: at(0) }),
          );
        }
      });

      const error = expectError(
        await harness.editScore.execute(ALICE, { scoreId, expectedRevision, operations: TEMPO_90 }),
      );

      expect(error.code).toBe('REVISION_CONFLICT');
      expect(error.details).toEqual([
        expect.objectContaining({
          code: 'REVISION_MISMATCH',
          path: ['expectedRevision'],
          ids: [scoreId],
        }),
      ]);
      const stored =
        method === 'drafts.update'
          ? harness.store.draftOf('user-a', scoreId)
          : harness.store.savedOf('user-a', scoreId);
      expect(stored?.spec).toBe(concurrent);
    },
  );

  it('reports a failed draft write as DEPENDENCY_UNAVAILABLE and keeps the previous draft', async () => {
    const harness = withScores();
    const before = harness.store.draftOf('user-a', 'd1');
    harness.store.failures.set('drafts.update', new Error('connection reset'));

    const error = expectError(
      await harness.editScore.execute(ALICE, {
        scoreId: 'd1',
        expectedRevision: 4,
        operations: TEMPO_90,
      }),
    );

    expect(error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(harness.store.draftOf('user-a', 'd1')).toBe(before);
  });

  it("does not let another user edit Alice's draft or saved score (NOT_FOUND, nothing written)", async () => {
    const harness = withScores();

    const onDraft = expectError(
      await harness.editScore.execute(BOB, {
        scoreId: 'd1',
        expectedRevision: 4,
        operations: TEMPO_90,
      }),
    );
    const onSaved = expectError(
      await harness.editScore.execute(BOB, {
        scoreId: 's1',
        expectedRevision: 2,
        operations: TEMPO_90,
      }),
    );

    expect(onDraft.code).toBe('NOT_FOUND');
    expect(onSaved.code).toBe('NOT_FOUND');
    expect(harness.store.writeCalls()).toEqual([]);
    expect(harness.store.calls.every((call) => call.owner === 'user-b')).toBe(true);
  });

  it.each([
    {
      name: 'a missing principal',
      principal: undefined,
      input: { scoreId: 'd1', expectedRevision: 4, operations: TEMPO_90 },
      code: 'UNAUTHENTICATED',
    },
    {
      name: 'a missing expectedRevision',
      principal: ALICE,
      input: { scoreId: 'd1', operations: TEMPO_90 },
      code: 'INVALID_INPUT',
    },
    {
      name: 'operations that are not a list',
      principal: ALICE,
      input: { scoreId: 'd1', expectedRevision: 4, operations: { type: 'set_tempo' } },
      code: 'INVALID_INPUT',
    },
    {
      name: 'a forged owner field',
      principal: ALICE,
      input: { scoreId: 'd1', expectedRevision: 4, operations: TEMPO_90, ownerId: 'user-a' },
      code: 'INVALID_INPUT',
    },
  ])('rejects $name ($code) before touching the store', async ({ principal, input, code }) => {
    const harness = withScores();

    const error = expectError(await harness.editScore.execute(principal, input));

    expect(error.code).toBe(code);
    expect(harness.store.calls).toEqual([]);
  });
});
