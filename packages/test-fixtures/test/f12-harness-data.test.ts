/**
 * HARNESS-01 (issue #18), F12 data: the users, clock, ID generator and
 * draft/saved scenario that FLOW-01/ACCESS-01 and the app suites build on are
 * internally consistent, so a suite failure points at the product, not at
 * the data. Expected values are hand-written; ID validity is checked with
 * the real music-contracts `scoreIdSchema`.
 */
import { scoreIdSchema } from '@sheet-music/music-contracts';
import { describe, expect, it } from 'vitest';
import {
  F12_DRAFTS,
  F12_DRAFT_TTL_MS,
  F12_EXPECTED,
  F12_NOW,
  F12_SAVED,
  F12_USER_A,
  F12_USER_B,
  SequentialScoreIds,
  TestClock,
} from '../src/index';

const ms = (iso: string): number => new Date(iso).getTime();
const USERS = { A: F12_USER_A.id, B: F12_USER_B.id } as const;

describe('F12 users', () => {
  it('A and B are distinct fixed UUIDs with reserved test emails', () => {
    expect(F12_USER_A).toEqual({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'user-a@example.test',
    });
    expect(F12_USER_B).toEqual({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'user-b@example.test',
    });
  });
});

describe('F12 TestClock', () => {
  it('starts at F12_NOW and only moves when told to', () => {
    const clock = new TestClock();
    const first = clock.now();
    first.setTime(0);

    expect(clock.now().toISOString()).toBe('2026-09-28T12:00:00.000Z');
    clock.advance(F12_DRAFT_TTL_MS);
    expect(clock.now().toISOString()).toBe('2026-10-05T12:00:00.000Z');
    clock.set('2026-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('refuses an invalid instant', () => {
    expect(() => new TestClock('not a date')).toThrow(RangeError);
  });
});

describe('F12 SequentialScoreIds', () => {
  it('issues production-shaped IDs in order, valid for the score ID contract', () => {
    const ids = new SequentialScoreIds();
    const issued = [ids.newScoreId(), ids.newScoreId(), ids.newScoreId()];

    expect(issued).toEqual([
      'scr_00000000-0000-4000-8000-000000000001',
      'scr_00000000-0000-4000-8000-000000000002',
      'scr_00000000-0000-4000-8000-000000000003',
    ]);
    for (const id of issued) {
      expect(scoreIdSchema.safeParse(id).success).toBe(true);
    }
  });
});

describe('F12 draft/saved scenario', () => {
  it('uses unique, contract-valid score IDs owned by A or B', () => {
    const rows = [...F12_DRAFTS, ...F12_SAVED];

    expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length);
    for (const row of rows) {
      expect(scoreIdSchema.safeParse(row.id).success, row.id).toBe(true);
      expect([USERS.A, USERS.B], row.id).toContain(row.owner);
    }
  });

  it('gives every draft expiresAt = updatedAt + 7 days and createdAt <= updatedAt', () => {
    for (const draft of F12_DRAFTS) {
      expect(ms(draft.expiresAt) - ms(draft.updatedAt), draft.id).toBe(F12_DRAFT_TTL_MS);
      expect(ms(draft.createdAt), draft.id).toBeLessThanOrEqual(ms(draft.updatedAt));
    }
  });

  it.each(['A', 'B'] as const)(
    'classifies %s drafts as live (now < expiresAt) or expired',
    (user) => {
      const own = F12_DRAFTS.filter(({ owner }) => owner === USERS[user]);
      const live = own.filter(({ expiresAt }) => ms(F12_NOW) < ms(expiresAt)).map(({ id }) => id);
      const expired = own
        .filter(({ expiresAt }) => ms(F12_NOW) >= ms(expiresAt))
        .map(({ id }) => id);

      expect(live.sort()).toEqual(F12_EXPECTED.liveDraftIds[user]);
      expect(expired.sort()).toEqual(F12_EXPECTED.expiredDraftIds[user]);
    },
  );

  it('holds the exact expiry boundary: one draft expires at now, one 1 ms later', () => {
    const expiries = F12_DRAFTS.map(({ expiresAt }) => ms(expiresAt) - ms(F12_NOW));

    expect(expiries).toContain(0);
    expect(expiries).toContain(1);
  });

  it.each(['A', 'B'] as const)(
    'orders %s saved scores by updatedAt desc then ID in byte order',
    (user) => {
      const own = F12_SAVED.filter(({ owner }) => owner === USERS[user]);
      const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      const ordered = [...own]
        .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt) || byteOrder(a.id, b.id))
        .map(({ id }) => id);

      expect(ordered).toEqual(F12_EXPECTED.savedOrder[user]);
    },
  );

  it('contains a real tie that insertion order would get wrong', () => {
    const tied = F12_SAVED.filter(
      ({ owner, updatedAt }) => owner === USERS.A && updatedAt === '2026-09-27T10:00:00.000Z',
    ).map(({ id }) => id);

    expect(tied).toEqual(['scr_f12_a_tie_b', 'scr_f12_a_tie_a']);
    expect(F12_EXPECTED.savedOrder.A.filter((id) => tied.includes(id))).toEqual([
      'scr_f12_a_tie_a',
      'scr_f12_a_tie_b',
    ]);
  });
});
