/**
 * edit_score over the production MCP composition (#13): real HTTP MCP client,
 * token from the local test issuer, bearer guard, use case, Postgres adapters.
 * A test clock moves between steps so that TTL renewal (or its absence) is
 * visible; every "unchanged" claim is checked by an independent re-read AND
 * the stored row.
 *
 * - MCP-EDIT-01: one mixed valid batch (score meter change, bar replacement
 *   that reuses IDs, a fingering) on the rich draft keeps the ID, bumps the
 *   revision once, renews the TTL and persists the canonical result.
 * - MCP-EDIT-02: a replayed transposition with a stale expectedRevision is
 *   REVISION_CONFLICT and leaves content, revision and TTL as the first
 *   transposition left them (no double transposition).
 * - MCP-EDIT-03: a valid operation followed by an invalid target, a batch
 *   whose final document breaks P-03, and a JSON Patch command are rejected
 *   as a whole with actionable details; nothing changes; the explicit repair
 *   batch then succeeds.
 *
 * Operation semantics are #3's; this suite proves transport, atomic
 * persistence and error propagation.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  createScoreOutputSchema,
  editScoreOutputSchema,
  getScoreOutputSchema,
  type scoreArtifactSchema,
} from '@sheet-music/music-contracts';
import { TEST_USER_A } from '@sheet-music/persistence-postgres/testing';
import {
  F01,
  F09,
  F12_NOW,
  RICH_WIRE_FIXTURE,
  SequentialScoreIds,
  TestClock,
  cloneFixture,
} from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type McpTestBackend,
  type StoredDraft,
  openMcpTestBackend,
  rowCounts,
  storedDraft,
} from './support/backend';
import { type RunningMcpApp, startMcpApp } from './support/mcp-harness';
import { callTool, envelopeOf, outputOf, scoreArgument } from './support/tool-calls';

/** An artifact as it travels: the score is a JSON document. */
type ScoreArtifact = ReturnType<typeof scoreArtifactSchema.parse>;

const ids = ['1', '2', '3'].map((n) => `scr_00000000-0000-4000-8000-00000000000${n}`);
const RICH_ID = ids[0]!;
const F01_ID = ids[1]!;
const F09_ID = ids[2]!;

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

async function create(fixture: unknown): Promise<ScoreArtifact> {
  const result = await callTool(client, 'create_score', { score: scoreArgument(fixture) });
  return createScoreOutputSchema.parse(outputOf(result)).artifact;
}

async function edit(
  scoreId: string,
  expectedRevision: number,
  operations: unknown[],
): Promise<ReturnType<typeof callTool>> {
  return callTool(client, 'edit_score', { scoreId, expectedRevision, operations });
}

async function reread(scoreId: string): Promise<ScoreArtifact> {
  return getScoreOutputSchema.parse(outputOf(await callTool(client, 'get_score', { scoreId })))
    .artifact;
}

/** What the stored row must hold for a draft artifact. */
function rowOf(artifact: ScoreArtifact): StoredDraft {
  if (artifact.state !== 'draft') {
    throw new Error('expected a draft');
  }
  return {
    owner: TEST_USER_A.id,
    revision: artifact.revision,
    spec: artifact.score,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    expiresAt: artifact.expiresAt,
  };
}

const pitch = (step: string, octave: number, alter = 0) => ({ step, alter, octave });

describe('MCP-EDIT-01 a mixed valid batch on the rich draft', () => {
  // 4/4 -> 2/2 (every bar still fits), bar 4 rewritten with the same IDs plus
  // a new chord member, and a fingering on an existing member.
  const operations = [
    { type: 'set_time_signature', numerator: 2, denominator: 2 },
    {
      type: 'replace_measures',
      measureIds: ['rich-m4'],
      bars: [
        {
          id: 'rich-m4',
          kind: 'incomplete',
          actualDuration: { numerator: 3, denominator: 4 },
          staves: [
            {
              staffId: 'rich-rh',
              voices: [
                {
                  id: 'rich-rh-m4-v1',
                  events: [
                    {
                      id: 'rich-rh-c2',
                      type: 'chord',
                      duration: { value: 'half', dots: 1 },
                      notes: [
                        { id: 'rich-rh-c2-g', pitch: pitch('G', 4) },
                        { id: 'rich-rh-c2-b', pitch: pitch('B', 4) },
                        { id: 'rich-rh-c2-d', pitch: pitch('D', 5) },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              staffId: 'rich-lh',
              voices: [
                {
                  id: 'rich-lh-m4-v1',
                  events: [
                    {
                      id: 'rich-lh-n5',
                      type: 'note',
                      pitch: pitch('G', 2),
                      duration: { value: 'half', dots: 1 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { type: 'set_fingering', noteId: 'rich-rh-c2-g', fingering: 1 },
  ];

  /** The rich fixture with the batch applied by hand. */
  function expectedScore(): Record<string, unknown> {
    const expected = cloneFixture(RICH_WIRE_FIXTURE) as unknown as {
      staves: { measures: { voices: { events: { notes?: unknown[] }[] }[] }[] }[];
    } & Record<string, unknown>;
    expected['id'] = RICH_ID;
    expected['revision'] = 2;
    expected['timeSignature'] = { numerator: 2, denominator: 2 };
    expected.staves[0]!.measures[3]!.voices[0]!.events[0]!.notes = [
      { id: 'rich-rh-c2-g', pitch: pitch('G', 4), fingering: 1 },
      { id: 'rich-rh-c2-b', pitch: pitch('B', 4) },
      { id: 'rich-rh-c2-d', pitch: pitch('D', 5) },
    ];
    return expected;
  }

  let created: ScoreArtifact;
  let edited: ScoreArtifact;

  beforeAll(async () => {
    clock.set('2026-09-28T12:00:00.000Z');
    created = await create(RICH_WIRE_FIXTURE);
    clock.set('2026-09-28T13:00:00.000Z');
    edited = editScoreOutputSchema.parse(outputOf(await edit(RICH_ID, 1, operations))).artifact;
  });

  it('keeps the ID and bumps the revision exactly once', () => {
    expect(created).toMatchObject({ scoreId: RICH_ID, revision: 1 });
    expect(edited).toMatchObject({ state: 'draft', scoreId: RICH_ID, revision: 2 });
  });

  it('returns the canonical result: new meter, rewritten bar, fingering, every other layer kept', () => {
    expect(edited.score).toEqual(expectedScore());
  });

  it('renews the draft TTL from the edit time and keeps its creation time', () => {
    expect(edited).toMatchObject({
      createdAt: '2026-09-28T12:00:00.000Z',
      updatedAt: '2026-09-28T13:00:00.000Z',
      expiresAt: '2026-10-05T13:00:00.000Z',
    });
  });

  it('persists exactly that result in the same row, and a re-read returns it', async () => {
    expect(await storedDraft(backend, RICH_ID)).toEqual(rowOf(edited));
    expect(await reread(RICH_ID)).toEqual(edited);
    expect(await rowCounts(backend)).toEqual({ drafts: 1, saved: 0 });
  });
});

describe('MCP-EDIT-02 a stale or replayed expectedRevision', () => {
  const transposeUpATone = [{ type: 'transpose', semitones: 2, target: {} }];
  let afterFirst: ScoreArtifact;

  beforeAll(async () => {
    clock.set('2026-09-28T14:00:00.000Z');
    await create(F01);
    clock.set('2026-09-28T15:00:00.000Z');
    afterFirst = editScoreOutputSchema.parse(
      outputOf(await edit(F01_ID, 1, transposeUpATone)),
    ).artifact;
    clock.set('2026-09-28T16:00:00.000Z');
  });

  it('applies the first transposition once: C4 D4 E4 F4 -> D4 E4 F#4 G4 at revision 2', () => {
    expect(afterFirst.revision).toBe(2);
    const { staves } = afterFirst.score as {
      staves: { measures: { voices: { events: { pitch: unknown }[] }[] }[] }[];
    };
    const events = staves[0]?.measures[0]?.voices[0]?.events.map((event) => event.pitch);
    expect(events).toEqual([pitch('D', 4), pitch('E', 4), pitch('F', 4, 1), pitch('G', 4)]);
  });

  it('answers the replay with REVISION_CONFLICT naming the score', async () => {
    const envelope = envelopeOf(await edit(F01_ID, 1, transposeUpATone));
    expect(envelope.code).toBe('REVISION_CONFLICT');
    expect(envelope.details).toEqual([
      expect.objectContaining({
        code: 'REVISION_MISMATCH',
        path: ['expectedRevision'],
        ids: [F01_ID],
      }),
    ]);
  });

  it('leaves content, revision and TTL as the first edit left them (no second transposition)', async () => {
    expect(await reread(F01_ID)).toEqual(afterFirst);
    expect(await storedDraft(backend, F01_ID)).toEqual(rowOf(afterFirst));
    expect(afterFirst).toMatchObject({ expiresAt: '2026-10-05T15:00:00.000Z' });
  });
});

describe('MCP-EDIT-03 a batch that fails after a valid operation is rejected as a whole', () => {
  let created: ScoreArtifact;

  beforeAll(async () => {
    clock.set('2026-09-28T17:00:00.000Z');
    created = await create(F09);
    clock.set('2026-09-28T18:00:00.000Z');
  });

  const blueOnFifthAndOctave = {
    type: 'add_annotation',
    annotation: {
      id: 'f09-a2',
      color: 'DodgerBlue',
      noteIds: ['f09-n3', 'f09-n4'],
      text: 'Fifth and octave',
    },
  };

  it.each([
    {
      case: 'a valid fingering then a missing target',
      operations: [
        { type: 'set_fingering', noteId: 'f09-n1', fingering: 1 },
        { type: 'set_fingering', noteId: 'f09-missing', fingering: 2 },
      ],
      code: 'TARGET_NOT_FOUND',
      detail: {
        code: 'REFERENCE_NOT_FOUND',
        path: ['operations', 1, 'noteId'],
        ids: ['f09-missing'],
      },
    },
    {
      case: 'a valid tempo then a second teaching color on a pink note (P-03)',
      operations: [{ type: 'set_tempo', bpm: 90 }, blueOnFifthAndOctave],
      code: 'SCORE_VALIDATION_FAILED',
      detail: {
        code: 'ANNOTATION_COLOR_CONFLICT',
        path: ['annotations'],
        ids: ['f09-n3', 'f09-a1', 'f09-a2'],
      },
    },
    {
      case: 'a JSON Patch command instead of a typed operation',
      operations: [{ op: 'replace', path: '/tempo/bpm', value: 90 }],
      code: 'INVALID_OPERATION',
      detail: { code: 'INVALID_VALUE', path: ['operations', 0, 'type'] },
    },
  ])('$case: $code, and nothing changes', async ({ operations, code, detail }) => {
    const envelope = envelopeOf(await edit(F09_ID, 1, operations));

    expect(envelope.code).toBe(code);
    expect(envelope.details).toEqual([expect.objectContaining(detail)]);
    expect(await reread(F09_ID)).toEqual(created);
    expect(await storedDraft(backend, F09_ID)).toEqual(rowOf(created));
  });

  it('accepts the explicit conflict-free repair batch', async () => {
    const repaired = editScoreOutputSchema.parse(
      outputOf(
        await edit(F09_ID, 1, [
          { type: 'set_tempo', bpm: 90 },
          { type: 'update_annotation', annotationId: 'f09-a1', noteIds: ['f09-n1', 'f09-n2'] },
          blueOnFifthAndOctave,
        ]),
      ),
    ).artifact;

    expect(repaired).toMatchObject({
      revision: 2,
      updatedAt: '2026-09-28T18:00:00.000Z',
      expiresAt: '2026-10-05T18:00:00.000Z',
    });
    expect(repaired.score['tempo']).toEqual({ bpm: 90 });
    expect(repaired.score['annotations']).toEqual([
      {
        id: 'f09-a1',
        color: '#ff69b4',
        noteIds: ['f09-n1', 'f09-n2'],
        text: 'C major triad: root, third and fifth',
      },
      { id: 'f09-a2', color: '#1e90ff', noteIds: ['f09-n3', 'f09-n4'], text: 'Fifth and octave' },
    ]);
    expect(await storedDraft(backend, F09_ID)).toEqual(rowOf(repaired));
  });
});
