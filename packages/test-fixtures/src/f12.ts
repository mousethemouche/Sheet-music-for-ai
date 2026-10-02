/**
 * F12 of the fixture catalogue (docs/testing/TEST_PLAN.md §4): users A/B, a
 * test clock, deterministic score IDs, and one draft/saved scenario with an
 * expired draft, an exact expiry boundary and tied timestamps. Plain data
 * (ISO-8601 strings, user IDs) with hand-written expectations; no adapter.
 *
 * The user IDs and emails are the values of TEST_USER_A/B in
 * @sheet-music/persistence-postgres/testing, which seeds them into
 * auth.users and is the single source for database suites
 * (docs/testing/HARNESS.md). They are repeated here because this package is
 * pure and imports no adapter.
 */
import { frozen } from './builders';

export interface F12User {
  readonly id: string;
  readonly email: string;
}

/** User A: same values as TEST_USER_A (persistence-postgres/testing). */
export const F12_USER_A: F12User = frozen({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'user-a@example.test',
});

/** User B: same values as TEST_USER_B (persistence-postgres/testing). */
export const F12_USER_B: F12User = frozen({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'user-b@example.test',
});

/** "Now" of the scenario. */
export const F12_NOW = '2026-09-28T12:00:00.000Z';

/** The MVP draft TTL written out: 7 days x 24 h x 3600 s x 1000 ms (ADR-006). */
export const F12_DRAFT_TTL_MS = 604_800_000;

/**
 * A clock that only moves when the test moves it. Structurally the
 * application `Clock` port (`now(): Date`); each call returns a new Date.
 */
export class TestClock {
  private current: number;

  constructor(start: Date | string = F12_NOW) {
    this.current = TestClock.instant(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | string): void {
    this.current = TestClock.instant(instant);
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }

  private static instant(value: Date | string): number {
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) {
      throw new RangeError('TestClock needs a valid instant.');
    }
    return time;
  }
}

/**
 * Deterministic score IDs shaped like production ones ("scr_" + UUID):
 * `scr_00000000-0000-4000-8000-000000000001`, then `...0002`, and so on.
 * Structurally the application `IdGenerator` port. Share one instance per
 * database: two instances issue the same IDs.
 */
export class SequentialScoreIds {
  private issued = 0;

  newScoreId(): string {
    this.issued += 1;
    return `scr_00000000-0000-4000-8000-${String(this.issued).padStart(12, '0')}`;
  }
}

/** A draft row: owner is a user ID, times are ISO-8601 UTC. */
export interface F12DraftRow {
  readonly id: string;
  readonly owner: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

/** A saved-library row: owner is a user ID, times are ISO-8601 UTC. */
export interface F12SavedRow {
  readonly id: string;
  readonly owner: string;
  readonly revision: number;
  readonly title: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

const A = F12_USER_A.id;
const B = F12_USER_B.id;
/** Shared `updatedAt` of the tied saved rows (A's two, and B's). */
const TIE = '2026-09-27T10:00:00.000Z';

/** Drafts at F12_NOW; every `expiresAt` is `updatedAt` + F12_DRAFT_TTL_MS. */
export const F12_DRAFTS: readonly F12DraftRow[] = frozen([
  {
    id: 'scr_f12_a_draft_live',
    owner: A,
    revision: 2,
    createdAt: '2026-09-27T12:00:00.000Z',
    updatedAt: '2026-09-28T11:00:00.000Z',
    expiresAt: '2026-10-05T11:00:00.000Z',
  },
  {
    // Written 7 days minus 1 ms before now: live for one more millisecond.
    id: 'scr_f12_a_draft_last_ms',
    owner: A,
    revision: 1,
    createdAt: '2026-09-21T12:00:00.001Z',
    updatedAt: '2026-09-21T12:00:00.001Z',
    expiresAt: '2026-09-28T12:00:00.001Z',
  },
  {
    // expiresAt == now: expired from this instant on.
    id: 'scr_f12_a_draft_at_expiry',
    owner: A,
    revision: 1,
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    expiresAt: '2026-09-28T12:00:00.000Z',
  },
  {
    // Expired two days ago and not yet removed by cleanup.
    id: 'scr_f12_a_draft_expired',
    owner: A,
    revision: 3,
    createdAt: '2026-09-10T12:00:00.000Z',
    updatedAt: '2026-09-19T12:00:00.000Z',
    expiresAt: '2026-09-26T12:00:00.000Z',
  },
  {
    id: 'scr_f12_b_draft_live',
    owner: B,
    revision: 1,
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: '2026-09-28T09:00:00.000Z',
    expiresAt: '2026-10-05T09:00:00.000Z',
  },
]);

/**
 * Saved scores. A's `tie_b` is listed before `tie_a` on purpose: the same
 * `updatedAt` must be ordered by ID, not by insertion. B's score has the same
 * title, tag and `updatedAt` as A's `tie_a` and must never show up for A.
 */
export const F12_SAVED: readonly F12SavedRow[] = frozen([
  {
    id: 'scr_f12_a_older',
    owner: A,
    revision: 1,
    title: 'Étude in C',
    tags: ['classical'],
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
  },
  {
    id: 'scr_f12_a_tie_b',
    owner: A,
    revision: 2,
    title: 'Blue Bossa',
    tags: ['jazz', 'latin'],
    createdAt: '2026-09-25T10:00:00.000Z',
    updatedAt: TIE,
  },
  {
    id: 'scr_f12_a_tie_a',
    owner: A,
    revision: 1,
    title: 'Autumn Leaves',
    tags: ['jazz'],
    createdAt: TIE,
    updatedAt: TIE,
  },
  {
    id: 'scr_f12_a_newest',
    owner: A,
    revision: 4,
    title: 'Minor Blues',
    tags: ['blues'],
    createdAt: '2026-09-22T10:00:00.000Z',
    updatedAt: '2026-09-28T08:00:00.000Z',
  },
  {
    id: 'scr_f12_b_saved',
    owner: B,
    revision: 1,
    title: 'Autumn Leaves',
    tags: ['jazz'],
    createdAt: TIE,
    updatedAt: TIE,
  },
]);

/**
 * Hand-written expectations at F12_NOW with F12_DRAFT_TTL_MS, per user
 * (`A` is F12_USER_A). ID lists are sorted, except `savedOrder`.
 */
export const F12_EXPECTED = frozen({
  liveDraftIds: {
    A: ['scr_f12_a_draft_last_ms', 'scr_f12_a_draft_live'],
    B: ['scr_f12_b_draft_live'],
  },
  expiredDraftIds: {
    A: ['scr_f12_a_draft_at_expiry', 'scr_f12_a_draft_expired'],
    B: [] as string[],
  },
  /** Library order: `updatedAt` descending, then ID ascending in byte order. */
  savedOrder: {
    A: ['scr_f12_a_newest', 'scr_f12_a_tie_a', 'scr_f12_a_tie_b', 'scr_f12_a_older'],
    B: ['scr_f12_b_saved'],
  },
});
