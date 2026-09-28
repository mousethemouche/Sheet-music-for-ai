/**
 * SavedScoreRepository over public.scores, the permanent library (ADR-005,
 * APPLICATION_LAYER.md §3.5). Every call runs on the owner's user path.
 *
 * Search (DATABASE.md "Search semantics"):
 * - `text`: case-insensitive substring of the library title or of any ONE tag
 *   (ILIKE, never across two tags). `%`, `_` and `\` in the text are escaped,
 *   so they only match themselves;
 * - `tags`: the score carries every filter tag, compared case-insensitively
 *   with `lower()` (whole tags, no wildcard);
 * - order `updated_at desc, id asc`, the ID compared byte by byte
 *   (`collate "C"`), so ties are stable whatever the database locale;
 * - `total` counts every match of the owner, from the same snapshot as the page.
 * All user values are bound parameters.
 */
import type {
  SavedScore,
  SavedScoreRepository,
  SavedScoreSummary,
} from '@sheet-music/music-application';
import type { Pool } from 'pg';
import { asOwner, readStoredSpec } from './access';
import { PersistenceError } from './errors';

interface SavedRow {
  readonly score_spec: unknown;
  readonly title: string;
  readonly tags: string[];
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface SummaryRow {
  readonly id: string;
  readonly title: string;
  readonly tags: string[];
  readonly revision: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** One row per summary of the page, or a single all-null row when the page is empty. */
type SearchRow = { readonly total: number } & (
  SummaryRow | { readonly [K in keyof SummaryRow]: null }
);

// One statement: the total and the page come from the same snapshot, and an
// empty page (offset past the end) still reports the total.
const SEARCH = `
with matches as (
  select s.id, s.title, s.tags, s.revision, s.created_at, s.updated_at
  from public.scores s
  where s.owner_user_id = $1
    and (
      $2::text is null
      or s.title ilike $2 escape '\\'
      or exists (select 1 from unnest(s.tags) as tag where tag ilike $2 escape '\\')
    )
    and not exists (
      select 1 from unnest($3::text[]) as wanted
      where not exists (select 1 from unnest(s.tags) as tag where lower(tag) = lower(wanted))
    )
)
select counted.total, page.id, page.title, page.tags, page.revision, page.created_at, page.updated_at
from (select count(*)::integer as total from matches) as counted
left join lateral (
  select * from matches
  order by updated_at desc, id collate "C" asc
  limit $4 offset $5
) as page on true
order by page.updated_at desc, page.id collate "C" asc`;

/** A LIKE pattern matching `text` literally anywhere: `%`, `_` and the escape `\` are escaped. */
function substringPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function isSummaryRow(row: SearchRow): row is { readonly total: number } & SummaryRow {
  return row.id !== null;
}

export function createSavedScoreRepository(pool: Pool): SavedScoreRepository {
  return {
    async get(owner, id) {
      const { rows } = await asOwner(pool, 'saved.get', owner, (client) =>
        client.query<SavedRow>(
          `select score_spec, title, tags, created_at, updated_at
           from public.scores
           where owner_user_id = $1 and id = $2`,
          [owner, id],
        ),
      );
      const [row] = rows;
      if (row === undefined) {
        return null;
      }
      const saved: SavedScore = {
        spec: readStoredSpec('scores', id, row.score_spec),
        title: row.title,
        tags: row.tags,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      return saved;
    },

    // Single compare-and-swap statement. Library title and tags, created_at and
    // the identity are immutable in MVP (DATABASE.md §3.1): only the ScoreSpec
    // and updated_at are written.
    async update(owner, saved, expectedRevision) {
      const { rowCount } = await asOwner(pool, 'saved.update', owner, (client) =>
        client.query(
          `update public.scores
           set score_spec = $4, score_spec_version = $5, revision = $6, updated_at = $7
           where owner_user_id = $1 and id = $2 and revision = $3`,
          [
            owner,
            saved.spec.id,
            expectedRevision,
            JSON.stringify(saved.spec),
            saved.spec.version,
            saved.spec.revision,
            saved.updatedAt,
          ],
        ),
      );
      return rowCount === 1 ? 'updated' : 'stale';
    },

    async search(owner, query) {
      const { rows } = await asOwner(pool, 'saved.search', owner, (client) =>
        client.query<SearchRow>(SEARCH, [
          owner,
          query.text === undefined ? null : substringPattern(query.text),
          [...query.tags],
          query.limit,
          query.offset,
        ]),
      );
      const [first] = rows;
      if (first === undefined) {
        throw new PersistenceError('saved.search', new Error('The search returned no row.'));
      }
      const items = rows.filter(isSummaryRow).map((row): SavedScoreSummary => ({
        id: row.id,
        title: row.title,
        tags: row.tags,
        revision: row.revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
      return { items, total: first.total };
    },
  };
}
