/**
 * LIB-02 (issue #10): reads resolve the owner's live draft or saved score and
 * never write (no promotion, no TTL renewal). Foreign and missing IDs look the
 * same. Search asks the repository for saved summaries only, with the
 * normalized query, and a store failure is an error, never an empty page.
 * Matching and ordering semantics are tested against the database in #9.
 */
import { F01, F02 } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { StoredScoreUnreadableError } from '../src/index';
import type { StoreMethod } from './support/in-memory-store';
import {
  ALICE,
  BOB,
  DAY,
  HOUR,
  at,
  draftRow,
  expectError,
  expectOk,
  iso,
  makeHarness,
  savedRow,
  storedSpec,
} from './support/harness';

const DRAFT_SPEC = storedSpec(F01, 'd1', 2);
const SAVED_SPEC = storedSpec(F02, 's1', 6);

/** Alice owns draft d1 (written T0, expires T0 + 7 days) and saved s1; the clock is T0 + 2 days. */
function withLibrary() {
  const harness = makeHarness({ start: at(2 * DAY) });
  harness.store.putDraft(
    'user-a',
    draftRow(DRAFT_SPEC, { createdAt: at(0), expiresAt: at(7 * DAY) }),
  );
  harness.store.putSaved(
    'user-a',
    savedRow(SAVED_SPEC, {
      title: 'Two hands',
      tags: ['piano'],
      createdAt: at(HOUR),
      updatedAt: at(DAY),
    }),
  );
  return harness;
}

describe('LIB-02 GetScore and GetSavedScore', () => {
  it('returns the live draft as a draft artifact without writing anything', async () => {
    const harness = withLibrary();

    const output = expectOk(await harness.getScore.execute(ALICE, { scoreId: 'd1' }));

    expect(output.artifact).toEqual({
      state: 'draft',
      scoreId: 'd1',
      revision: 2,
      score: DRAFT_SPEC,
      createdAt: iso(0),
      updatedAt: iso(0),
      expiresAt: iso(7 * DAY),
    });
    expect(harness.store.writeCalls()).toEqual([]);
  });

  it('returns the saved score with its library title and tags', async () => {
    const harness = withLibrary();

    const output = expectOk(await harness.getScore.execute(ALICE, { scoreId: 's1' }));

    expect(output.artifact).toEqual({
      state: 'saved',
      scoreId: 's1',
      revision: 6,
      score: SAVED_SPEC,
      title: 'Two hands',
      tags: ['piano'],
      createdAt: iso(HOUR),
      updatedAt: iso(DAY),
    });
    expect(harness.store.writeCalls()).toEqual([]);
  });

  it('prefers the saved score when a draft with the same ID still exists', async () => {
    const harness = withLibrary();
    harness.store.putDraft(
      'user-a',
      draftRow(storedSpec(F01, 's1', 9), { createdAt: at(0), expiresAt: at(7 * DAY) }),
    );

    const output = expectOk(await harness.getScore.execute(ALICE, { scoreId: 's1' }));

    expect(output.artifact.state).toBe('saved');
    expect(output.artifact.revision).toBe(6);
  });

  it("answers another user's exact ID exactly like a missing ID (NOT_FOUND)", async () => {
    const harness = withLibrary();

    const foreignDraft = expectError(await harness.getScore.execute(BOB, { scoreId: 'd1' }));
    const foreignSaved = expectError(await harness.getScore.execute(BOB, { scoreId: 's1' }));
    const missing = expectError(await harness.getScore.execute(ALICE, { scoreId: 'nope' }));

    expect(foreignDraft.code).toBe('NOT_FOUND');
    expect(foreignDraft).toEqual(missing);
    expect(foreignSaved).toEqual(missing);
  });

  it('GetSavedScore serves saved scores only: an own draft is NOT_FOUND', async () => {
    const harness = withLibrary();

    const saved = expectOk(await harness.getSavedScore.execute(ALICE, { scoreId: 's1' }));
    const draft = expectError(await harness.getSavedScore.execute(ALICE, { scoreId: 'd1' }));

    expect(saved.artifact.state).toBe('saved');
    expect(saved.artifact.scoreId).toBe('s1');
    expect(draft.code).toBe('NOT_FOUND');
  });

  it.each<{ name: string; method: StoreMethod; failure: unknown; code: string }>([
    {
      name: 'the saved store is down',
      method: 'saved.get',
      failure: new Error('timeout'),
      code: 'DEPENDENCY_UNAVAILABLE',
    },
    {
      name: 'the draft store is down',
      method: 'drafts.get',
      failure: new Error('timeout'),
      code: 'DEPENDENCY_UNAVAILABLE',
    },
    {
      name: 'the stored score is unreadable',
      method: 'drafts.get',
      failure: new StoredScoreUnreadableError(),
      code: 'INTERNAL',
    },
  ])('fails safely when $name ($code)', async ({ method, failure, code }) => {
    const harness = withLibrary();
    harness.store.failures.set(method, failure);

    const error = expectError(await harness.getScore.execute(ALICE, { scoreId: 'd1' }));

    expect(error.code).toBe(code);
    expect(error.details).toEqual([]);
  });

  it.each([
    { name: 'a path-like ID', scoreId: '../d1' },
    { name: 'an empty ID', scoreId: '' },
    { name: 'a numeric ID', scoreId: 42 },
  ])('rejects $name as INVALID_INPUT without a store call', async ({ scoreId }) => {
    const harness = withLibrary();

    const error = expectError(await harness.getScore.execute(ALICE, { scoreId }));

    expect(error.code).toBe('INVALID_INPUT');
    expect(harness.store.calls).toEqual([]);
  });
});

describe('LIB-02 SearchScores', () => {
  const SUMMARY = {
    id: 's1',
    title: 'Two hands',
    tags: ['piano'],
    revision: 6,
    createdAt: at(HOUR),
    updatedAt: at(DAY),
  };

  it('asks for the owner saved summaries with the normalized query and returns summaries without content', async () => {
    const harness = withLibrary();
    harness.store.searchPage = { items: [SUMMARY], total: 1 };

    const output = expectOk(
      await harness.searchScores.execute(ALICE, {
        query: '  bebop   lines ',
        tags: ['Jazz', 'jazz', ' ii-V-I '],
      }),
    );

    expect(harness.store.searchQueries).toEqual([
      {
        owner: 'user-a',
        query: { text: 'bebop lines', tags: ['Jazz', 'ii-V-I'], limit: 20, offset: 0 },
      },
    ]);
    expect(output).toEqual({
      items: [
        {
          scoreId: 's1',
          title: 'Two hands',
          tags: ['piano'],
          revision: 6,
          createdAt: iso(HOUR),
          updatedAt: iso(DAY),
        },
      ],
      page: { limit: 20, offset: 0, total: 1, nextOffset: null },
    });
    expect(harness.store.writeCalls()).toEqual([]);
    expect(harness.store.draftOf('user-a', 'd1')?.expiresAt).toEqual(at(7 * DAY));
  });

  it('sends no text filter for a blank query', async () => {
    const harness = withLibrary();

    expectOk(await harness.searchScores.execute(ALICE, { query: '   ', limit: 5, offset: 10 }));

    expect(harness.store.searchQueries[0]?.query).toEqual({ tags: [], limit: 5, offset: 10 });
  });

  it.each([
    { name: 'more matches after this page', offset: 0, returned: 2, total: 5, nextOffset: 2 },
    { name: 'the last page', offset: 4, returned: 1, total: 5, nextOffset: null },
    { name: 'an offset past the end', offset: 10, returned: 0, total: 3, nextOffset: null },
    { name: 'no match at all', offset: 0, returned: 0, total: 0, nextOffset: null },
    {
      name: 'an empty page despite a larger total',
      offset: 0,
      returned: 0,
      total: 3,
      nextOffset: null,
    },
  ])('computes nextOffset for $name', async ({ offset, returned, total, nextOffset }) => {
    const harness = withLibrary();
    harness.store.searchPage = { items: Array.from({ length: returned }, () => SUMMARY), total };

    const output = expectOk(await harness.searchScores.execute(ALICE, { limit: 2, offset }));

    expect(output.items).toHaveLength(returned);
    expect(output.page).toEqual({ limit: 2, offset, total, nextOffset });
  });

  it('reports a store failure as DEPENDENCY_UNAVAILABLE, not as an empty result', async () => {
    const harness = withLibrary();
    harness.store.failures.set('saved.search', new Error('connection reset'));

    const error = expectError(await harness.searchScores.execute(ALICE, {}));

    expect(error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it.each([
    { name: 'a zero page size', input: { limit: 0 }, path: ['limit'] },
    { name: 'a page size above 50', input: { limit: 51 }, path: ['limit'] },
    { name: 'a negative offset', input: { offset: -1 }, path: ['offset'] },
    { name: 'an offset above 10000', input: { offset: 10_001 }, path: ['offset'] },
    { name: 'a fractional page size', input: { limit: 2.5 }, path: ['limit'] },
    { name: 'a forged owner', input: { ownerId: 'user-a' }, path: ['ownerId'] },
  ])('rejects $name as INVALID_INPUT without querying', async ({ input, path }) => {
    const harness = withLibrary();

    const error = expectError(await harness.searchScores.execute(BOB, input));

    expect(error.code).toBe('INVALID_INPUT');
    expect(error.details).toContainEqual(expect.objectContaining({ path }));
    expect(harness.store.calls).toEqual([]);
  });

  it('rejects a missing principal before querying', async () => {
    const harness = withLibrary();

    const error = expectError(await harness.searchScores.execute(undefined, {}));

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(harness.store.calls).toEqual([]);
  });
});
