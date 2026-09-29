/**
 * create_score over the production MCP composition (#12): real HTTP MCP
 * client with a token from the local test issuer, bearer guard, rate limits,
 * use case and the Postgres adapters on the test database.
 *
 * - MCP-CREATE-01: a rich valid score comes back as the declared draft
 *   artifact (server ID, revision 1, canonical content with every notation
 *   layer), survives a re-read, and is stored as exactly one draft of the
 *   caller and no saved score. FLOW-01 (#18) reuses this boot path for the
 *   full lifecycle.
 * - MCP-CREATE-02: a malformed envelope and valid-shape scores the domain
 *   rejects (33 bars, conflicting teaching colors) answer actionable tool
 *   errors and store nothing. The validator rules themselves are #2's.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createScoreOutputSchema, getScoreOutputSchema } from '@sheet-music/music-contracts';
import { TEST_USER_A } from '@sheet-music/persistence-postgres/testing';
import {
  F09_COLOR_CONFLICT,
  F11_THIRTY_THREE_BARS,
  F12_NOW,
  RICH_WIRE_FIXTURE,
  SequentialScoreIds,
  TestClock,
  cloneFixture,
} from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpTestBackend, openMcpTestBackend, rowCounts, storedDraft } from './support/backend';
import { type RunningMcpApp, startMcpApp } from './support/mcp-harness';
import { callTool, envelopeOf, outputOf, scoreArgument, textOf } from './support/tool-calls';

/** The first ID SequentialScoreIds issues. */
const FIRST_ID = 'scr_00000000-0000-4000-8000-000000000001';
/** F12_NOW + 7 days (ADR-006 TTL), written out. */
const EXPIRES_AT = '2026-10-05T12:00:00.000Z';

let backend: McpTestBackend;
let app: RunningMcpApp;
let client: Client;

beforeAll(async () => {
  backend = await openMcpTestBackend();
  app = await startMcpApp({
    stores: backend.persistence,
    clock: new TestClock(F12_NOW),
    ids: new SequentialScoreIds(),
  });
  client = await app.connect(await app.token(TEST_USER_A.id));
  // Lets the client check every structuredContent against the published outputSchema.
  await client.listTools();
});

afterAll(async () => {
  await client?.close();
  await app?.close();
  await backend?.close();
});

describe('MCP-CREATE-01 a rich valid score through actual MCP', () => {
  let result: CallToolResult;
  const expectedScore = { ...cloneFixture(RICH_WIRE_FIXTURE), id: FIRST_ID, revision: 1 };

  beforeAll(async () => {
    result = await callTool(client, 'create_score', { score: scoreArgument(RICH_WIRE_FIXTURE) });
  });

  it('returns the declared draft artifact: server ID, revision 1, every notation layer, 7-day expiry', () => {
    const { artifact } = createScoreOutputSchema.parse(outputOf(result));
    expect(artifact).toEqual({
      state: 'draft',
      scoreId: FIRST_ID,
      revision: 1,
      score: expectedScore,
      createdAt: F12_NOW,
      updatedAt: F12_NOW,
      expiresAt: EXPIRES_AT,
    });
  });

  it('tells the model the ID, the revision and that the draft is not in the library', () => {
    expect(textOf(result)).toContain(`Created score ${FIRST_ID} at revision 1`);
    expect(textOf(result)).toContain("it is not in the user's library");
  });

  it('survives a re-read with get_score, unchanged', async () => {
    const reread = await callTool(client, 'get_score', { scoreId: FIRST_ID });
    expect(getScoreOutputSchema.parse(outputOf(reread)).artifact).toEqual(
      createScoreOutputSchema.parse(outputOf(result)).artifact,
    );
  });

  it('stores exactly one draft, owned by the token subject, with the same document', async () => {
    expect(await rowCounts(backend)).toEqual({ drafts: 1, saved: 0 });
    expect(await storedDraft(backend, FIRST_ID)).toEqual({
      owner: TEST_USER_A.id,
      revision: 1,
      spec: expectedScore,
      createdAt: F12_NOW,
      updatedAt: F12_NOW,
      expiresAt: EXPIRES_AT,
    });
  });
});

describe('MCP-CREATE-02 rejected creates are actionable and store nothing', () => {
  function withDetail(code: string, path: (string | number)[], ids?: string[]) {
    return expect.objectContaining({
      code,
      path,
      ...(ids === undefined ? {} : { ids }),
    }) as unknown;
  }

  it.each([
    {
      case: 'a score that is not an object',
      args: { score: 'four quarter notes' },
      code: 'INVALID_INPUT',
      details: [withDetail('INVALID_TYPE', ['score'])],
    },
    {
      case: 'a score carrying the server-assigned id',
      args: { score: { ...scoreArgument(RICH_WIRE_FIXTURE), id: 'my-id' } },
      code: 'INVALID_INPUT',
      details: [withDetail('INVALID_VALUE', ['score', 'id'])],
    },
    {
      case: 'a valid shape over the 32-bar limit (33 aligned bars)',
      args: { score: scoreArgument(F11_THIRTY_THREE_BARS) },
      code: 'MVP_LIMIT_EXCEEDED',
      details: [
        withDetail('TOO_MANY_MEASURES', ['score', 'staves', 0, 'measures']),
        withDetail('TOO_MANY_MEASURES', ['score', 'staves', 1, 'measures']),
      ],
    },
    {
      case: 'a valid shape with two teaching colors on one note (P-03)',
      args: { score: scoreArgument(F09_COLOR_CONFLICT) },
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        withDetail(
          'ANNOTATION_COLOR_CONFLICT',
          ['score', 'annotations'],
          ['f09-n3', 'f09-a1', 'f09-a2'],
        ),
      ],
    },
  ])('$case: $code with details pointing into the request', async ({ args, code, details }) => {
    const before = await rowCounts(backend);

    const envelope = envelopeOf(await callTool(client, 'create_score', args));

    expect(envelope.code).toBe(code);
    expect(envelope.details).toEqual(details);
    expect(await rowCounts(backend)).toEqual(before);
  });
});
