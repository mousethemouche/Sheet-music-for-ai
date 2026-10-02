/**
 * HTTP-LIST-01, HTTP-GET-01, HTTP-SYS-01 (issue #21): the real Nest bootstrap
 * (createApiApp) over a real PostgreSQL test database, with session tokens
 * from a local issuer checked by the production verifier.
 *
 * Owned here (TEST_PLAN.md §5): the query-string and path mapping of
 * GET /scores and GET /scores/:id (query + tags + pagination, invalid query
 * 400, no-match 200, drafts never listed or served, missing 404, malformed
 * ID 400, reads write nothing, private caching headers), and the public
 * /health and /version answers plus one unsupported route/method.
 * Reused, not repeated: successful create/save/reopen schemas (FLOW-01) and
 * foreign-owner isolation (ACCESS-01) of #18; search semantics (#9); token
 * matrix (#26 OAUTH-01).
 */
import { readFileSync } from 'node:fs';
import { type ServedTestIssuer, startTestIssuer } from '@sheet-music/auth-jwt/testing';
import {
  errorEnvelopeSchema,
  listScoresResponseSchema,
  savedScoreResponseSchema,
} from '@sheet-music/music-contracts';
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
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CountingStores, type RunningApi, apiStores, startApi } from './support/api-harness';
import { seedDraft, seedSaved } from './support/seed';

const DATABASE = 'sheet_music_test_api';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Seed instants: one day ago, one minute apart, so updatedAt orders the library. */
const BASE = Date.now() - 24 * 60 * 60 * 1000;
const at = (minute: number) => new Date(BASE + minute * 60_000);
const iso = (minute: number) => at(minute).toISOString();

const LIBRARY = [
  { id: 'scr_list_bossa', title: 'Blue Bossa', tags: ['jazz', 'latin'], minute: 1 },
  { id: 'scr_list_green', title: 'Blue in Green', tags: ['jazz', 'ballad'], minute: 2 },
  { id: 'scr_list_alice', title: 'Blues for Alice', tags: ['bebop'], minute: 3 },
  { id: 'scr_list_train', title: 'Blue Train', tags: ['jazz', 'hard-bop'], minute: 4 },
  { id: 'scr_list_autumn', title: 'Autumn Leaves', tags: ['jazz'], minute: 5 },
] as const;
const DRAFT_ID = 'scr_list_draft';
const MISSING_ID = 'scr_list_missing';

let db: TestDatabase;
let issuer: ServedTestIssuer;
let persistence: PostgresPersistence;
let stores: CountingStores;
let api: RunningApi;
let tokenA: string;

beforeAll(async () => {
  db = await createTestDatabase(DATABASE);
  await seedTestUsers(db.admin);
  issuer = await startTestIssuer();
  persistence = createPostgresPersistence({ connectionString: db.url });
  for (const entry of LIBRARY) {
    await seedSaved(persistence, TEST_USER_A.id, { ...entry, at: at(entry.minute) });
  }
  await seedDraft(persistence, TEST_USER_A.id, { id: DRAFT_ID, at: at(6) });
  stores = apiStores(persistence);
  api = await startApi({ supabaseUrl: issuer.projectUrl, stores });
  tokenA = await issuer.sessionToken(TEST_USER_A.id);
});

afterAll(async () => {
  await api?.close();
  await persistence?.close();
  await issuer?.stop();
  await db?.close();
});

function summary(entry: (typeof LIBRARY)[number]) {
  return {
    scoreId: entry.id,
    title: entry.title,
    tags: [...entry.tags],
    revision: 1,
    createdAt: iso(entry.minute),
    updatedAt: iso(entry.minute),
  };
}

const byId = (id: string) => LIBRARY.find((entry) => entry.id === id)!;

function asA(path: string) {
  return request(api.url).get(path).set('Authorization', `Bearer ${tokenA}`);
}

function expectEnvelope(
  response: request.Response,
  status: number,
  code: string,
): Record<string, unknown> {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  const correlationId: unknown = response.headers['x-correlation-id'];
  expect(correlationId).toMatch(UUID);
  const envelope = errorEnvelopeSchema.parse(response.body);
  expect(envelope.code).toBe(code);
  expect(envelope.correlationId).toBe(correlationId);
  return response.body as Record<string, unknown>;
}

function expectPrivate(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(String(response.headers['vary'])).toMatch(/(^|, *)Authorization(,|$)/);
}

async function storedRows() {
  const saved = await db.admin.query<{ id: string; revision: number; updated_at: Date }>(
    'select id, revision, updated_at from public.scores order by id',
  );
  const drafts = await db.admin.query<{
    id: string;
    revision: number;
    updated_at: Date;
    expires_at: Date;
  }>('select id, revision, updated_at, expires_at from public.score_drafts order by id');
  return { saved: saved.rows, drafts: drafts.rows };
}

describe('HTTP-LIST-01 GET /scores maps the query string onto search_scores', () => {
  it('applies normalized text, a tag filter and pagination, and lists summaries only', async () => {
    const response = await asA('/scores?query=%20%20BLUE%20&tags=JAZZ&limit=1&offset=1');

    expect(response.status).toBe(200);
    expectPrivate(response);
    // Blue* titles tagged jazz, newest first: Train (4), Green (2), Bossa (1); Alice has no jazz tag.
    expect(listScoresResponseSchema.parse(response.body)).toEqual({
      items: [summary(byId('scr_list_green'))],
      page: { limit: 1, offset: 1, total: 3, nextOffset: 2 },
    });
  });

  it('reads a repeated tags parameter as several filters that must all match', async () => {
    const response = await asA('/scores?tags=jazz&tags=latin');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [summary(byId('scr_list_bossa'))],
      page: { limit: 20, offset: 0, total: 1, nextOffset: null },
    });
  });

  it('lists every saved score by default and never a draft', async () => {
    const response = await asA('/scores');

    expect(response.status).toBe(200);
    const body = listScoresResponseSchema.parse(response.body);
    expect(body.items.map((item) => item.scoreId)).toEqual([
      'scr_list_autumn',
      'scr_list_train',
      'scr_list_alice',
      'scr_list_green',
      'scr_list_bossa',
    ]);
    expect(body.page).toEqual({ limit: 20, offset: 0, total: 5, nextOffset: null });
    expect(JSON.stringify(response.body)).not.toContain(DRAFT_ID);
  });

  it('answers a search without match with 200 and an empty page', async () => {
    const response = await asA('/scores?query=nocturne');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      page: { limit: 20, offset: 0, total: 0, nextOffset: null },
    });
  });

  it.each([
    { name: 'a page size of 0', query: 'limit=0', path: ['limit'], detail: 'INVALID_VALUE' },
    {
      name: 'a non-numeric page size',
      query: 'limit=ten',
      path: ['limit'],
      detail: 'INVALID_VALUE',
    },
    {
      name: 'an offset over 10000',
      query: 'offset=10001',
      path: ['offset'],
      detail: 'INVALID_VALUE',
    },
    {
      name: 'an owner parameter',
      query: `ownerId=${TEST_USER_B.id}`,
      path: ['ownerId'],
      detail: 'UNKNOWN_FIELD',
    },
  ])('rejects $name with 400 before the use case runs', async ({ query, path, detail }) => {
    const before = stores.snapshot();

    const response = await asA(`/scores?${query}`);

    const body = expectEnvelope(response, 400, 'INVALID_INPUT');
    expect(body['details']).toEqual([expect.objectContaining({ code: detail, path }) as unknown]);
    expect(stores.calls.savedSearch).toBe(before.savedSearch);
  });
});

describe('HTTP-GET-01 GET /scores/:id serves saved scores only', () => {
  it('returns the saved score as private content and the read writes nothing', async () => {
    const rowsBefore = await storedRows();

    const response = await asA('/scores/scr_list_green');

    expect(response.status).toBe(200);
    expectPrivate(response);
    const artifact = savedScoreResponseSchema.parse(response.body);
    expect(artifact).toMatchObject({
      state: 'saved',
      scoreId: 'scr_list_green',
      revision: 1,
      title: 'Blue in Green',
      tags: ['jazz', 'ballad'],
      createdAt: iso(2),
      updatedAt: iso(2),
    });
    expect(artifact.score).toMatchObject({ id: 'scr_list_green', revision: 1 });
    expect(await storedRows()).toEqual(rowsBefore);
  });

  it('answers the caller own draft with the same 404 as a missing score and leaves the draft as it was', async () => {
    const rowsBefore = await storedRows();

    const draft = await asA(`/scores/${DRAFT_ID}`);
    const missing = await asA(`/scores/${MISSING_ID}`);

    const draftBody = expectEnvelope(draft, 404, 'NOT_FOUND');
    const missingBody = expectEnvelope(missing, 404, 'NOT_FOUND');
    expect({ ...draftBody, correlationId: null }).toEqual({ ...missingBody, correlationId: null });
    expect(await storedRows()).toEqual(rowsBefore);
  });

  it.each([
    { name: 'an ID with a forbidden character', path: '/scores/bad!id' },
    { name: 'an ID longer than 64 characters', path: `/scores/s${'x'.repeat(64)}` },
  ])('rejects $name with 400 at the id parameter', async ({ path }) => {
    const before = stores.snapshot();

    const response = await asA(path);

    const body = expectEnvelope(response, 400, 'INVALID_INPUT');
    expect(body['details']).toEqual([
      expect.objectContaining({ code: 'INVALID_VALUE', path: ['id'] }) as unknown,
    ]);
    expect(stores.calls.savedGet).toBe(before.savedGet);
  });

  it('rejects a path with an invalid percent-encoding with a safe 400', async () => {
    const response = await asA('/scores/%E0%A4%A');

    const body = expectEnvelope(response, 400, 'INVALID_INPUT');
    expect(body).toEqual({
      code: 'INVALID_INPUT',
      message: 'The request is malformed.',
      correlationId: response.headers['x-correlation-id'],
    });
  });
});

describe('HTTP-SYS-01 public system routes and unsupported routes', () => {
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };

  it.each([
    { path: '/health', body: { status: 'ok' } },
    { path: '/version', body: { service: 'sheet-music-api', version } },
  ])('GET $path answers 200 without token, secret or storage access', async ({ path, body }) => {
    const before = stores.snapshot();

    const response = await request(api.url).get(path);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(body);
    expect(response.text).not.toContain(db.url);
    expect(response.text).not.toContain(issuer.projectUrl);
    expect(stores.snapshot()).toEqual(before);
  });

  it.each([
    { name: 'an unknown route', method: 'get', path: '/admin' },
    {
      name: 'an unsupported method on a private route',
      method: 'delete',
      path: '/scores/scr_list_green',
    },
    { name: 'a write to the library', method: 'post', path: '/scores' },
  ] as const)(
    'answers $name with a safe JSON 404 and changes nothing',
    async ({ method, path }) => {
      const rowsBefore = await storedRows();

      const agent = request(api.url);
      const response = await agent[method](path).set('Authorization', `Bearer ${tokenA}`);

      const body = expectEnvelope(response, 404, 'NOT_FOUND');
      expect(body).toEqual({
        code: 'NOT_FOUND',
        message: 'No route matches this method and path.',
        correlationId: response.headers['x-correlation-id'],
      });
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.text).not.toContain(path);
      expect(await storedRows()).toEqual(rowsBefore);
    },
  );
});
