/**
 * ACCESS-01 (#18, TEST_PLAN.md §5): route-level ownership across the five
 * product tools and the two protected saved-library routes, through the
 * production MCP server and Nest API on one test database, with users A and
 * B authenticated by the local issuer.
 *
 * Each user holds one live draft and one saved score, created and saved
 * through the tools; both saved scores share their title and tag, so any
 * leak would show in a search. A (the caller) then:
 *
 * 1. targets B's exact IDs with every ID-taking tool and GET /scores/:id:
 *    the answer equals the answer for an ID nobody owns (NOT_FOUND / 404,
 *    same body but the correlation ID), and nothing is written;
 * 2. sends a forged owner argument to every tool and route: it is refused
 *    as an unknown field, or ignored, and never reaches B's data;
 * 3. searches and lists: only A's saved score, never a draft, never B's,
 *    with totals that count A's saved scores only;
 * 4. overlaps requests with B on both transports: every answer belongs to
 *    its caller (no principal leaks between concurrent requests).
 *
 * After every failed write, all four stored rows are re-read and compared
 * with their state before the attempt; B's items are re-read by B at the
 * end. Direct database authorization (RLS) is #27, not this suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AcceptanceStack,
  type HttpResult,
  type McpClient,
  startAcceptanceStack,
} from './support/stack';
import {
  type ErrorEnvelope,
  F01,
  F12_NOW,
  SequentialScoreIds,
  TEST_USER_A,
  TEST_USER_B,
  TestClock,
  callTool,
  createScoreOutputSchema,
  editScoreOutputSchema,
  envelopeOf,
  errorEnvelopeSchema,
  getScoreOutputSchema,
  listScoresResponseSchema,
  outputOf,
  rowCounts,
  saveScoreOutputSchema,
  savedScoreResponseSchema,
  scoreArgument,
  searchScoresOutputSchema,
  storedDraft,
  storedScore,
} from './support/workspace';

const A = TEST_USER_A.id;
const B = TEST_USER_B.id;

/** SequentialScoreIds, in the order the beforeAll creates the scores. */
const id = (n: number) => `scr_00000000-0000-4000-8000-00000000000${n}`;
const A_DRAFT = id(1);
const A_SAVED = id(2);
const B_DRAFT = id(3);
const B_SAVED = id(4);
/** An ID nobody owns: the reference answer for a foreign ID. */
const MISSING = 'scr_00000000-0000-4000-8000-000000000999';

const SHARED_TITLE = 'Etude in C';
const SHARED_TAG = 'etude';
const TEMPO_EDIT = [{ type: 'set_tempo', bpm: 90 }];

function summaryOf(scoreId: string) {
  return {
    scoreId,
    title: SHARED_TITLE,
    tags: [SHARED_TAG],
    revision: 1,
    createdAt: F12_NOW,
    updatedAt: F12_NOW,
  };
}

function pageOf(scoreId: string) {
  return {
    items: [summaryOf(scoreId)],
    page: { limit: 20, offset: 0, total: 1, nextOffset: null },
  };
}

/** An error answer, with the per-request correlation ID blanked. */
type Answer =
  | { readonly transport: 'mcp'; readonly envelope: ErrorEnvelope }
  | { readonly transport: 'http'; readonly status: number; readonly envelope: ErrorEnvelope };

function withoutCorrelation(envelope: ErrorEnvelope): ErrorEnvelope {
  return { ...envelope, correlationId: undefined };
}

function httpAnswer(response: HttpResult): Answer {
  return {
    transport: 'http',
    status: response.status,
    envelope: withoutCorrelation(errorEnvelopeSchema.parse(response.body)),
  };
}

const clock = new TestClock(F12_NOW);
let stack: AcceptanceStack;
let clientA: McpClient;
let clientB: McpClient;
/** What B received when it created and saved its scores. */
const bArtifacts: Record<string, unknown> = {};

async function create(client: McpClient): Promise<string> {
  const output = outputOf(await callTool(client, 'create_score', { score: scoreArgument(F01) }));
  return createScoreOutputSchema.parse(output).artifact.scoreId;
}

async function save(client: McpClient, scoreId: string) {
  const result = await callTool(client, 'save_score', {
    scoreId,
    expectedRevision: 1,
    title: SHARED_TITLE,
    tags: [SHARED_TAG],
  });
  return saveScoreOutputSchema.parse(outputOf(result)).artifact;
}

/** Every stored row of the scenario and both owners' counts, read through the admin pool. */
async function storedState() {
  return {
    aDraft: await storedDraft(stack.backend, A_DRAFT),
    aSaved: await storedScore(stack.backend, A_SAVED),
    bDraft: await storedDraft(stack.backend, B_DRAFT),
    bSaved: await storedScore(stack.backend, B_SAVED),
    missing: {
      draft: await storedDraft(stack.backend, MISSING),
      saved: await storedScore(stack.backend, MISSING),
    },
    counts: { a: await rowCounts(stack.backend, A), b: await rowCounts(stack.backend, B) },
  };
}

let initialState: Awaited<ReturnType<typeof storedState>>;

beforeAll(async () => {
  stack = await startAcceptanceStack({ clock, ids: new SequentialScoreIds() });
  clientA = await stack.mcpClient(A);
  clientB = await stack.mcpClient(B);

  expect(await create(clientA)).toBe(A_DRAFT);
  expect(await create(clientA)).toBe(A_SAVED);
  await save(clientA, A_SAVED);
  expect(await create(clientB)).toBe(B_DRAFT);
  bArtifacts[B_DRAFT] = getScoreOutputSchema.parse(
    outputOf(await callTool(clientB, 'get_score', { scoreId: B_DRAFT })),
  ).artifact;
  expect(await create(clientB)).toBe(B_SAVED);
  bArtifacts[B_SAVED] = await save(clientB, B_SAVED);

  initialState = await storedState();
});

afterAll(async () => {
  await stack?.close();
});

describe('ACCESS-01 seeded scenario', () => {
  it('holds one live draft and one saved score per user', () => {
    expect(initialState.counts).toEqual({
      a: { drafts: 1, saved: 1 },
      b: { drafts: 1, saved: 1 },
    });
    expect(initialState.bDraft?.owner).toBe(B);
    expect(initialState.bSaved?.owner).toBe(B);
  });
});

describe('ACCESS-01 exact foreign IDs behave like IDs nobody owns', () => {
  const ATTEMPTS: Record<string, (scoreId: string) => Promise<Answer>> = {
    get_score: async (scoreId) => ({
      transport: 'mcp',
      envelope: withoutCorrelation(envelopeOf(await callTool(clientA, 'get_score', { scoreId }))),
    }),
    edit_score: async (scoreId) => ({
      transport: 'mcp',
      envelope: withoutCorrelation(
        envelopeOf(
          await callTool(clientA, 'edit_score', {
            scoreId,
            expectedRevision: 1,
            operations: TEMPO_EDIT,
          }),
        ),
      ),
    }),
    save_score: async (scoreId) => ({
      transport: 'mcp',
      envelope: withoutCorrelation(
        envelopeOf(
          await callTool(clientA, 'save_score', {
            scoreId,
            expectedRevision: 1,
            title: 'Taken over',
          }),
        ),
      ),
    }),
    'GET /scores/:id': async (scoreId) => httpAnswer(await stack.apiGet(A, `/scores/${scoreId}`)),
  };

  it.each([
    { surface: 'get_score', target: "B's draft", scoreId: B_DRAFT },
    { surface: 'get_score', target: "B's saved score", scoreId: B_SAVED },
    { surface: 'edit_score', target: "B's draft", scoreId: B_DRAFT },
    { surface: 'edit_score', target: "B's saved score", scoreId: B_SAVED },
    { surface: 'save_score', target: "B's draft", scoreId: B_DRAFT },
    { surface: 'save_score', target: "B's saved score", scoreId: B_SAVED },
    { surface: 'GET /scores/:id', target: "B's saved score", scoreId: B_SAVED },
    { surface: 'GET /scores/:id', target: "B's draft", scoreId: B_DRAFT },
  ])(
    '$surface on $target: the not-found answer of a missing ID, nothing written',
    async ({ surface, scoreId }) => {
      const attempt = ATTEMPTS[surface]!;

      const foreign = await attempt(scoreId);
      const missing = await attempt(MISSING);

      expect(foreign.envelope.code).toBe('NOT_FOUND');
      if (foreign.transport === 'http') {
        expect(foreign.status).toBe(404);
      }
      expect(foreign).toEqual(missing);
      expect(await storedState()).toEqual(initialState);
    },
  );
});

describe('ACCESS-01 forged owner arguments grant nothing', () => {
  const unknownOwnerField = {
    code: 'INVALID_INPUT',
    details: [expect.objectContaining({ code: 'UNKNOWN_FIELD', path: ['ownerId'] })],
  };

  it.each([
    { tool: 'create_score', args: { score: scoreArgument(F01), ownerId: B } },
    {
      tool: 'edit_score',
      args: { scoreId: B_DRAFT, expectedRevision: 1, operations: TEMPO_EDIT, ownerId: B },
    },
    {
      tool: 'save_score',
      args: { scoreId: B_DRAFT, expectedRevision: 1, title: 'Taken over', ownerId: B },
    },
    { tool: 'get_score', args: { scoreId: B_SAVED, ownerId: B } },
    { tool: 'search_scores', args: { ownerId: B } },
  ])(
    '$tool with ownerId = B: refused as an unknown field, nothing written',
    async ({ tool, args }) => {
      const envelope = envelopeOf(await callTool(clientA, tool, args));

      expect(envelope).toMatchObject(unknownOwnerField);
      expect(await storedState()).toEqual(initialState);
    },
  );

  it('GET /scores?ownerId=B: refused as an unknown query parameter (400)', async () => {
    const response = await stack.apiGet(A, `/scores?ownerId=${B}`);

    expect(response.status).toBe(400);
    expect(errorEnvelopeSchema.parse(response.body)).toMatchObject(unknownOwnerField);
  });

  it("GET /scores/:id of B's score with ownerId/userId = B in the query: still the missing-ID 404", async () => {
    const forged = await stack.apiGet(A, `/scores/${B_SAVED}?ownerId=${B}&userId=${B}`);
    const missing = await stack.apiGet(A, `/scores/${MISSING}`);

    expect(httpAnswer(forged)).toEqual(httpAnswer(missing));
    expect(forged.status).toBe(404);
  });
});

describe('ACCESS-01 searches and lists show only the caller’s saved scores', () => {
  it.each([
    { caller: 'A', userId: A, own: A_SAVED },
    { caller: 'B', userId: B, own: B_SAVED },
  ])(
    '$caller: search_scores and GET /scores list its one saved score, no draft, total 1',
    async ({ userId, own }) => {
      const client = userId === A ? clientA : clientB;

      const viaMcp = searchScoresOutputSchema.parse(
        outputOf(await callTool(client, 'search_scores', {})),
      );
      const viaRest = await stack.apiGet(userId, '/scores');

      expect(viaMcp).toEqual(pageOf(own));
      expect(viaRest.status).toBe(200);
      expect(listScoresResponseSchema.parse(viaRest.body)).toEqual(pageOf(own));
    },
  );

  it("A: a query matching both users' shared title and tag still finds only A's score", async () => {
    const viaMcp = searchScoresOutputSchema.parse(
      outputOf(await callTool(clientA, 'search_scores', { query: 'ETUDE', tags: [SHARED_TAG] })),
    );
    const viaRest = await stack.apiGet(A, `/scores?query=ETUDE&tags=${SHARED_TAG}`);

    expect(viaMcp).toEqual(pageOf(A_SAVED));
    expect(listScoresResponseSchema.parse(viaRest.body)).toEqual(pageOf(A_SAVED));
  });

  it('B still reads its own draft and saved score unchanged after every attempt by A', async () => {
    const draft = getScoreOutputSchema.parse(
      outputOf(await callTool(clientB, 'get_score', { scoreId: B_DRAFT })),
    ).artifact;
    const saved = await stack.apiGet(B, `/scores/${B_SAVED}`);

    expect(draft).toEqual(bArtifacts[B_DRAFT]);
    expect(saved.status).toBe(200);
    expect(savedScoreResponseSchema.parse(saved.body)).toEqual(bArtifacts[B_SAVED]);
  });
});

describe('ACCESS-01 overlapping A/B requests', () => {
  it('every answer of concurrent A and B requests, on both transports, belongs to its caller', async () => {
    const ROUNDS = 4;
    const aCalls: Promise<unknown>[] = [];
    const bCalls: Promise<unknown>[] = [];
    // Started alternately before any is awaited, so the requests overlap in the servers.
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const [calls, client, userId, own] of [
        [aCalls, clientA, A, A_SAVED],
        [bCalls, clientB, B, B_SAVED],
      ] as const) {
        calls.push(
          callTool(client, 'get_score', { scoreId: own }).then(
            (result) => getScoreOutputSchema.parse(outputOf(result)).artifact.scoreId,
          ),
          callTool(client, 'search_scores', {}).then((result) =>
            searchScoresOutputSchema.parse(outputOf(result)).items.map((item) => item.scoreId),
          ),
          stack
            .apiGet(userId, '/scores')
            .then((response) =>
              listScoresResponseSchema.parse(response.body).items.map((item) => item.scoreId),
            ),
          stack
            .apiGet(userId, `/scores/${own}`)
            .then((response) => savedScoreResponseSchema.parse(response.body).scoreId),
        );
      }
    }
    // One overlapping write pair: each edit lands on its caller's own draft.
    const aEdit = callTool(clientA, 'edit_score', {
      scoreId: A_DRAFT,
      expectedRevision: 1,
      operations: [{ type: 'set_tempo', bpm: 100 }],
    });
    const bEdit = callTool(clientB, 'edit_score', {
      scoreId: B_DRAFT,
      expectedRevision: 1,
      operations: [{ type: 'set_tempo', bpm: 101 }],
    });

    const [aAnswers, bAnswers, aEdited, bEdited] = await Promise.all([
      Promise.all(aCalls),
      Promise.all(bCalls),
      aEdit,
      bEdit,
    ]);

    const expected = (own: string) =>
      Array.from({ length: ROUNDS }, () => [own, [own], [own], own]).flat();
    expect(aAnswers).toEqual(expected(A_SAVED));
    expect(bAnswers).toEqual(expected(B_SAVED));
    expect(editScoreOutputSchema.parse(outputOf(aEdited)).artifact).toMatchObject({
      scoreId: A_DRAFT,
      revision: 2,
      score: { tempo: { bpm: 100 } },
    });
    expect(editScoreOutputSchema.parse(outputOf(bEdited)).artifact).toMatchObject({
      scoreId: B_DRAFT,
      revision: 2,
      score: { tempo: { bpm: 101 } },
    });
    expect(await storedDraft(stack.backend, A_DRAFT)).toMatchObject({
      owner: A,
      revision: 2,
      spec: { tempo: { bpm: 100 } },
    });
    expect(await storedDraft(stack.backend, B_DRAFT)).toMatchObject({
      owner: B,
      revision: 2,
      spec: { tempo: { bpm: 101 } },
    });
  });
});
