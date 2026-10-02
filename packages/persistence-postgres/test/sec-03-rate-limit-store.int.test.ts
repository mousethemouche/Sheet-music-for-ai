/**
 * SEC-03, shared store (issue #24, DATABASE.md §6): the Postgres
 * RateLimitStore that server-common's limiter runs on in production, through
 * the real migration and adapter.
 *
 * - Fixed windows aligned on the Unix epoch, counted per key; the window
 *   restarts at its reset instant.
 * - Windows longer than int4 milliseconds (30 days, one year) are accepted,
 *   as server-common's rule check accepts them.
 * - Concurrent hits from two server instances (two pools) lose no increment.
 * - private.prune_rate_limit_windows (the pg_cron job) deletes the ended
 *   windows of keys that are never hit again, batch-bounded and repeatable,
 *   and never a window that is still running.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type PostgresPersistence, createPostgresPersistence } from '../src';
import { type TestDatabase, createTestDatabase } from '../testing';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** 2026-09-28T12:00:00.000Z, a multiple of one minute since the epoch. */
const W0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const at = (offsetMs: number) => new Date(W0 + offsetMs);

let db: TestDatabase;
let instanceA: PostgresPersistence;
let instanceB: PostgresPersistence;

beforeAll(async () => {
  db = await createTestDatabase();
  instanceA = createPostgresPersistence({ connectionString: db.url });
  instanceB = createPostgresPersistence({ connectionString: db.url });
});

beforeEach(async () => {
  await db.admin.query('truncate private.rate_limit_windows');
});

afterAll(async () => {
  await instanceA?.close();
  await instanceB?.close();
  await db?.close();
});

/** The expected window of `now` for `windowMs`, computed independently of the SQL. */
function expectedWindow(windowMs: number, now: Date) {
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  return { windowStartedAt: new Date(start), resetAt: new Date(start + windowMs) };
}

async function storedWindows(): Promise<{ key: string; count: number }[]> {
  const { rows } = await db.admin.query<{ key: string; count: number }>(
    'select key, count from private.rate_limit_windows order by key, window_started_at',
  );
  return rows;
}

function prune(now: Date, batchSize: number): Promise<number> {
  return db.admin
    .query<{ deleted: number }>('select private.prune_rate_limit_windows($1, $2) as deleted', [
      now,
      batchSize,
    ])
    .then(({ rows }) => rows[0]!.deleted);
}

describe('SEC-03 store: fixed windows', () => {
  it('counts hits per key within a window and restarts at the reset instant', async () => {
    const store = instanceA.rateLimits;
    const hits = [
      await store.hit('owner:a', MINUTE, at(0)),
      await store.hit('owner:a', MINUTE, at(59_999)),
      await store.hit('owner:b', MINUTE, at(30_000)),
      await store.hit('owner:a', MINUTE, at(MINUTE)),
    ];

    expect(hits).toEqual([
      { count: 1, ...expectedWindow(MINUTE, at(0)) },
      { count: 2, ...expectedWindow(MINUTE, at(0)) },
      { count: 1, ...expectedWindow(MINUTE, at(0)) },
      { count: 1, ...expectedWindow(MINUTE, at(MINUTE)) },
    ]);
    // The ended window of owner:a was replaced by its new one.
    expect(await storedWindows()).toEqual([
      { key: 'owner:a', count: 1 },
      { key: 'owner:b', count: 1 },
    ]);
  });

  it.each([
    { name: '30 days (past int4 milliseconds)', windowMs: 30 * DAY },
    { name: 'one year', windowMs: 365 * DAY },
  ])('accepts a window of $name', async ({ windowMs }) => {
    const now = at(12_345);
    const first = await instanceA.rateLimits.hit('monthly:a', windowMs, now);
    const second = await instanceA.rateLimits.hit('monthly:a', windowMs, now);

    expect(first).toEqual({ count: 1, ...expectedWindow(windowMs, now) });
    expect(second.count).toBe(2);
  });

  it('loses no increment when two server instances hit one key concurrently', async () => {
    const calls = Array.from({ length: 20 }, (_, index) =>
      (index % 2 === 0 ? instanceA : instanceB).rateLimits.hit('ip:203.0.113.7', MINUTE, at(1_000)),
    );

    const counts = (await Promise.all(calls)).map((window) => window.count);

    expect([...counts].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(await storedWindows()).toEqual([{ key: 'ip:203.0.113.7', count: 20 }]);
  });
});

describe('SEC-03 store: pruning ended windows of idle keys', () => {
  it('deletes the ended windows of 200 idle client addresses and keeps the running one', async () => {
    for (let host = 0; host < 200; host += 1) {
      await instanceA.rateLimits.hit(`ip:10.0.${host >> 8}.${host & 255}`, MINUTE, at(0));
    }
    // Months later, another key is hit: the idle keys' windows are still there.
    const later = at(150 * DAY);
    await instanceA.rateLimits.hit('ip:198.51.100.1', MINUTE, later);
    expect(await storedWindows()).toHaveLength(201);

    expect(await prune(later, 1_000)).toBe(200);
    expect(await storedWindows()).toEqual([{ key: 'ip:198.51.100.1', count: 1 }]);
    expect(await prune(later, 1_000)).toBe(0);
  });

  it('prunes a window from its reset instant on, never before', async () => {
    await instanceA.rateLimits.hit('ip:a', MINUTE, at(0));
    await instanceA.rateLimits.hit('ip:b', MINUTE, at(MINUTE));

    expect(await prune(at(MINUTE - 1), 1_000)).toBe(0);
    expect(await prune(at(MINUTE), 1_000)).toBe(1);
    expect(await storedWindows()).toEqual([{ key: 'ip:b', count: 1 }]);
  });

  it('deletes at most one batch per call, oldest windows first', async () => {
    for (const [index, key] of ['ip:1', 'ip:2', 'ip:3', 'ip:4', 'ip:5'].entries()) {
      await instanceA.rateLimits.hit(key, MINUTE, at(index * MINUTE));
    }
    const end = at(10 * MINUTE);

    expect(await prune(end, 2)).toBe(2);
    expect((await storedWindows()).map((row) => row.key)).toEqual(['ip:3', 'ip:4', 'ip:5']);
    expect([await prune(end, 2), await prune(end, 2), await prune(end, 2)]).toEqual([2, 1, 0]);
  });

  it('does not change a limiting decision: a pruned key starts its next window at 1', async () => {
    await instanceA.rateLimits.hit('owner:a', MINUTE, at(0));
    await instanceA.rateLimits.hit('owner:a', MINUTE, at(1_000));
    await prune(at(MINUTE), 1_000);

    expect(await instanceA.rateLimits.hit('owner:a', MINUTE, at(MINUTE))).toEqual({
      count: 1,
      ...expectedWindow(MINUTE, at(MINUTE)),
    });
  });

  it.each<{ name: string; values: unknown[] }>([
    { name: 'a zero batch size', values: [at(0), 0] },
    { name: 'no instant', values: [null, 10] },
  ])('refuses $name', async ({ values }) => {
    await expect(
      db.admin.query('select private.prune_rate_limit_windows($1, $2)', values),
    ).rejects.toMatchObject({ code: '22023' });
  });
});
