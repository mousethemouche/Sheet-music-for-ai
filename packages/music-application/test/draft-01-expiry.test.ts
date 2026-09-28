/**
 * DRAFT-01 (issue #22, unit part): the draft expiry policy and how the use
 * cases apply it, with an injected clock and no sleeps.
 * - creation at T expires at T + 7 days; a successful edit at T + 1 day moves
 *   it to T + 8 days; reads and failed edits never renew it;
 * - the boundary is exact: live before expiresAt, expired from expiresAt on,
 *   and access is blocked even though the row has not been cleaned up yet;
 * - the TTL is configurable and must be a positive whole number of ms.
 * Cleanup and promotion races against the real database are DRAFT-03/04.
 */
import { F01 } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_TTL_MS, createDraftExpiryPolicy } from '../src/index';
import {
  ALICE,
  DAY,
  HOUR,
  at,
  draftRow,
  expectError,
  expectOk,
  iso,
  makeHarness,
  scorePayload,
  storedSpec,
} from './support/harness';

describe('DRAFT-01 expiry policy', () => {
  it('defaults to 7 days after the latest successful write', () => {
    const policy = createDraftExpiryPolicy();

    expect(DEFAULT_DRAFT_TTL_MS).toBe(604_800_000);
    expect(policy.expiresAt(new Date('2026-09-28T12:00:00.000Z'))).toEqual(
      new Date('2026-10-05T12:00:00.000Z'),
    );
  });

  it('uses a configured TTL', () => {
    const policy = createDraftExpiryPolicy(HOUR);

    expect(policy.expiresAt(new Date('2026-09-28T12:00:00.000Z'))).toEqual(
      new Date('2026-09-28T13:00:00.000Z'),
    );
  });

  it.each([
    { name: 'zero', ttl: 0 },
    { name: 'negative', ttl: -1 },
    { name: 'fractional', ttl: 1.5 },
    { name: 'NaN', ttl: Number.NaN },
    { name: 'infinite', ttl: Number.POSITIVE_INFINITY },
    { name: 'beyond safe integers', ttl: 2 ** 53 },
  ])('refuses a $name TTL', ({ ttl }) => {
    expect(() => createDraftExpiryPolicy(ttl)).toThrow(RangeError);
  });

  it.each([
    { name: 'one millisecond before expiresAt', offset: -1, expired: false },
    { name: 'exactly at expiresAt', offset: 0, expired: true },
    { name: 'one millisecond after expiresAt', offset: 1, expired: true },
  ])('is live or expired $name', ({ offset, expired }) => {
    const policy = createDraftExpiryPolicy();
    const expiresAt = new Date('2026-10-05T12:00:00.000Z');

    expect(policy.isExpired(expiresAt, new Date(expiresAt.getTime() + offset))).toBe(expired);
  });
});

describe('DRAFT-01 renewal through the use cases', () => {
  it('renews on successful edits only: reads and failed edits keep the previous expiry', async () => {
    const harness = makeHarness({ ids: ['d1'] });
    const expiryOf = () => harness.store.draftOf('user-a', 'd1')?.expiresAt;

    // T: create -> T + 7 days.
    const created = expectOk(
      await harness.createScore.execute(ALICE, { score: scorePayload(F01) }),
    );
    expect(created.artifact.expiresAt).toBe(iso(7 * DAY));

    // T + 1 day: successful edit -> T + 8 days.
    harness.clock.set(at(DAY));
    const edited = expectOk(
      await harness.editScore.execute(ALICE, {
        scoreId: 'd1',
        expectedRevision: 1,
        operations: [{ type: 'set_tempo', bpm: 96 }],
      }),
    );
    expect(edited.artifact).toMatchObject({ state: 'draft', revision: 2, expiresAt: iso(8 * DAY) });
    expect(expiryOf()).toEqual(at(8 * DAY));

    // T + 2 days: a read does not renew.
    harness.clock.set(at(2 * DAY));
    const read = expectOk(await harness.getScore.execute(ALICE, { scoreId: 'd1' }));
    expect(read.artifact).toMatchObject({ state: 'draft', expiresAt: iso(8 * DAY) });
    expect(expiryOf()).toEqual(at(8 * DAY));

    // T + 3 days: a stale edit and an invalid edit do not renew.
    harness.clock.set(at(3 * DAY));
    const stale = expectError(
      await harness.editScore.execute(ALICE, {
        scoreId: 'd1',
        expectedRevision: 1,
        operations: [{ type: 'set_tempo', bpm: 80 }],
      }),
    );
    const invalid = expectError(
      await harness.editScore.execute(ALICE, {
        scoreId: 'd1',
        expectedRevision: 2,
        operations: [{ type: 'set_tempo', bpm: 1000 }],
      }),
    );
    expect(stale.code).toBe('REVISION_CONFLICT');
    expect(invalid.code).toBe('INVALID_OPERATION');
    expect(expiryOf()).toEqual(at(8 * DAY));
    expect(harness.store.draftOf('user-a', 'd1')?.spec.revision).toBe(2);
  });

  // A draft written at T expires at T + 7 days; the row stays in the store (no cleanup ran).
  const EXPIRES = 7 * DAY;
  const request = {
    get: { scoreId: 'd1' },
    edit: { scoreId: 'd1', expectedRevision: 3, operations: [{ type: 'set_tempo', bpm: 100 }] },
    save: { scoreId: 'd1', expectedRevision: 3, title: 'Kept' },
  };

  it.each([
    { useCase: 'get', offset: -1, live: true },
    { useCase: 'get', offset: 0, live: false },
    { useCase: 'get', offset: 1, live: false },
    { useCase: 'edit', offset: -1, live: true },
    { useCase: 'edit', offset: 0, live: false },
    { useCase: 'edit', offset: 1, live: false },
    { useCase: 'save', offset: -1, live: true },
    { useCase: 'save', offset: 0, live: false },
    { useCase: 'save', offset: 1, live: false },
  ] as const)(
    '$useCase at expiresAt $offset ms: live = $live, even before cleanup',
    async ({ useCase, offset, live }) => {
      const harness = makeHarness({ start: at(EXPIRES + offset) });
      const row = draftRow(storedSpec(F01, 'd1', 3), { createdAt: at(0), expiresAt: at(EXPIRES) });
      harness.store.putDraft('user-a', row);

      const result =
        useCase === 'get'
          ? await harness.getScore.execute(ALICE, request.get)
          : useCase === 'edit'
            ? await harness.editScore.execute(ALICE, request.edit)
            : await harness.saveScore.execute(ALICE, request.save);

      if (live) {
        expectOk(result);
      } else {
        expect(expectError(result).code).toBe('NOT_FOUND');
        expect(harness.store.writeCalls()).toEqual([]);
        expect(harness.store.draftOf('user-a', 'd1')).toBe(row);
        expect(harness.store.savedCount).toBe(0);
      }
    },
  );

  it('reports an expired draft exactly like a missing one', async () => {
    const harness = makeHarness({ start: at(EXPIRES) });
    harness.store.putDraft(
      'user-a',
      draftRow(storedSpec(F01, 'd1', 3), { createdAt: at(0), expiresAt: at(EXPIRES) }),
    );

    const expired = expectError(await harness.getScore.execute(ALICE, { scoreId: 'd1' }));
    const missing = expectError(await harness.getScore.execute(ALICE, { scoreId: 'never' }));

    expect(expired).toEqual(missing);
  });
});
