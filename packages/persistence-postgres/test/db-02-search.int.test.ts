/**
 * DB-02 search table (issue #9): SavedScoreRepository.search on the real
 * database, against an A/B dataset of saved scores and drafts. Each case
 * names its expected IDs, in order, and the total.
 *
 * Semantics under test (DATABASE.md "Search semantics", APPLICATION_LAYER
 * §3.5): text is a case-insensitive substring of the library title or of one
 * tag; tag filters are whole, case-insensitive tags that must all be present;
 * order is updated_at desc then ID in byte order; `total` counts all matches;
 * only the owner's saved scores are ever returned (never drafts, never B's,
 * never ScoreSpec metadata). Quote- and wildcard-shaped input is bound and
 * escaped, so it only matches itself.
 */
import type { SavedScoreQuery } from '@sheet-music/music-application';
import { F01, cloneFixture } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PostgresPersistence, createPostgresPersistence } from '../src';
import { type TestDatabase, createTestDatabase, seedTestUsers } from '../testing';
import { A, B, type SavedSeed, at, draftRecord, f01Spec, insertSavedRow } from './support/fixtures';

const TIE = at('2026-09-26T10:00:00.000Z');

const A_SAVED: readonly SavedSeed[] = [
  {
    id: 'scr_meta',
    owner: A,
    title: 'Lead Sheet',
    tags: [],
    updatedAt: at('2026-09-19T10:00:00Z'),
    // ScoreSpec metadata differs from the library title and tags, and is never searched.
    spec: {
      ...cloneFixture(F01),
      id: 'scr_meta',
      revision: 1,
      metadata: { title: 'Hidden Metadata Title', tags: ['secret'] },
    },
  },
  {
    id: 'scr_autumn',
    owner: A,
    title: 'Autumn Leaves',
    tags: ['jazz', 'standard'],
    updatedAt: at('2026-09-20T10:00:00Z'),
  },
  {
    id: 'scr_bossa',
    owner: A,
    title: 'Blue Bossa',
    tags: ['Jazz', 'latin'],
    updatedAt: at('2026-09-21T10:00:00Z'),
    createdAt: at('2026-09-01T08:00:00Z'),
    spec: f01Spec('scr_bossa', 4),
  },
  {
    id: 'scr_etude',
    owner: A,
    title: 'Étude in C',
    tags: ['classical'],
    updatedAt: at('2026-09-22T10:00:00Z'),
  },
  {
    id: 'scr_percent',
    owner: A,
    title: '100% Swing',
    tags: ['jazz_waltz'],
    updatedAt: at('2026-09-23T10:00:00Z'),
  },
  {
    id: 'scr_backslash',
    owner: A,
    title: 'Back\\slash Blues',
    tags: ['blues'],
    updatedAt: at('2026-09-24T10:00:00Z'),
  },
  {
    id: 'scr_quote',
    owner: A,
    title: "O'Brien's Reel",
    tags: ['folk'],
    updatedAt: at('2026-09-25T10:00:00Z'),
  },
  // Three ties: byte order puts "B" (0x42) before "a" (0x61), unlike a linguistic collation.
  { id: 'scr_tie_c', owner: A, title: 'Tie Three', tags: ['tie'], updatedAt: TIE },
  { id: 'scr_tie_a', owner: A, title: 'Tie One', tags: ['tie'], updatedAt: TIE },
  { id: 'scr_tie_B', owner: A, title: 'Tie Two', tags: ['tie'], updatedAt: TIE },
];

// B's scores match many of A's queries and are the most recent: a leak would show first.
const B_SAVED: readonly SavedSeed[] = [
  {
    id: 'scr_b_autumn',
    owner: B,
    title: 'Autumn Leaves (B)',
    tags: ['jazz'],
    updatedAt: at('2026-09-27T10:00:00Z'),
  },
  {
    id: 'scr_b_percent',
    owner: B,
    title: '50% Off',
    tags: ['jazz_waltz', 'tie'],
    updatedAt: at('2026-09-27T11:00:00Z'),
  },
];

/** Every A saved score in the expected order: updated_at desc, then ID in byte order. */
const A_ORDER = [
  'scr_tie_B',
  'scr_tie_a',
  'scr_tie_c',
  'scr_quote',
  'scr_backslash',
  'scr_percent',
  'scr_etude',
  'scr_bossa',
  'scr_autumn',
  'scr_meta',
];

let db: TestDatabase;
let store: PostgresPersistence;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
  store = createPostgresPersistence({ connectionString: db.url });
  for (const seed of [...A_SAVED, ...B_SAVED]) {
    await insertSavedRow(db.admin, seed);
  }
  // A's drafts: one whose ScoreSpec title matches "autumn", one with a saved-looking tag set.
  await store.drafts.create(
    A,
    draftRecord(
      { ...f01Spec('scr_draft_autumn'), metadata: { title: 'Autumn Leaves', tags: ['jazz'] } },
      at('2026-09-28T10:00:00Z'),
    ),
  );
  await store.drafts.create(A, draftRecord(f01Spec('scr_draft_tie'), TIE));
});

afterAll(async () => {
  await store?.close();
  await db?.close();
});

interface SearchCase {
  readonly name: string;
  readonly text?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
  readonly ids: readonly string[];
  readonly total: number;
}

function query(testCase: SearchCase): SavedScoreQuery {
  return {
    ...(testCase.text === undefined ? {} : { text: testCase.text }),
    tags: testCase.tags ?? [],
    limit: testCase.limit ?? 50,
    offset: testCase.offset ?? 0,
  };
}

async function searchA(testCase: SearchCase) {
  const page = await store.saved.search(A, query(testCase));
  return { ids: page.items.map((item) => item.id), total: page.total };
}

describe('DB-02 matching', () => {
  it.each<SearchCase>([
    { name: 'no text and no tags lists every own saved score', ids: A_ORDER, total: 10 },
    { name: 'title substring, any case', text: 'autumn', ids: ['scr_autumn'], total: 1 },
    {
      name: 'title substring matching several scores',
      text: 'BLUE',
      ids: ['scr_backslash', 'scr_bossa'],
      total: 2,
    },
    { name: 'text matching one whole tag', text: 'LATIN', ids: ['scr_bossa'], total: 1 },
    { name: 'text matching part of one tag', text: 'stand', ids: ['scr_autumn'], total: 1 },
    { name: 'text never spans two tags', text: 'jazz standard', ids: [], total: 0 },
    { name: 'non-ASCII case folding', text: 'ÉTUDE', ids: ['scr_etude'], total: 1 },
    {
      name: 'tag filter, whole tag in any case',
      tags: ['JAZZ'],
      ids: ['scr_bossa', 'scr_autumn'],
      total: 2,
    },
    {
      name: 'every tag filter must be carried',
      tags: ['jazz', 'standard'],
      ids: ['scr_autumn'],
      total: 1,
    },
    { name: 'tag filter is not a substring match', tags: ['jazz_w'], ids: [], total: 0 },
    { name: 'text and tags combined', text: 'blue', tags: ['jazz'], ids: ['scr_bossa'], total: 1 },
    { name: 'text with no match', text: 'nocturne', ids: [], total: 0 },
    { name: 'tags with no common score', tags: ['tie', 'jazz'], ids: [], total: 0 },
    {
      name: 'ScoreSpec metadata title is not the library title',
      text: 'hidden metadata',
      ids: [],
      total: 0,
    },
    { name: 'ScoreSpec metadata tags are not library tags', tags: ['secret'], ids: [], total: 0 },
  ])('$name', async (testCase) => {
    expect(await searchA(testCase)).toEqual({ ids: testCase.ids, total: testCase.total });
  });

  it('returns summaries with library title and tags as stored (case kept), revision and times', async () => {
    const page = await store.saved.search(A, query({ name: '', text: 'bossa', ids: [], total: 1 }));
    expect(page).toEqual({
      items: [
        {
          id: 'scr_bossa',
          title: 'Blue Bossa',
          tags: ['Jazz', 'latin'],
          revision: 4,
          createdAt: at('2026-09-01T08:00:00Z'),
          updatedAt: at('2026-09-21T10:00:00Z'),
        },
      ],
      total: 1,
    });
  });

  it("lists only the caller's saved scores: B sees B's, never A's or any draft", async () => {
    const page = await store.saved.search(B, { tags: [], limit: 50, offset: 0 });
    expect({ ids: page.items.map((item) => item.id), total: page.total }).toEqual({
      ids: ['scr_b_percent', 'scr_b_autumn'],
      total: 2,
    });
  });
});

describe('DB-02 quote- and wildcard-shaped input only matches itself', () => {
  it.each<SearchCase>([
    { name: '"%" matches a literal percent sign', text: '%', ids: ['scr_percent'], total: 1 },
    { name: '"_" matches a literal underscore', text: '_', ids: ['scr_percent'], total: 1 },
    { name: '"\\" matches a literal backslash', text: '\\', ids: ['scr_backslash'], total: 1 },
    {
      name: '"\\%" matches only a backslash followed by a percent sign',
      text: '\\%',
      ids: [],
      total: 0,
    },
    { name: 'an apostrophe is plain text', text: "O'Brien", ids: ['scr_quote'], total: 1 },
    { name: 'quote-shaped boolean text', text: "' or '1'='1", ids: [], total: 0 },
    {
      name: 'text trying to widen the owner filter',
      text: "%' or owner_user_id is not null --",
      ids: [],
      total: 0,
    },
    { name: '"%" as a tag filter', tags: ['%'], ids: [], total: 0 },
    { name: 'a wildcard inside a tag filter', tags: ['jazz%'], ids: [], total: 0 },
    { name: 'a quote-shaped tag filter', tags: ["tie' or 'x'='x"], ids: [], total: 0 },
    {
      name: 'an underscore tag filter matches the literal tag only',
      tags: ['jazz_waltz'],
      ids: ['scr_percent'],
      total: 1,
    },
  ])('$name', async (testCase) => {
    expect(await searchA(testCase)).toEqual({ ids: testCase.ids, total: testCase.total });
  });
});

describe('DB-02 order and pages', () => {
  it.each<SearchCase>([
    {
      name: 'first page stops inside the tie group',
      limit: 2,
      offset: 0,
      ids: ['scr_tie_B', 'scr_tie_a'],
      total: 10,
    },
    {
      name: 'next page continues the tie group in ID order',
      limit: 2,
      offset: 2,
      ids: ['scr_tie_c', 'scr_quote'],
      total: 10,
    },
    { name: 'last partial page', limit: 4, offset: 8, ids: ['scr_autumn', 'scr_meta'], total: 10 },
    {
      name: 'offset at the end: empty page, total still counted',
      limit: 5,
      offset: 10,
      ids: [],
      total: 10,
    },
    {
      name: 'offset past the end of a filtered result',
      tags: ['tie'],
      limit: 5,
      offset: 7,
      ids: [],
      total: 3,
    },
    {
      name: 'filtered page inside ties',
      tags: ['TIE'],
      limit: 1,
      offset: 1,
      ids: ['scr_tie_a'],
      total: 3,
    },
  ])('$name', async (testCase) => {
    expect(await searchA(testCase)).toEqual({ ids: testCase.ids, total: testCase.total });
  });

  it('pages of 3 concatenate to the full order, without gaps or duplicates', async () => {
    const pages: string[] = [];
    for (const offset of [0, 3, 6, 9]) {
      const { ids } = await searchA({ name: '', limit: 3, offset, ids: [], total: 0 });
      pages.push(...ids);
    }
    expect(pages).toEqual(A_ORDER);
  });
});
