/**
 * OAUTH-02, REST half (issue #26, AUTH_MCP_OAUTH.md §6.3 and §7): the
 * production auth wiring of apps/api over real HTTP, with the Supabase URL of
 * a served local issuer (the JWKS is fetched over loopback HTTP by the
 * production key source).
 *
 * - One missing-token check per protected route: 401 with
 *   `WWW-Authenticate: Bearer` and the UNAUTHENTICATED envelope, before any
 *   storage read.
 * - One invalid token: a valid OAuth token issued for the MCP (it carries a
 *   `client_id`) is refused by the session client binding with the generic
 *   `invalid_token` challenge; only the reason is logged, never the token.
 * - The key source unreachable is 503 DEPENDENCY_UNAVAILABLE without a
 *   challenge, never a 401 that would send the web app to sign in again.
 * The token matrix itself is OAUTH-01's (packages/auth-jwt).
 */
import { type ServedTestIssuer, startTestIssuer } from '@sheet-music/auth-jwt/testing';
import { errorEnvelopeSchema } from '@sheet-music/music-contracts';
import {
  type PostgresPersistence,
  createPostgresPersistence,
} from '@sheet-music/persistence-postgres';
import {
  TEST_USER_A,
  type TestDatabase,
  createTestDatabase,
  seedTestUsers,
} from '@sheet-music/persistence-postgres/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CountingStores, type RunningApi, apiStores, startApi } from './support/api-harness';

const DATABASE = 'sheet_music_test_api';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INVALID_TOKEN_CHALLENGE =
  'Bearer error="invalid_token", error_description="The access token is invalid or expired."';

let db: TestDatabase;
let issuer: ServedTestIssuer;
let unreachableIssuer: ServedTestIssuer;
let persistence: PostgresPersistence;
let stores: CountingStores;
let api: RunningApi;
let apiWithoutKeys: RunningApi;

beforeAll(async () => {
  db = await createTestDatabase(DATABASE);
  await seedTestUsers(db.admin);
  persistence = createPostgresPersistence({ connectionString: db.url });
  stores = apiStores(persistence);
  issuer = await startTestIssuer();
  api = await startApi({ supabaseUrl: issuer.projectUrl, stores });
  // An issuer whose JWKS endpoint is gone before the app ever fetched it.
  unreachableIssuer = await startTestIssuer();
  await unreachableIssuer.stop();
  apiWithoutKeys = await startApi({ supabaseUrl: unreachableIssuer.projectUrl, stores });
});

afterAll(async () => {
  await apiWithoutKeys?.close();
  await api?.close();
  await persistence?.close();
  await issuer?.stop();
  await db?.close();
});

function expectUnauthenticated(response: request.Response, challenge: string): string {
  expect(response.status).toBe(401);
  expect(response.headers['www-authenticate']).toBe(challenge);
  const correlationId = response.headers['x-correlation-id'] as string;
  expect(correlationId).toMatch(UUID);
  expect(errorEnvelopeSchema.parse(response.body)).toEqual({
    code: 'UNAUTHENTICATED',
    message: 'Authentication is required.',
    correlationId,
  });
  return correlationId;
}

describe('OAUTH-02 protected REST routes require a session token', () => {
  it.each([
    { route: 'GET /scores', path: '/scores' },
    { route: 'GET /scores/:id', path: '/scores/scr_any_score' },
  ])('$route without a token is 401 Bearer before any storage read', async ({ path }) => {
    const before = stores.snapshot();

    const response = await request(api.url).get(path);

    const correlationId = expectUnauthenticated(response, 'Bearer');
    expect(stores.calls.savedGet).toBe(before.savedGet);
    expect(stores.calls.savedSearch).toBe(before.savedSearch);
    expect(api.logsOf(correlationId)).toEqual([
      expect.objectContaining({ event: 'auth.rejected', reason: 'MISSING_TOKEN' }) as unknown,
    ]);
  });

  it('refuses an OAuth token issued for the MCP with the generic invalid_token challenge', async () => {
    const mcpToken = await issuer.mcpToken(TEST_USER_A.id, 'https://mcp.example.test/mcp');
    const before = stores.snapshot();

    const response = await request(api.url)
      .get('/scores')
      .set('Authorization', `Bearer ${mcpToken}`);

    const correlationId = expectUnauthenticated(response, INVALID_TOKEN_CHALLENGE);
    expect(stores.calls.savedSearch).toBe(before.savedSearch);
    const logged = api.logsOf(correlationId);
    expect(logged).toEqual([
      expect.objectContaining({ event: 'auth.rejected', reason: 'CLIENT_NOT_ALLOWED' }) as unknown,
    ]);
    expect(JSON.stringify(api.logs)).not.toContain(mcpToken);
  });

  it('accepts a session token of the configured project', async () => {
    const token = await issuer.sessionToken(TEST_USER_A.id);

    const response = await request(api.url).get('/scores').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      page: { limit: 20, offset: 0, total: 0, nextOffset: null },
    });
  });

  it('answers 503 without a challenge when the signing keys cannot be fetched', async () => {
    const token = await unreachableIssuer.sessionToken(TEST_USER_A.id);
    const before = stores.snapshot();

    const response = await request(apiWithoutKeys.url)
      .get('/scores')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.headers['www-authenticate']).toBeUndefined();
    const correlationId = response.headers['x-correlation-id'] as string;
    expect(errorEnvelopeSchema.parse(response.body)).toEqual({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable. Retry later.',
      correlationId,
    });
    expect(stores.calls.savedSearch).toBe(before.savedSearch);
    expect(apiWithoutKeys.logsOf(correlationId)).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'auth.keys_unavailable',
        reason: 'KEYS_UNAVAILABLE',
      }) as unknown,
    ]);
  });
});
