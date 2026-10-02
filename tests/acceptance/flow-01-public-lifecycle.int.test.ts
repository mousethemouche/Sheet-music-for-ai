/**
 * FLOW-01 (#18, TEST_PLAN.md §5): the public lifecycle of one rich score,
 * through the production MCP server and the production Nest API on one test
 * database, authenticated as user A by the local issuer (an MCP OAuth token
 * for the MCP server, a web session token for the API, same `sub`).
 *
 *   create_score -> get_score -> edit_score (same ID) -> [no saved row]
 *   -> save_score (explicit) -> search_scores + GET /scores
 *   -> GET /scores/:id -> edit_score (saved) -> get_score + GET /scores/:id
 *
 * The flow runs once in `beforeAll` and keeps every real response; each test
 * below asserts one step. Expected values are written by hand from the rich
 * wire fixture, the requested edits and the test clock: nothing is copied
 * from a response into its own oracle. Every body is parsed with its
 * music-contracts schema (closed objects: an extra field fails).
 *
 * This is the happy-path evidence of #8/#10/#12-#14/#21; their focused
 * failure cases stay in their own suites. Owner isolation is ACCESS-01.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AcceptanceStack, type HttpResult, startAcceptanceStack } from './support/stack';
import {
  F12_NOW,
  RICH_WIRE_FIXTURE,
  type RowCounts,
  SequentialScoreIds,
  type StoredDraft,
  type StoredScore,
  TEST_USER_A,
  TestClock,
  callTool,
  cloneFixture,
  createScoreOutputSchema,
  editScoreOutputSchema,
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

type ToolResult = Awaited<ReturnType<typeof callTool>>;

/** The first ID SequentialScoreIds issues: the score of the whole flow. */
const SCORE_ID = 'scr_00000000-0000-4000-8000-000000000001';

/** Test-clock instants of the steps, and the 7-day draft expiries they imply (ADR-006). */
const AT = {
  create: F12_NOW, // 2026-09-28T12:00:00.000Z
  get: '2026-09-28T12:05:00.000Z',
  edit: '2026-09-28T12:10:00.000Z',
  save: '2026-09-28T12:20:00.000Z',
  editSaved: '2026-09-28T12:30:00.000Z',
} as const;
const EXPIRES_AFTER_CREATE = '2026-10-05T12:00:00.000Z';
const EXPIRES_AFTER_EDIT = '2026-10-05T12:10:00.000Z';

const LIBRARY_TITLE = 'ii-V-I in G';
const LIBRARY_TAGS = ['jazz', 'cadence'];

const DRAFT_EDIT = [
  { type: 'set_tempo', bpm: 144 },
  { type: 'set_fingering', noteId: 'rich-rh-n8', fingering: 2 },
];
const SAVED_EDIT = [
  { type: 'set_title', title: 'ii-V-I in G, revised' },
  {
    type: 'add_annotation',
    annotation: {
      id: 'rich-a3',
      color: 'DodgerBlue',
      noteIds: ['rich-lh-n3'],
      text: 'Root of ii7 in the bass',
    },
  },
];

/** The rich wire fixture as a mutable JSON document. */
interface RichDocument {
  id: string;
  revision: number;
  tempo: { bpm: number };
  metadata: { title?: string; tags?: string[] };
  staves: { measures: { voices: { events: Record<string, unknown>[] }[] }[] }[];
  annotations: Record<string, unknown>[];
  [field: string]: unknown;
}

/** The fixture under the server-assigned ID, at `revision`, with the edits requested up to that revision applied by hand. */
function expectedDocument(revision: 1 | 2 | 3): RichDocument {
  const document = cloneFixture(RICH_WIRE_FIXTURE) as unknown as RichDocument;
  document.id = SCORE_ID;
  document.revision = revision;
  if (revision >= 2) {
    document.tempo = { bpm: 144 };
    // rich-rh-n8: right hand, bar rich-m3, second event.
    document.staves[0]!.measures[2]!.voices[0]!.events[1]!['fingering'] = 2;
  }
  if (revision >= 3) {
    document.metadata.title = 'ii-V-I in G, revised';
    // Stored with its canonical color (SCORE_OPERATIONS_V1.md §4.4).
    document.annotations.push({
      id: 'rich-a3',
      color: '#1e90ff',
      noteIds: ['rich-lh-n3'],
      text: 'Root of ii7 in the bass',
    });
  }
  return document;
}

function expectedDraft(revision: 1 | 2, updatedAt: string, expiresAt: string) {
  return {
    state: 'draft',
    scoreId: SCORE_ID,
    revision,
    score: expectedDocument(revision),
    createdAt: AT.create,
    updatedAt,
    expiresAt,
  };
}

function expectedSaved(revision: 2 | 3, updatedAt: string) {
  return {
    state: 'saved',
    scoreId: SCORE_ID,
    revision,
    score: expectedDocument(revision),
    title: LIBRARY_TITLE,
    tags: LIBRARY_TAGS,
    createdAt: AT.save,
    updatedAt,
  };
}

function expectedSummary(revision: 2 | 3, updatedAt: string) {
  return {
    scoreId: SCORE_ID,
    title: LIBRARY_TITLE,
    tags: LIBRARY_TAGS,
    revision,
    createdAt: AT.save,
    updatedAt,
  };
}

const EMPTY_PAGE = { items: [], page: { limit: 20, offset: 0, total: 0, nextOffset: null } };

function onePage(summary: ReturnType<typeof expectedSummary>) {
  return { items: [summary], page: { limit: 20, offset: 0, total: 1, nextOffset: null } };
}

function expectJson(response: HttpResult, status: number): void {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
}

/** Every `id` inside a JSON document (score, staves, bars, voices, events, notes, spans, labels), sorted. */
function innerIds(document: unknown): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'id' && typeof child === 'string') {
          ids.push(child);
        }
        visit(child);
      }
    }
  };
  visit(document);
  return [...new Set(ids)].sort();
}

interface FlowTrace {
  created: ToolResult;
  afterCreate: RowCounts;
  gotDraft: ToolResult;
  editedDraft: ToolResult;
  beforeSave: RowCounts;
  searchedBeforeSave: ToolResult;
  listedBeforeSave: HttpResult;
  reopenedBeforeSave: HttpResult;
  saved: ToolResult;
  afterSave: RowCounts;
  draftRowAfterSave: StoredDraft | null;
  savedRowAfterSave: StoredScore | null;
  searched: ToolResult;
  listed: HttpResult;
  reopened: HttpResult;
  editedSaved: ToolResult;
  afterSavedEdit: RowCounts;
  savedRowAfterEdit: StoredScore | null;
  gotSaved: ToolResult;
  reopenedAfterEdit: HttpResult;
  listedAfterEdit: HttpResult;
}

const clock = new TestClock(F12_NOW);
let stack: AcceptanceStack;
let trace: FlowTrace;

beforeAll(async () => {
  stack = await startAcceptanceStack({ clock, ids: new SequentialScoreIds() });
  const client = await stack.mcpClient(TEST_USER_A.id);
  const tool = (name: string, args: Record<string, unknown>) => callTool(client, name, args);
  const rest = (path: string) => stack.apiGet(TEST_USER_A.id, path);
  const counts = () => rowCounts(stack.backend, TEST_USER_A.id);

  clock.set(AT.create);
  const created = await tool('create_score', { score: scoreArgument(RICH_WIRE_FIXTURE) });
  const afterCreate = await counts();
  clock.set(AT.get);
  const gotDraft = await tool('get_score', { scoreId: SCORE_ID });
  clock.set(AT.edit);
  const editedDraft = await tool('edit_score', {
    scoreId: SCORE_ID,
    expectedRevision: 1,
    operations: DRAFT_EDIT,
  });
  const beforeSave = await counts();
  const searchedBeforeSave = await tool('search_scores', {});
  const listedBeforeSave = await rest('/scores');
  const reopenedBeforeSave = await rest(`/scores/${SCORE_ID}`);
  clock.set(AT.save);
  const saved = await tool('save_score', {
    scoreId: SCORE_ID,
    expectedRevision: 2,
    title: LIBRARY_TITLE,
    tags: LIBRARY_TAGS,
  });
  const afterSave = await counts();
  const draftRowAfterSave = await storedDraft(stack.backend, SCORE_ID);
  const savedRowAfterSave = await storedScore(stack.backend, SCORE_ID);
  const searched = await tool('search_scores', {});
  const listed = await rest('/scores');
  const reopened = await rest(`/scores/${SCORE_ID}`);
  clock.set(AT.editSaved);
  const editedSaved = await tool('edit_score', {
    scoreId: SCORE_ID,
    expectedRevision: 2,
    operations: SAVED_EDIT,
  });
  const afterSavedEdit = await counts();
  const savedRowAfterEdit = await storedScore(stack.backend, SCORE_ID);
  const gotSaved = await tool('get_score', { scoreId: SCORE_ID });
  const reopenedAfterEdit = await rest(`/scores/${SCORE_ID}`);
  const listedAfterEdit = await rest('/scores');

  trace = {
    created,
    afterCreate,
    gotDraft,
    editedDraft,
    beforeSave,
    searchedBeforeSave,
    listedBeforeSave,
    reopenedBeforeSave,
    saved,
    afterSave,
    draftRowAfterSave,
    savedRowAfterSave,
    searched,
    listed,
    reopened,
    editedSaved,
    afterSavedEdit,
    savedRowAfterEdit,
    gotSaved,
    reopenedAfterEdit,
    listedAfterEdit,
  };
});

afterAll(async () => {
  await stack?.close();
});

describe('FLOW-01 public lifecycle of one rich score (user A, MCP + REST)', () => {
  it('create_score: a draft artifact with the server ID, revision 1, the rich fixture unchanged, a 7-day expiry', () => {
    const output = createScoreOutputSchema.parse(outputOf(trace.created));

    expect(output).toEqual({
      artifact: expectedDraft(1, AT.create, EXPIRES_AFTER_CREATE),
    });
  });

  it('create_score: stores one draft of A and no saved row', () => {
    expect(trace.afterCreate).toEqual({ drafts: 1, saved: 0 });
  });

  it('get_score: the same draft, unchanged by the read (no TTL renewal)', () => {
    const output = getScoreOutputSchema.parse(outputOf(trace.gotDraft));

    expect(output).toEqual({ artifact: expectedDraft(1, AT.create, EXPIRES_AFTER_CREATE) });
  });

  it('edit_score on the same ID: revision 2, both edits applied, every other layer and inner ID kept, TTL renewed', () => {
    const output = editScoreOutputSchema.parse(outputOf(trace.editedDraft));

    expect(output).toEqual({ artifact: expectedDraft(2, AT.edit, EXPIRES_AFTER_EDIT) });
  });

  it('before save_score: no saved row, nothing searchable or listed, and GET /scores/:id does not serve the draft', () => {
    expect(trace.beforeSave).toEqual({ drafts: 1, saved: 0 });
    expect(searchScoresOutputSchema.parse(outputOf(trace.searchedBeforeSave))).toEqual(EMPTY_PAGE);
    expectJson(trace.listedBeforeSave, 200);
    expect(listScoresResponseSchema.parse(trace.listedBeforeSave.body)).toEqual(EMPTY_PAGE);
    expectJson(trace.reopenedBeforeSave, 404);
    expect(errorEnvelopeSchema.parse(trace.reopenedBeforeSave.body).code).toBe('NOT_FOUND');
  });

  it('save_score (explicit): saved, same ID and revision, the edited score, the given title and tags', () => {
    const output = saveScoreOutputSchema.parse(outputOf(trace.saved));

    expect(output).toEqual({ outcome: 'saved', artifact: expectedSaved(2, AT.save) });
  });

  it('save_score: exactly one saved row, holding the returned score and library metadata, and no draft left', () => {
    expect(trace.afterSave).toEqual({ drafts: 0, saved: 1 });
    expect(trace.draftRowAfterSave).toBeNull();
    expect(trace.savedRowAfterSave).toEqual({
      owner: TEST_USER_A.id,
      revision: 2,
      spec: expectedDocument(2),
      title: LIBRARY_TITLE,
      tags: LIBRARY_TAGS,
      createdAt: AT.save,
      updatedAt: AT.save,
    });
  });

  it('search_scores (MCP) and GET /scores (REST) list the same single summary, without score content', () => {
    const viaMcp = searchScoresOutputSchema.parse(outputOf(trace.searched));
    expectJson(trace.listed, 200);
    const viaRest = listScoresResponseSchema.parse(trace.listed.body);

    expect(viaMcp).toEqual(onePage(expectedSummary(2, AT.save)));
    expect(viaRest).toEqual(viaMcp);
  });

  it('GET /scores/:id reopens the saved artifact exactly as save_score returned it', () => {
    expectJson(trace.reopened, 200);
    expect(trace.reopened.headers.get('cache-control')).toBe('private, no-store');

    expect(savedScoreResponseSchema.parse(trace.reopened.body)).toEqual(expectedSaved(2, AT.save));
  });

  it('edit_score on the saved ID: revision 3, still saved, library title/tags/createdAt kept, no draft recreated', () => {
    const output = editScoreOutputSchema.parse(outputOf(trace.editedSaved));

    expect(output).toEqual({ artifact: expectedSaved(3, AT.editSaved) });
    expect(trace.afterSavedEdit).toEqual({ drafts: 0, saved: 1 });
    expect(trace.savedRowAfterEdit).toEqual({
      owner: TEST_USER_A.id,
      revision: 3,
      spec: expectedDocument(3),
      title: LIBRARY_TITLE,
      tags: LIBRARY_TAGS,
      createdAt: AT.save,
      updatedAt: AT.editSaved,
    });
  });

  it('get_score and GET /scores/:id return the edited saved revision; GET /scores lists revision 3', () => {
    expect(getScoreOutputSchema.parse(outputOf(trace.gotSaved))).toEqual({
      artifact: expectedSaved(3, AT.editSaved),
    });
    expectJson(trace.reopenedAfterEdit, 200);
    expect(savedScoreResponseSchema.parse(trace.reopenedAfterEdit.body)).toEqual(
      expectedSaved(3, AT.editSaved),
    );
    expect(listScoresResponseSchema.parse(trace.listedAfterEdit.body)).toEqual(
      onePage(expectedSummary(3, AT.editSaved)),
    );
  });

  it('keeps every inner ID of the fixture through both edits, adding only the new annotation', () => {
    const final = savedScoreResponseSchema.parse(trace.reopenedAfterEdit.body).score;
    const fixtureIds = innerIds(RICH_WIRE_FIXTURE).filter((id) => id !== 'rich');

    expect(innerIds(final).filter((id) => id !== SCORE_ID)).toEqual(
      [...fixtureIds, 'rich-a3'].sort(),
    );
  });
});
