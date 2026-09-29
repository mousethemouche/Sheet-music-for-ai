/**
 * ERR-I01, Nest half (issue #19): a real external-dependency failure through
 * the actual Nest pipeline (guards, pipe, controller, runUseCase, exception
 * filter, sendError).
 *
 * The saved-score store is the production Postgres adapter pointed at a
 * database that does not exist (every call fails in PostgreSQL, 3D000); the
 * rate-limit store works, so the request passes request protection and
 * authentication and reaches the use case. Over real HTTP both library
 * routes then answer 503 with the DEPENDENCY_UNAVAILABLE envelope carrying
 * the request's correlation ID (the one in the response header), never a
 * success or an empty page; the server logs one error line with that
 * correlation ID and the redacted cause; nothing in the answer or the logs
 * quotes the connection password.
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
import { type RunningApi, startApi } from './support/api-harness';

const DATABASE = 'sheet_music_test_api';
const PASSWORD = 'not-a-real-secret-9q';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let db: TestDatabase;
let issuer: ServedTestIssuer;
let working: PostgresPersistence;
let broken: PostgresPersistence;
let api: RunningApi;
let token: string;

beforeAll(async () => {
  db = await createTestDatabase(DATABASE);
  await seedTestUsers(db.admin);
  working = createPostgresPersistence({ connectionString: db.url });
  const missing = new URL(db.url);
  missing.pathname = '/sheet_music_missing_database';
  missing.password = PASSWORD;
  broken = createPostgresPersistence({ connectionString: missing.toString() });
  issuer = await startTestIssuer();
  api = await startApi({
    supabaseUrl: issuer.projectUrl,
    stores: { saved: broken.saved, rateLimits: working.rateLimits },
  });
  token = await issuer.sessionToken(TEST_USER_A.id);
});

afterAll(async () => {
  await api?.close();
  await broken?.close();
  await working?.close();
  await issuer?.stop();
  await db?.close();
});

describe('ERR-I01 a store outage through actual Nest routes', () => {
  it.each([
    { route: 'GET /scores', path: '/scores', operation: 'list_scores' },
    { route: 'GET /scores/:id', path: '/scores/scr_any_score', operation: 'get_saved_score' },
  ])(
    '$route answers 503 DEPENDENCY_UNAVAILABLE with the correlated envelope and log line',
    async ({ path, operation }) => {
      const response = await request(api.url).get(path).set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(503);
      const correlationId = response.headers['x-correlation-id'] as string;
      expect(correlationId).toMatch(UUID);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(errorEnvelopeSchema.parse(response.body)).toEqual({
        code: 'DEPENDENCY_UNAVAILABLE',
        message:
          'The score store is temporarily unavailable. Retry later, and reload the score before retrying an edit or a save.',
        correlationId,
      });
      expect(api.logsOf(correlationId)).toEqual([
        expect.objectContaining({
          level: 'error',
          event: 'use_case.failed',
          operation,
          code: 'DEPENDENCY_UNAVAILABLE',
          cause: expect.objectContaining({
            name: 'PersistenceError',
            code: '3D000',
          }) as unknown,
        }),
      ]);
      expect(response.text).not.toContain(PASSWORD);
      expect(JSON.stringify(api.logs)).not.toContain(PASSWORD);
    },
  );
});
