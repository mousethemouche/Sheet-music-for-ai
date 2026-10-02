/**
 * SEC-03 wire, MCP app (issue #24; ERRORS_AND_SECURITY.md §3.3): the
 * production limiter middleware on the shared Postgres RateLimitStore
 * behind the real app, with small rules and a test clock driving the
 * windows (aligned on the epoch: 60 s windows start at :00).
 *
 * - Per owner (after authentication): over the limit is 429 RATE_LIMITED
 *   with Retry-After, the tool never runs and nothing is written; another
 *   owner keeps its own quota; the next window resets the count.
 * - Per IP (before authentication): unauthenticated requests count too, and
 *   the next request is refused before its token is even verified.
 *
 * Window arithmetic is covered by SEC-03 unit (server-common) and the store
 * by SEC-03 store (persistence-postgres); this is the wiring.
 */
import { TEST_USER_A, TEST_USER_B } from '@sheet-music/persistence-postgres/testing';
import { F01, TestClock } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpTestBackend, openMcpTestBackend, rowCounts } from './support/backend';
import { type RunningMcpApp, startMcpApp } from './support/mcp-harness';
import {
  MCP_ACCEPT,
  type RawResponse,
  UUID,
  httpEnvelopeOf,
  postJsonRpc,
  rawToolCall,
  scoreArgument,
} from './support/tool-calls';

const RULES = {
  perIp: { name: 'mcp-ip', limit: 8, windowMs: 60_000 },
  perOwner: { name: 'mcp-owner', limit: 3, windowMs: 60_000 },
};

let backend: McpTestBackend;
let app: RunningMcpApp;
let tokenA: string;
let tokenB: string;
const clock = new TestClock('2026-09-28T12:00:10.000Z');

beforeAll(async () => {
  backend = await openMcpTestBackend();
  app = await startMcpApp({ stores: backend.persistence, clock, rateLimits: RULES });
  tokenA = await app.token(TEST_USER_A.id);
  tokenB = await app.token(TEST_USER_B.id);
});

afterAll(async () => {
  await app?.close();
  await backend?.close();
});

function create(token: string | undefined): Promise<RawResponse> {
  return rawToolCall(app.url, token, 'create_score', { score: scoreArgument(F01) });
}

function expectServedTool(response: RawResponse): void {
  expect(response.status).toBe(200);
  expect((JSON.parse(response.text) as { result: { isError?: boolean } }).result.isError).toBe(
    undefined,
  );
}

function expectRateLimited(response: RawResponse, retryAfter: string): void {
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe(retryAfter);
  const correlationId = response.headers.get('x-correlation-id');
  expect(correlationId).toMatch(UUID);
  expect(httpEnvelopeOf(response)).toEqual({
    code: 'RATE_LIMITED',
    message: expect.any(String) as string,
    correlationId,
  });
}

/** The shared counter of `owner` in the window starting at `windowStart` (0: no row). */
async function ownerCount(owner: string, windowStart: string): Promise<number> {
  const { rows } = await backend.db.admin.query<{ count: number }>(
    `select count from private.rate_limit_windows where key = $1 and window_started_at = $2`,
    [`mcp-owner:${owner}`, new Date(windowStart)],
  );
  return rows[0]?.count ?? 0;
}

describe('SEC-03 per-owner limit on the shared Postgres store', () => {
  it("serves A's first 3 calls of the window, then 429 with Retry-After, without running the tool", async () => {
    for (let call = 0; call < 3; call += 1) {
      expectServedTool(await create(tokenA));
    }
    const transportBefore = app.transportRequests();

    const refused = await create(tokenA);

    // 12:00:10 -> the window ends at 12:01:00.
    expectRateLimited(refused, '50');
    expect(app.transportRequests()).toBe(transportBefore);
    expect(await rowCounts(backend, TEST_USER_A.id)).toEqual({ drafts: 3, saved: 0 });
    expect(await ownerCount(TEST_USER_A.id, '2026-09-28T12:00:00.000Z')).toBe(4);
  });

  it("keeps B's quota independent of A's", async () => {
    expectServedTool(await create(tokenB));
    expect(await rowCounts(backend, TEST_USER_B.id)).toEqual({ drafts: 1, saved: 0 });
    expect(await ownerCount(TEST_USER_B.id, '2026-09-28T12:00:00.000Z')).toBe(1);
  });

  it('serves A again once the window has ended', async () => {
    clock.set('2026-09-28T12:01:00.000Z');

    expectServedTool(await create(tokenA));
    expect(await rowCounts(backend, TEST_USER_A.id)).toEqual({ drafts: 4, saved: 0 });
  });
});

describe('SEC-03 a JSON-RPC batch cannot multiply the per-owner quota', () => {
  it('refuses a batch of more create_score calls than the limit with 400 Invalid Request, writing nothing', async () => {
    clock.set('2026-09-28T12:03:00.000Z');
    const before = await rowCounts(backend, TEST_USER_B.id);
    const transportBefore = app.transportRequests();
    const batch = Array.from({ length: RULES.perOwner.limit + 2 }, (_, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'tools/call',
      params: { name: 'create_score', arguments: { score: scoreArgument(F01) } },
    }));

    const response = await fetch(app.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
        accept: MCP_ACCEPT,
      },
      body: JSON.stringify(batch),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request: JSON-RPC batches are not supported.' },
      id: null,
    });
    expect(app.transportRequests()).toBe(transportBefore);
    expect(await rowCounts(backend, TEST_USER_B.id)).toEqual(before);
    // The whole batch was one request for the limiter.
    expect(await ownerCount(TEST_USER_B.id, '2026-09-28T12:03:00.000Z')).toBe(1);
  });
});

describe('SEC-03 per-IP limit before authentication', () => {
  it('counts unauthenticated requests and refuses the next valid call before verifying it', async () => {
    clock.set('2026-09-28T12:05:00.000Z');
    for (let call = 0; call < RULES.perIp.limit; call += 1) {
      expect((await postJsonRpc(app.url, { method: 'tools/list' })).status).toBe(401);
    }

    const refused = await create(tokenA);

    expectRateLimited(refused, '60');
    // The guard and the per-owner limit never ran: A has no counter in this window.
    expect(await ownerCount(TEST_USER_A.id, '2026-09-28T12:05:00.000Z')).toBe(0);
    expect(await rowCounts(backend, TEST_USER_A.id)).toEqual({ drafts: 4, saved: 0 });
  });
});
