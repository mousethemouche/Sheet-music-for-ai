/**
 * LIB-01 (issue #10): SaveScore promotes only the owner's current, live draft
 * with valid metadata, keeping the logical ID and current revision. Every
 * failed precondition blocks the promotion. A save replay never duplicates or
 * overwrites a library entry. Title/tag normalization rows live in LIB-03;
 * the atomic database promotion and its races are #22.
 */
import { F01 } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '../src/index';
import {
  ALICE,
  BOB,
  DAY,
  HOUR,
  at,
  draftRow,
  expectError,
  expectOk,
  makeHarness,
  storedSpec,
} from './support/harness';

const SPEC = storedSpec(F01, 'd1', 4);
const REQUEST = {
  scoreId: 'd1',
  expectedRevision: 4,
  title: 'Blues in F',
  tags: ['jazz', 'blues'],
};

/** Alice has a live draft d1 at revision 4, written at T0 (expires T0 + 7 days); the clock is T0 + 1h. */
function withDraft() {
  const harness = makeHarness({ start: at(HOUR) });
  harness.store.putDraft('user-a', draftRow(SPEC, { createdAt: at(0), expiresAt: at(7 * DAY) }));
  return harness;
}

describe('LIB-01 SaveScore preconditions and promotion', () => {
  it('promotes the current draft: same ID, same revision and content, confirmed title and tags, draft removed', async () => {
    const harness = withDraft();

    const output = expectOk(await harness.saveScore.execute(ALICE, REQUEST));

    expect(output).toEqual({
      outcome: 'saved',
      artifact: {
        state: 'saved',
        scoreId: 'd1',
        revision: 4,
        score: SPEC,
        title: 'Blues in F',
        tags: ['jazz', 'blues'],
        createdAt: '2026-09-28T13:00:00.000Z',
        updatedAt: '2026-09-28T13:00:00.000Z',
      },
    });
    expect(harness.store.savedOf('user-a', 'd1')?.spec).toBe(SPEC);
    expect(harness.store.draftOf('user-a', 'd1')).toBeUndefined();
    expect(harness.store.writeCalls()).toEqual(['promotion.promote']);
  });

  it.each<{
    name: string;
    principal: AuthenticatedPrincipal | undefined;
    input: Record<string, unknown>;
    clock?: Date;
    code: string;
  }>([
    {
      name: 'invalid metadata (blank title)',
      principal: ALICE,
      input: { ...REQUEST, title: '  ' },
      code: 'INVALID_INPUT',
    },
    {
      name: 'invalid metadata (41-character tag)',
      principal: ALICE,
      input: { ...REQUEST, tags: ['x'.repeat(41)] },
      code: 'INVALID_INPUT',
    },
    {
      name: 'a model-supplied consent flag',
      principal: ALICE,
      input: { ...REQUEST, confirmed: true },
      code: 'INVALID_INPUT',
    },
    { name: 'a missing principal', principal: undefined, input: REQUEST, code: 'UNAUTHENTICATED' },
    { name: 'another user', principal: BOB, input: REQUEST, code: 'NOT_FOUND' },
    {
      name: 'an expired draft',
      principal: ALICE,
      input: REQUEST,
      clock: at(7 * DAY),
      code: 'NOT_FOUND',
    },
    {
      name: 'a stale expectedRevision',
      principal: ALICE,
      input: { ...REQUEST, expectedRevision: 3 },
      code: 'REVISION_CONFLICT',
    },
  ])('blocks the promotion for $name ($code)', async ({ principal, input, clock, code }) => {
    const harness = withDraft();
    if (clock !== undefined) {
      harness.clock.set(clock);
    }

    const error = expectError(await harness.saveScore.execute(principal, input));

    expect(error.code).toBe(code);
    expect(harness.store.writeCalls()).toEqual([]);
    expect(harness.store.savedCount).toBe(0);
    expect(harness.store.draftOf('user-a', 'd1')?.spec).toBe(SPEC);
  });

  it('names the current revision when the expected one is stale', async () => {
    const harness = withDraft();

    const error = expectError(
      await harness.saveScore.execute(ALICE, { ...REQUEST, expectedRevision: 3 }),
    );

    expect(error.details).toEqual([
      expect.objectContaining({
        code: 'REVISION_MISMATCH',
        path: ['expectedRevision'],
        ids: ['d1'],
      }),
    ]);
    expect(error.details[0]?.message).toContain('revision 4');
  });

  describe('replay of a save', () => {
    it('answers an identical replay with outcome "already_saved" and writes nothing', async () => {
      const harness = withDraft();
      const first = expectOk(await harness.saveScore.execute(ALICE, REQUEST));
      harness.clock.set(at(2 * HOUR));

      const replay = expectOk(await harness.saveScore.execute(ALICE, REQUEST));

      expect(replay).toEqual({ outcome: 'already_saved', artifact: first.artifact });
      expect(harness.store.writeCalls()).toEqual(['promotion.promote']);
      expect(harness.store.savedCount).toBe(1);
    });

    it.each([
      { name: 'another title', change: { title: 'Another title' } },
      { name: 'other tags', change: { tags: ['jazz'] } },
      { name: 'tags in another order', change: { tags: ['blues', 'jazz'] } },
    ])(
      'rejects a replay with $name as ALREADY_SAVED and keeps the stored entry',
      async ({ change }) => {
        const harness = withDraft();
        expectOk(await harness.saveScore.execute(ALICE, REQUEST));
        const stored = harness.store.savedOf('user-a', 'd1');

        const error = expectError(
          await harness.saveScore.execute(ALICE, { ...REQUEST, ...change }),
        );

        expect(error.code).toBe('ALREADY_SAVED');
        expect(harness.store.savedOf('user-a', 'd1')).toBe(stored);
        expect(harness.store.writeCalls()).toEqual(['promotion.promote']);
      },
    );

    it('rejects a save of an old revision after the saved score was edited, instead of overwriting it', async () => {
      const harness = withDraft();
      expectOk(await harness.saveScore.execute(ALICE, REQUEST));
      expectOk(
        await harness.editScore.execute(ALICE, {
          scoreId: 'd1',
          expectedRevision: 4,
          operations: [{ type: 'set_tempo', bpm: 90 }],
        }),
      );

      const error = expectError(await harness.saveScore.execute(ALICE, REQUEST));

      expect(error.code).toBe('ALREADY_SAVED');
      expect(error.message).toContain('revision 5');
      expect(harness.store.savedOf('user-a', 'd1')?.spec.revision).toBe(5);
      expect(harness.store.savedCount).toBe(1);
    });
  });

  describe('when the draft changes between the check and the promotion', () => {
    it('treats a concurrent identical save that won the race as a replay ("already_saved")', async () => {
      const harness = withDraft();
      harness.store.interference.set('promotion.promote', () => {
        harness.store.removeDraft('user-a', 'd1');
        harness.store.putSaved('user-a', {
          spec: SPEC,
          title: 'Blues in F',
          tags: ['jazz', 'blues'],
          createdAt: at(HOUR),
          updatedAt: at(HOUR),
        });
      });

      const output = expectOk(await harness.saveScore.execute(ALICE, REQUEST));

      expect(output.outcome).toBe('already_saved');
      expect(harness.store.savedCount).toBe(1);
    });

    it('reports a concurrent edit of the draft as REVISION_CONFLICT and keeps the newer draft', async () => {
      const harness = withDraft();
      const newer = draftRow(storedSpec(F01, 'd1', 5), {
        createdAt: at(0),
        expiresAt: at(8 * DAY),
      });
      harness.store.interference.set('promotion.promote', () => {
        harness.store.putDraft('user-a', newer);
      });

      const error = expectError(await harness.saveScore.execute(ALICE, REQUEST));

      expect(error.code).toBe('REVISION_CONFLICT');
      expect(harness.store.draftOf('user-a', 'd1')).toBe(newer);
      expect(harness.store.savedCount).toBe(0);
    });

    it('reports a failed promotion as DEPENDENCY_UNAVAILABLE and the draft is still there', async () => {
      const harness = withDraft();
      harness.store.failures.set('promotion.promote', new Error('transaction aborted'));

      const error = expectError(await harness.saveScore.execute(ALICE, REQUEST));

      expect(error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(harness.store.draftOf('user-a', 'd1')?.spec).toBe(SPEC);
      expect(harness.store.savedCount).toBe(0);
    });
  });
});
