/**
 * SEC-02 (apps/api) and SEC-03 wire (issue #24, ERRORS_AND_SECURITY.md §3
 * and §5 item 4): the production request protection of createApiApp over
 * real HTTP, with the rate limits counted in the shared PostgreSQL store.
 *
 * SEC-02: a forbidden or "null" Origin is 403 before any work (no limit
 * counted, no token checked, nothing read); a CORS preflight from the web
 * origin is 204 with the configured policy; the allowed origin gets CORS
 * headers on real answers; a call without Origin (server to server) goes
 * on; a declared body over the cap is 413 and a chunked body 411, before
 * any work.
 * SEC-03: the per-owner limit behind the auth guard answers 429 with
 * Retry-After without running the handler, counts each owner separately and
 * resets with the next window; the per-IP limit runs before authentication.
 * The limiter's window arithmetic and fail-closed 503 are SEC-03 unit
 * (server-common) and the store itself SEC-03 store (persistence-postgres).
 */
import { type ServedTestIssuer, startTestIssuer } from '@sheet-music/auth-jwt/testing';
import { errorEnvelopeSchema } from '@sheet-music/music-contracts';
import {
  type PostgresPersistence,
  createPostgresPersistence,
} from '@sheet-music/persistence-postgres';
import {
  TEST_USER_A,
  TEST_USER_B,
  type TestDatabase,
  createTestDatabase,
  seedTestUsers,
} from '@sheet-music/persistence-postgres/testing';
import { TestClock } from '@sheet-music/test-fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CountingStores, type RunningApi, apiStores, startApi } from './support/api-harness';
import { type RawResponse, rawRequest } from './support/raw-request';

const DATABASE = 'sheet_music_test_api';
const WEB_ORIGIN = 'https://app.example.test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MINUTE = 60_000;
/** Two distinct minute-aligned windows, far from system time, one per limiter scenario. */
const OWNER_WINDOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const IP_WINDOW = Date.UTC(2026, 8, 28, 13, 0, 0);

let db: TestDatabase;
let issuer: ServedTestIssuer;
let persistence: PostgresPersistence;
let stores: CountingStores;
let api: RunningApi;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  db = await createTestDatabase(DATABASE);
  await seedTestUsers(db.admin);
  persistence = createPostgresPersistence({ connectionString: db.url });
  stores = apiStores(persistence);
  issuer = await startTestIssuer();
  api = await startApi({ supabaseUrl: issuer.projectUrl, stores, allowedOrigins: [WEB_ORIGIN] });
  tokenA = await issuer.sessionToken(TEST_USER_A.id);
  tokenB = await issuer.sessionToken(TEST_USER_B.id);
});

afterAll(async () => {
  await api?.close();
  await persistence?.close();
  await issuer?.stop();
  await db?.close();
});

function expectTransportError(response: RawResponse, status: number, code: string): void {
  expect(response.status).toBe(status);
  const correlationId = response.headers['x-correlation-id'];
  expect(correlationId).toMatch(UUID);
  expect(errorEnvelopeSchema.parse(JSON.parse(response.body))).toEqual({
    code,
    message: expect.any(String) as string,
    correlationId,
  });
}

describe('SEC-02 Origin policy before any work', () => {
  it.each([
    {
      name: 'GET /scores from a foreign origin',
      method: 'GET',
      path: '/scores',
      origin: 'https://evil.example',
    },
    { name: 'GET /scores with Origin null', method: 'GET', path: '/scores', origin: 'null' },
    {
      name: 'a preflight from a foreign origin',
      method: 'OPTIONS',
      path: '/scores',
      origin: 'https://evil.example',
    },
    {
      name: 'GET /health from a foreign origin',
      method: 'GET',
      path: '/health',
      origin: 'https://evil.example',
    },
  ])('answers $name with 403 and no CORS header', async ({ method, path, origin }) => {
    const before = stores.snapshot();
    const headers: Record<string, string> = { origin, authorization: `Bearer ${tokenA}` };
    if (method === 'OPTIONS') {
      headers['access-control-request-method'] = 'GET';
    }

    const response = await rawRequest(`${api.url}${path}`, method, headers, '');

    expectTransportError(response, 403, 'FORBIDDEN_ORIGIN');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(stores.snapshot()).toEqual(before);
    expect(api.logsOf(response.headers['x-correlation-id'] as string)).toEqual([]);
  });

  it('answers a preflight from the web origin with 204 and the configured policy', async () => {
    const before = stores.snapshot();

    const response = await rawRequest(
      `${api.url}/scores`,
      'OPTIONS',
      {
        origin: WEB_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
      '',
    );

    expect(response.status).toBe(204);
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': WEB_ORIGIN,
      'access-control-allow-methods': 'GET',
      'access-control-allow-headers': 'authorization, x-correlation-id',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
    expect(response.body).toBe('');
    expect(stores.snapshot()).toEqual(before);
  });

  it.each([
    { name: 'from the web origin', origin: WEB_ORIGIN, allowOrigin: WEB_ORIGIN },
    { name: 'without Origin (a server-to-server call)', origin: undefined, allowOrigin: undefined },
  ])('serves an authenticated GET /scores $name', async ({ origin, allowOrigin }) => {
    const call = request(api.url).get('/scores').set('Authorization', `Bearer ${tokenA}`);
    const response = await (origin === undefined ? call : call.set('Origin', origin));

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(allowOrigin);
    if (allowOrigin !== undefined) {
      expect(response.headers['access-control-expose-headers']).toBe(
        'www-authenticate, x-correlation-id, retry-after',
      );
    }
    expect(response.body).toEqual({
      items: [],
      page: { limit: 20, offset: 0, total: 0, nextOffset: null },
    });
  });
});

describe('SEC-02 body cap before any work', () => {
  it('answers a declared body over 512 KiB with 413 and closes the connection', async () => {
    const before = stores.snapshot();

    const response = await rawRequest(`${api.url}/scores`, 'GET', {
      authorization: `Bearer ${tokenA}`,
      'content-type': 'application/json',
      'content-length': String(512 * 1024 + 1),
    });

    expectTransportError(response, 413, 'PAYLOAD_TOO_LARGE');
    expect(response.headers['connection']).toBe('close');
    expect(stores.snapshot()).toEqual(before);
    expect(api.logsOf(response.headers['x-correlation-id'] as string)).toEqual([]);
  });

  it('answers a chunked body (no declared length) with 411', async () => {
    const before = stores.snapshot();

    const response = await rawRequest(`${api.url}/scores`, 'GET', {
      authorization: `Bearer ${tokenA}`,
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    });

    expectTransportError(response, 411, 'LENGTH_REQUIRED');
    expect(stores.snapshot()).toEqual(before);
  });
});

describe('SEC-03 rate limits on the shared store behind the real app', () => {
  let limited: RunningApi;
  let limitedStores: CountingStores;
  const clock = new TestClock(new Date(OWNER_WINDOW + 15_000).toISOString());

  beforeAll(async () => {
    limitedStores = apiStores(persistence);
    limited = await startApi({
      supabaseUrl: issuer.projectUrl,
      stores: limitedStores,
      rateLimits: {
        perOwner: { name: 'api-owner', limit: 2, windowMs: MINUTE },
        now: () => clock.now(),
      },
    });
  });

  afterAll(async () => {
    await limited?.close();
  });

  const list = (token: string) =>
    request(limited.url).get('/scores').set('Authorization', `Bearer ${token}`);

  it('answers the owner over the limit with 429 and Retry-After, without running the handler', async () => {
    expect((await list(tokenA)).status).toBe(200);
    expect((await list(tokenA)).status).toBe(200);
    const searchesBefore = limitedStores.calls.savedSearch;

    const response = await list(tokenA);

    expect(response.status).toBe(429);
    // 15 s into a 60 s window: 45 s to the reset.
    expect(response.headers['retry-after']).toBe('45');
    expect(errorEnvelopeSchema.parse(response.body)).toMatchObject({ code: 'RATE_LIMITED' });
    expect(limitedStores.calls.savedSearch).toBe(searchesBefore);
  });

  it('counts another owner separately in the same window', async () => {
    const response = await list(tokenB);

    expect(response.status).toBe(200);
  });

  it('serves the owner again from the next window', async () => {
    clock.set(new Date(OWNER_WINDOW + MINUTE));

    const response = await list(tokenA);

    expect(response.status).toBe(200);
  });

  it('applies the per-IP limit before authentication', async () => {
    const ipClock = new TestClock(new Date(IP_WINDOW).toISOString());
    const ipLimited = await startApi({
      supabaseUrl: issuer.projectUrl,
      stores: apiStores(persistence),
      rateLimits: {
        perIp: { name: 'api-ip', limit: 1, windowMs: MINUTE },
        now: () => ipClock.now(),
      },
    });
    try {
      const first = await request(ipLimited.url).get('/scores');
      const second = await request(ipLimited.url).get('/scores');

      expect(first.status).toBe(401);
      expect(second.status).toBe(429);
      expect(second.headers['retry-after']).toBe('60');
      expect(second.headers['www-authenticate']).toBeUndefined();
      expect(ipLimited.logsOf(second.headers['x-correlation-id'] as string)).toEqual([]);
    } finally {
      await ipLimited.close();
    }
  });
});
