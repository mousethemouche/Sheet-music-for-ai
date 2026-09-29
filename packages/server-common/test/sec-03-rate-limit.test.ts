/**
 * SEC-03, unit part (issue #24): fixed-window decisions at the exact window
 * boundaries with a fake clock, independent owner and IP quotas, and the
 * middleware's refusal to run the handler when over the limit or when the
 * store is down. The shared Postgres store behind a real app is SEC-03
 * wire (apps/mcp/test/sec-03-rate-limit.int.test.ts and
 * apps/api/test/sec-02-sec-03-api-protection.int.test.ts).
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  type RateLimitRule,
  checkRule,
  consumeRateLimit,
  createLogger,
  rateLimit,
} from '../src/index';
import { FixedWindowTestStore } from './support/fixed-window-store';

const MINUTE = 60_000;
/** 2026-09-28T12:00:00.000Z, a multiple of one minute since the epoch: a window starts here. */
const W0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const at = (offsetMs: number) => new Date(W0 + offsetMs);

const OWNER: RateLimitRule = { name: 'owner', limit: 3, windowMs: MINUTE };
const IP: RateLimitRule = { name: 'ip', limit: 5, windowMs: MINUTE };

async function exhaust(store: FixedWindowTestStore, rule: RateLimitRule, subject: string) {
  for (let hit = 0; hit < rule.limit; hit += 1) {
    await consumeRateLimit(store, rule, subject, at(hit * 1_000));
  }
}

describe('SEC-03 fixed-window decisions', () => {
  it('allows up to the limit in one window and refuses the next request with the time left, rounded up', async () => {
    const store = new FixedWindowTestStore();
    const decisions = [];
    for (const offset of [0, 1_000, 2_000, 30_500]) {
      decisions.push(await consumeRateLimit(store, OWNER, 'user-a', at(offset)));
    }

    expect(decisions.map(({ allowed, count }) => ({ allowed, count }))).toEqual([
      { allowed: true, count: 1 },
      { allowed: true, count: 2 },
      { allowed: true, count: 3 },
      { allowed: false, count: 4 },
    ]);
    expect(decisions[3]).toMatchObject({ retryAfterSeconds: 30, resetAt: at(MINUTE) });
  });

  it.each([
    {
      name: 'one millisecond before the reset',
      offset: MINUTE - 1,
      allowed: false,
      count: 4,
      retry: 1,
    },
    { name: 'exactly at the reset', offset: MINUTE, allowed: true, count: 1, retry: 60 },
  ])('$name: allowed=$allowed', async ({ offset, allowed, count, retry }) => {
    const store = new FixedWindowTestStore();
    await exhaust(store, OWNER, 'user-a');

    const decision = await consumeRateLimit(store, OWNER, 'user-a', at(offset));

    expect(decision).toMatchObject({ allowed, count, retryAfterSeconds: retry });
  });

  it("gives each owner an independent quota: A's exhaustion does not limit B", async () => {
    const store = new FixedWindowTestStore();
    await exhaust(store, OWNER, 'user-a');

    expect(await consumeRateLimit(store, OWNER, 'user-a', at(5_000))).toMatchObject({
      allowed: false,
    });
    expect(await consumeRateLimit(store, OWNER, 'user-b', at(5_000))).toMatchObject({
      allowed: true,
      count: 1,
    });
  });

  it('keeps per-owner and per-IP counters apart, even for the same subject string', async () => {
    const store = new FixedWindowTestStore();
    await exhaust(store, OWNER, '203.0.113.7');

    expect(await consumeRateLimit(store, IP, '203.0.113.7', at(5_000))).toMatchObject({
      allowed: true,
      count: 1,
    });
    expect(new Set(store.keys)).toEqual(new Set(['owner:203.0.113.7', 'ip:203.0.113.7']));
  });

  it.each([
    {
      name: 'a name containing the key separator',
      rule: { name: 'owner:x', limit: 1, windowMs: MINUTE },
    },
    { name: 'a zero limit', rule: { name: 'owner', limit: 0, windowMs: MINUTE } },
    { name: 'a fractional window', rule: { name: 'owner', limit: 1, windowMs: 0.5 } },
  ])('refuses $name', ({ rule }) => {
    expect(() => checkRule(rule)).toThrow();
  });
});

describe('SEC-03 middleware refusals', () => {
  function call(store: FixedWindowTestStore, subject: string | undefined, now: Date) {
    const lines: string[] = [];
    const handler = rateLimit({
      store,
      rule: OWNER,
      subject: () => subject,
      logger: createLogger({ write: (line) => lines.push(line) }),
      now: () => now,
    });
    const req = new IncomingMessage(new Socket());
    const res = new ServerResponse(req);
    const next = vi.fn();
    return {
      lines,
      res,
      next,
      run: () => handler(req as unknown as Request, res as unknown as Response, next),
    };
  }

  it('answers 429 with Retry-After and never runs the handler over the limit', async () => {
    const store = new FixedWindowTestStore();
    await exhaust(store, OWNER, 'user-a');
    const { res, next, run } = call(store, 'user-a', at(20_000));

    await run();

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.getHeader('retry-after')).toBe('40');
  });

  it('fails closed with 503 when the store is down, and logs the failure', async () => {
    const store = new FixedWindowTestStore();
    store.failing = true;
    const { res, next, run, lines } = call(store, 'user-a', at(0));

    await run();

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(lines.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual([
      'rate_limit.store_failed',
    ]);
  });

  it('lets a request without a subject through without counting it', async () => {
    const store = new FixedWindowTestStore();
    const { next, run } = call(store, undefined, at(0));

    await run();

    expect(next).toHaveBeenCalledTimes(1);
    expect(store.keys).toEqual([]);
  });
});
