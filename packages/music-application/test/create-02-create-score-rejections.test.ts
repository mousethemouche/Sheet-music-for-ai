/**
 * CREATE-02 (issue #8): a rejected create writes nothing. Representative
 * domain rejections (the full validation matrix is #2), malformed envelopes,
 * a missing principal and a failing draft store, which must surface as an
 * error with no in-memory fallback.
 */
import {
  F01,
  F09_COLOR_CONFLICT,
  F11_THIRTY_THREE_BARS,
  RICH_WIRE_FIXTURE,
} from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '../src/index';
import { ALICE, expectError, makeHarness, scorePayload } from './support/harness';

describe('CREATE-02 rejected creates write nothing', () => {
  it.each([
    {
      name: 'a P-03 color conflict (SCORE_VALIDATION_FAILED)',
      score: scorePayload(F09_COLOR_CONFLICT),
      code: 'SCORE_VALIDATION_FAILED',
      detail: {
        code: 'ANNOTATION_COLOR_CONFLICT',
        path: ['score', 'annotations'],
        ids: ['f09-n3', 'f09-a1', 'f09-a2'],
      },
    },
    {
      name: '33 aligned bars (MVP_LIMIT_EXCEEDED)',
      score: scorePayload(F11_THIRTY_THREE_BARS),
      code: 'MVP_LIMIT_EXCEEDED',
      detail: { code: 'TOO_MANY_MEASURES', path: ['score', 'staves', 0, 'measures'] },
    },
  ])('rejects $name with the domain error, paths pointing into the request', async (row) => {
    const harness = makeHarness();

    const error = expectError(await harness.createScore.execute(ALICE, { score: row.score }));

    expect(error.code).toBe(row.code);
    expect(error.details).toContainEqual(expect.objectContaining(row.detail));
    expect(harness.store.calls).toEqual([]);
  });

  it.each([
    { name: 'no score', input: {}, detail: { code: 'INVALID_TYPE', path: ['score'] } },
    {
      name: 'a score that is an array',
      input: { score: [] },
      detail: { code: 'INVALID_TYPE', path: ['score'] },
    },
    {
      name: 'a client-chosen score ID',
      input: { score: { ...scorePayload(F01), id: 'mine' } },
      detail: { code: 'INVALID_VALUE', path: ['score', 'id'] },
    },
    {
      name: 'a client-chosen revision',
      input: { score: { ...scorePayload(F01), revision: 9 } },
      detail: { code: 'INVALID_VALUE', path: ['score', 'revision'] },
    },
    {
      name: 'a forged owner field',
      input: { score: scorePayload(F01), ownerId: 'user-b' },
      detail: { code: 'UNKNOWN_FIELD', path: ['ownerId'] },
    },
  ])('rejects an envelope with $name as INVALID_INPUT', async ({ input, detail }) => {
    const harness = makeHarness();

    const error = expectError(await harness.createScore.execute(ALICE, input));

    expect(error.code).toBe('INVALID_INPUT');
    expect(error.details).toContainEqual(expect.objectContaining(detail));
    expect(harness.store.calls).toEqual([]);
  });

  it.each<{ name: string; principal: AuthenticatedPrincipal | null | undefined }>([
    { name: 'undefined', principal: undefined },
    { name: 'null', principal: null },
    { name: 'an empty user ID', principal: { userId: '' } },
    { name: 'a blank user ID', principal: { userId: '   ' } },
  ])('rejects a missing principal ($name) before touching the store', async ({ principal }) => {
    const harness = makeHarness();

    const error = expectError(
      await harness.createScore.execute(principal, { score: scorePayload(F01) }),
    );

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(harness.store.calls).toEqual([]);
  });

  it('reports a draft-store failure as DEPENDENCY_UNAVAILABLE and keeps no copy anywhere', async () => {
    const harness = makeHarness({ ids: ['scr_0001'] });
    const outage = new Error('connection refused');
    harness.store.failures.set('drafts.create', outage);

    const error = expectError(
      await harness.createScore.execute(ALICE, { score: scorePayload(RICH_WIRE_FIXTURE) }),
    );

    expect(error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(error.cause).toBe(outage);
    expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty('cause');
    expect(harness.store.draftCount).toBe(0);
    expect(harness.store.savedCount).toBe(0);

    // No in-memory fallback: once the store works again the score does not exist.
    harness.store.failures.clear();
    const lookup = expectError(await harness.getScore.execute(ALICE, { scoreId: 'scr_0001' }));
    expect(lookup.code).toBe('NOT_FOUND');
  });

  it('refuses a generated ID that breaks the ID pattern (INTERNAL) and stores nothing', async () => {
    const harness = makeHarness({ ids: ['not a valid id'] });

    const error = expectError(
      await harness.createScore.execute(ALICE, { score: scorePayload(F01) }),
    );

    expect(error.code).toBe('INTERNAL');
    expect(harness.store.calls).toEqual([]);
  });
});
