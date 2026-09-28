/**
 * LIB-03 (issue #10): library title and free-form tags, as SaveScore stores
 * them. One row per normalization branch: whitespace, Unicode NFC, case-
 * insensitive de-duplication (first spelling kept), code-point bounds, zero
 * tags, no fixed taxonomy. Invalid metadata never reaches the promotion.
 */
import { F01 } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  ALICE,
  DAY,
  at,
  draftRow,
  expectError,
  expectOk,
  makeHarness,
  storedSpec,
} from './support/harness';

const BASE = { scoreId: 'd1', expectedRevision: 1 };

function withDraft() {
  const harness = makeHarness({ start: at(0) });
  harness.store.putDraft(
    'user-a',
    draftRow(storedSpec(F01, 'd1', 1), { createdAt: at(0), expiresAt: at(7 * DAY) }),
  );
  return harness;
}

const distinctTags = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `tag-${index + 1}`);

describe('LIB-03 library metadata normalization', () => {
  it.each([
    {
      name: 'trims and collapses whitespace in the title',
      input: { title: '  Blues \t in\n F  ' },
      title: 'Blues in F',
      tags: [],
    },
    {
      name: 'composes decomposed accents (NFC) in the title',
      input: { title: 'Café swing' },
      title: 'Café swing',
      tags: [],
    },
    {
      name: 'accepts a 120-code-point title made of astral characters',
      input: { title: '\u{1D11E}'.repeat(120) },
      title: '\u{1D11E}'.repeat(120),
      tags: [],
    },
    { name: 'stores zero tags when tags are omitted', input: { title: 'T' }, title: 'T', tags: [] },
    {
      name: 'stores zero tags when tags are empty',
      input: { title: 'T', tags: [] },
      title: 'T',
      tags: [],
    },
    {
      name: 'normalizes whitespace inside tags',
      input: { title: 'T', tags: ['  walking   bass '] },
      title: 'T',
      tags: ['walking bass'],
    },
    {
      name: 'drops case-insensitive duplicates and keeps the first spelling and order',
      input: { title: 'T', tags: ['Jazz', 'bebop', 'jazz', 'JAZZ', 'Bebop'] },
      title: 'T',
      tags: ['Jazz', 'bebop'],
    },
    {
      name: 'treats composed and decomposed spellings as one tag',
      input: { title: 'T', tags: ['étude', 'étude'] },
      title: 'T',
      tags: ['étude'],
    },
    {
      name: 'keeps free-form tags outside any taxonomy',
      input: { title: 'T', tags: ['ii-V-I', '7/4', 'left hand #2'] },
      title: 'T',
      tags: ['ii-V-I', '7/4', 'left hand #2'],
    },
    {
      name: 'accepts 16 distinct tags',
      input: { title: 'T', tags: distinctTags(16) },
      title: 'T',
      tags: distinctTags(16),
    },
    {
      name: 'counts tags after de-duplication (17 copies of one tag)',
      input: { title: 'T', tags: Array.from({ length: 17 }, () => 'jazz') },
      title: 'T',
      tags: ['jazz'],
    },
  ])('$name', async ({ input, title, tags }) => {
    const harness = withDraft();

    const output = expectOk(await harness.saveScore.execute(ALICE, { ...BASE, ...input }));

    expect(output.artifact.title).toBe(title);
    expect(output.artifact.tags).toEqual(tags);
    expect(harness.store.savedOf('user-a', 'd1')).toMatchObject({ title, tags });
  });

  it.each([
    { name: 'a missing title', input: {}, detail: { code: 'INVALID_TYPE', path: ['title'] } },
    {
      name: 'a blank title',
      input: { title: ' \n ' },
      detail: { code: 'INVALID_VALUE', path: ['title'] },
    },
    {
      name: 'a 121-code-point title',
      input: { title: '\u{1D11E}'.repeat(121) },
      detail: { code: 'TEXT_TOO_LONG', path: ['title'] },
    },
    {
      name: 'a control character in the title',
      input: { title: 'Blues\u0000' },
      detail: { code: 'INVALID_VALUE', path: ['title'] },
    },
    {
      name: 'tags that are not a list',
      input: { title: 'T', tags: 'jazz' },
      detail: { code: 'INVALID_TYPE', path: ['tags'] },
    },
    {
      name: 'a blank tag',
      input: { title: 'T', tags: ['jazz', '  '] },
      detail: { code: 'INVALID_VALUE', path: ['tags', 1] },
    },
    {
      name: 'a 41-code-point tag',
      input: { title: 'T', tags: ['x'.repeat(41)] },
      detail: { code: 'TEXT_TOO_LONG', path: ['tags', 0] },
    },
    {
      name: '17 distinct tags',
      input: { title: 'T', tags: distinctTags(17) },
      detail: { code: 'TOO_MANY_ITEMS', path: ['tags'] },
    },
  ])('rejects $name as INVALID_INPUT before any promotion', async ({ input, detail }) => {
    const harness = withDraft();

    const error = expectError(await harness.saveScore.execute(ALICE, { ...BASE, ...input }));

    expect(error.code).toBe('INVALID_INPUT');
    expect(error.details).toContainEqual(expect.objectContaining(detail));
    expect(harness.store.calls).toEqual([]);
  });
});
