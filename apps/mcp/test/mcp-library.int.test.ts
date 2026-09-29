/**
 * save_score, get_score and search_scores over the production MCP
 * composition (#14): real HTTP MCP client, token from the local test issuer,
 * bearer guard, use cases, Postgres adapters. A test clock orders writes and
 * expires drafts.
 *
 * - MCP-LIB-01: explicit save of a rich draft (same ID, revision and content;
 *   one saved row, no draft), reopen with get_score, and search returning
 *   summaries only, never drafts. FLOW-01 (#18) runs the full lifecycle.
 * - MCP-SAVE-02: invalid metadata, a consent flag, a stale revision and an
 *   expired own draft promote nothing; an identical replay is
 *   "already_saved" with no write; a different replay is ALREADY_SAVED.
 * - MCP-GET-02: missing, expired and unreadable stored records fail safely;
 *   one malformed ID; reads renew no TTL and change no revision.
 * - MCP-SEARCH-02: one query + tags + pagination request through the shared
 *   query logic, a no-match success, malformed pagination rejected. The
 *   matching/ordering matrix is DB-02's (#9).
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  type SearchScoresOutput,
  createScoreOutputSchema,
  getScoreOutputSchema,
  saveScoreOutputSchema,
  searchScoresOutputSchema,
} from '@sheet-music/music-contracts';
import { TEST_USER_A } from '@sheet-music/persistence-postgres/testing';
import {
  F01,
  F12_NOW,
  RICH_WIRE_FIXTURE,
  SequentialScoreIds,
  TestClock,
} from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type McpTestBackend,
  openMcpTestBackend,
  rowCounts,
  storedDraft,
  storedScore,
} from './support/backend';
import { type RunningMcpApp, startMcpApp } from './support/mcp-harness';
import { callTool, envelopeOf, outputOf, scoreArgument, textOf } from './support/tool-calls';

let backend: McpTestBackend;
let app: RunningMcpApp;
let client: Client;
const clock = new TestClock(F12_NOW);

beforeAll(async () => {
  backend = await openMcpTestBackend();
  app = await startMcpApp({ stores: backend.persistence, clock, ids: new SequentialScoreIds() });
  client = await app.connect(await app.token(TEST_USER_A.id));
  await client.listTools();
});

afterAll(async () => {
  await client?.close();
  await app?.close();
  await backend?.close();
});

async function createDraft(fixture: unknown) {
  const result = await callTool(client, 'create_score', { score: scoreArgument(fixture) });
  return createScoreOutputSchema.parse(outputOf(result)).artifact;
}

async function save(args: Record<string, unknown>) {
  return callTool(client, 'save_score', args);
}

async function get(scoreId: string) {
  return callTool(client, 'get_score', { scoreId });
}

async function search(args: Record<string, unknown>): Promise<SearchScoresOutput> {
  return searchScoresOutputSchema.parse(outputOf(await callTool(client, 'search_scores', args)));
}

describe('MCP-LIB-01 save, reopen and search the rich score', () => {
  let draft: Awaited<ReturnType<typeof createDraft>>;
  let saveResult: Awaited<ReturnType<typeof save>>;

  beforeAll(async () => {
    clock.set('2026-09-28T12:00:00.000Z');
    draft = await createDraft(RICH_WIRE_FIXTURE);
    clock.set('2026-09-28T12:30:00.000Z');
    saveResult = await save({
      scoreId: draft.scoreId,
      expectedRevision: 1,
      title: '  ii-V-I \n in G ',
      tags: ['Jazz', 'jazz', 'cadence'],
    });
  });

  it('saves: same ID, revision and content, normalized title and tags, library timestamps', () => {
    expect(saveScoreOutputSchema.parse(outputOf(saveResult))).toEqual({
      outcome: 'saved',
      artifact: {
        state: 'saved',
        scoreId: draft.scoreId,
        revision: 1,
        score: draft.score,
        title: 'ii-V-I in G',
        tags: ['Jazz', 'cadence'],
        createdAt: '2026-09-28T12:30:00.000Z',
        updatedAt: '2026-09-28T12:30:00.000Z',
      },
    });
    expect(textOf(saveResult)).toContain(`Saved score ${draft.scoreId} (revision 1)`);
  });

  it('leaves one saved row and no draft', async () => {
    expect(await storedDraft(backend, draft.scoreId)).toBeNull();
    expect(await storedScore(backend, draft.scoreId)).toEqual({
      owner: TEST_USER_A.id,
      revision: 1,
      spec: draft.score,
      title: 'ii-V-I in G',
      tags: ['Jazz', 'cadence'],
      createdAt: '2026-09-28T12:30:00.000Z',
      updatedAt: '2026-09-28T12:30:00.000Z',
    });
    expect(await rowCounts(backend, TEST_USER_A.id)).toEqual({ drafts: 0, saved: 1 });
  });

  it('reopens the saved score with get_score', async () => {
    const saved = saveScoreOutputSchema.parse(outputOf(saveResult)).artifact;
    expect(getScoreOutputSchema.parse(outputOf(await get(draft.scoreId))).artifact).toEqual(saved);
  });

  it('lists summaries of saved scores only: no score content, no draft', async () => {
    const other = await createDraft(F01);

    const listed = await search({});

    expect(listed).toEqual({
      items: [
        {
          scoreId: draft.scoreId,
          title: 'ii-V-I in G',
          tags: ['Jazz', 'cadence'],
          revision: 1,
          createdAt: '2026-09-28T12:30:00.000Z',
          updatedAt: '2026-09-28T12:30:00.000Z',
        },
      ],
      page: { limit: 20, offset: 0, total: 1, nextOffset: null },
    });
    expect(listed.items.map((item) => item.scoreId)).not.toContain(other.scoreId);
  });
});

describe('MCP-SAVE-02 saves that must not promote, and replays', () => {
  let draftId: string;

  beforeAll(async () => {
    clock.set('2026-09-28T13:00:00.000Z');
    draftId = (await createDraft(F01)).scoreId;
  });

  it.each([
    {
      case: 'a blank title',
      args: { expectedRevision: 1, title: ' \t ' },
      code: 'INVALID_INPUT',
      path: ['title'],
    },
    {
      case: 'a control character in the title',
      args: { expectedRevision: 1, title: 'Scale\u0007study' },
      code: 'INVALID_INPUT',
      path: ['title'],
    },
    {
      case: 'a 41-character tag',
      args: { expectedRevision: 1, title: 'Scale study', tags: ['x'.repeat(41)] },
      code: 'INVALID_INPUT',
      path: ['tags', 0],
    },
    {
      case: 'a model-written consent flag',
      args: { expectedRevision: 1, title: 'Scale study', confirmed: true },
      code: 'INVALID_INPUT',
      path: ['confirmed'],
    },
    {
      case: 'a stale revision',
      args: { expectedRevision: 2, title: 'Scale study' },
      code: 'REVISION_CONFLICT',
      path: ['expectedRevision'],
    },
  ])('$case: $code at $path, the draft stays a draft', async ({ args, code, path }) => {
    const envelope = envelopeOf(await save({ scoreId: draftId, ...args }));

    expect(envelope.code).toBe(code);
    expect(envelope.details).toEqual([expect.objectContaining({ path })]);
    expect(await storedDraft(backend, draftId)).toMatchObject({ revision: 1 });
    expect(await storedScore(backend, draftId)).toBeNull();
  });

  describe('replaying a successful save', () => {
    const request = () => ({
      scoreId: draftId,
      expectedRevision: 1,
      title: 'Scale study',
      tags: ['scales'],
    });
    let first: ReturnType<typeof saveScoreOutputSchema.parse>;

    beforeAll(async () => {
      clock.set('2026-09-28T13:10:00.000Z');
      first = saveScoreOutputSchema.parse(outputOf(await save(request())));
      clock.set('2026-09-28T13:20:00.000Z');
    });

    it('answers the identical replay with already_saved and the stored artifact, writing nothing', async () => {
      const replay = await save(request());

      expect(saveScoreOutputSchema.parse(outputOf(replay))).toEqual({
        outcome: 'already_saved',
        artifact: first.artifact,
      });
      expect(textOf(replay)).toContain('nothing changed');
      expect(await storedScore(backend, draftId)).toMatchObject({
        title: 'Scale study',
        updatedAt: '2026-09-28T13:10:00.000Z',
      });
    });

    it('refuses a replay with another title: ALREADY_SAVED, the library entry is not overwritten', async () => {
      const envelope = envelopeOf(await save({ ...request(), title: 'Renamed study' }));

      expect(envelope.code).toBe('ALREADY_SAVED');
      expect(await storedScore(backend, draftId)).toMatchObject({
        title: 'Scale study',
        tags: ['scales'],
        updatedAt: '2026-09-28T13:10:00.000Z',
      });
      expect(first.outcome).toBe('saved');
    });
  });

  it('refuses an expired own draft with NOT_FOUND and promotes nothing', async () => {
    clock.set('2026-09-28T13:30:00.000Z');
    const expiring = await createDraft(F01);
    clock.set(expiring.expiresAt);

    const envelope = envelopeOf(
      await save({ scoreId: expiring.scoreId, expectedRevision: 1, title: 'Too late' }),
    );

    expect(envelope.code).toBe('NOT_FOUND');
    expect(await storedScore(backend, expiring.scoreId)).toBeNull();
    // Not cleaned up yet: the row exists, and access is blocked anyway.
    expect(await storedDraft(backend, expiring.scoreId)).not.toBeNull();
  });
});

describe('MCP-GET-02 reads that fail safely, and reads that change nothing', () => {
  const MISSING_ID = 'scr_00000000-0000-4000-8000-000000000999';
  const UNREADABLE_ID = 'scr_future-version';

  it('answers a missing ID and an expired own draft with the same NOT_FOUND', async () => {
    clock.set('2026-10-06T00:00:00.000Z');
    const expired = await createDraft(F01);
    clock.set(expired.expiresAt);

    const missing = envelopeOf(await get(MISSING_ID));
    const gone = envelopeOf(await get(expired.scoreId));

    expect(missing.code).toBe('NOT_FOUND');
    expect({ ...gone, correlationId: undefined }).toEqual({
      ...missing,
      correlationId: undefined,
    });
  });

  it('rejects a malformed ID as INVALID_INPUT at scoreId', async () => {
    const envelope = envelopeOf(await get('not a score id!'));

    expect(envelope.code).toBe('INVALID_INPUT');
    expect(envelope.details).toEqual([expect.objectContaining({ path: ['scoreId'] })]);
  });

  it('reports a stored record of an unsupported ScoreSpec version as INTERNAL without its content, logged', async () => {
    const now = clock.now();
    await backend.db.admin.query(
      `insert into public.score_drafts
         (id, owner_user_id, score_spec, score_spec_version, revision, created_at, updated_at, expires_at)
       values ($1, $2, $3, 2, 1, $4, $4, $5)`,
      [
        UNREADABLE_ID,
        TEST_USER_A.id,
        JSON.stringify({ id: UNREADABLE_ID, revision: 1, version: 2, bars: 'from the future' }),
        now,
        new Date(now.getTime() + 86_400_000),
      ],
    );
    const logsBefore = app.logs.length;

    const result = await get(UNREADABLE_ID);
    const envelope = envelopeOf(result);

    expect(envelope).toEqual({
      code: 'INTERNAL',
      message: 'A stored score could not be read by this version of the service.',
      correlationId: expect.any(String) as string,
    });
    expect(textOf(result)).not.toContain('from the future');
    expect(app.logs.slice(logsBefore)).toContainEqual(
      expect.objectContaining({
        level: 'error',
        event: 'use_case.failed',
        operation: 'get_score',
        code: 'INTERNAL',
        correlationId: envelope.correlationId,
        cause: expect.objectContaining({ name: 'StoredScoreUnreadableError' }) as unknown,
      }),
    );
  });

  it('does not renew a live draft TTL, change its revision or rewrite its row', async () => {
    clock.set('2026-10-07T00:00:00.000Z');
    const created = await createDraft(F01);
    const rowBefore = await storedDraft(backend, created.scoreId);
    clock.set('2026-10-12T00:00:00.000Z');

    const read = getScoreOutputSchema.parse(outputOf(await get(created.scoreId))).artifact;

    expect(read).toEqual(created);
    expect(read).toMatchObject({ revision: 1, expiresAt: '2026-10-14T00:00:00.000Z' });
    expect(await storedDraft(backend, created.scoreId)).toEqual(rowBefore);
  });
});

describe('MCP-SEARCH-02 one query through the shared query logic', () => {
  /** Saved in this order, one minute apart, so the newest is listed first. */
  const LIBRARY = [
    { title: 'Blues in F', tags: ['blues', 'jazz'] },
    { title: 'Minor blues', tags: ['blues'] },
    { title: 'Jazz waltz', tags: ['jazz', 'waltz'] },
    { title: 'Blue Monk', tags: ['Jazz', 'bebop'] },
  ];
  const savedIds = new Map<string, string>();

  beforeAll(async () => {
    let minute = 0;
    for (const entry of LIBRARY) {
      clock.set(new Date(Date.parse('2026-10-20T10:00:00.000Z') + minute * 60_000));
      minute += 1;
      const draft = await createDraft(F01);
      outputOf(await save({ scoreId: draft.scoreId, expectedRevision: 1, ...entry }));
      savedIds.set(entry.title, draft.scoreId);
    }
  });

  it('pages text + tag matches newest first: "blue" in a title or tag, tagged jazz', async () => {
    const query = { query: 'BLUE', tags: ['jazz'], limit: 1 };

    const first = await search({ ...query, offset: 0 });
    const second = await search({ ...query, offset: 1 });

    expect(first).toEqual({
      items: [
        {
          scoreId: savedIds.get('Blue Monk'),
          title: 'Blue Monk',
          tags: ['Jazz', 'bebop'],
          revision: 1,
          createdAt: '2026-10-20T10:03:00.000Z',
          updatedAt: '2026-10-20T10:03:00.000Z',
        },
      ],
      page: { limit: 1, offset: 0, total: 2, nextOffset: 1 },
    });
    expect(second.items.map((item) => item.title)).toEqual(['Blues in F']);
    expect(second.page).toEqual({ limit: 1, offset: 1, total: 2, nextOffset: null });
  });

  it('answers no match with a successful empty page', async () => {
    expect(await search({ query: 'nocturne' })).toEqual({
      items: [],
      page: { limit: 20, offset: 0, total: 0, nextOffset: null },
    });
  });

  it.each([
    { case: 'a page size of 0', args: { limit: 0 }, path: ['limit'] },
    { case: 'a page size over 50', args: { limit: 51 }, path: ['limit'] },
    { case: 'a negative offset', args: { offset: -1 }, path: ['offset'] },
  ])('rejects $case as INVALID_INPUT', async ({ args, path }) => {
    const envelope = envelopeOf(await callTool(client, 'search_scores', args));

    expect(envelope.code).toBe('INVALID_INPUT');
    expect(envelope.details).toEqual([expect.objectContaining({ path })]);
  });
});
