/**
 * SearchScores (issue #10, APPLICATION_LAYER.md §5.5): one page of the owner's
 * saved-score summaries. Drafts are never listed; a store failure is an error,
 * never an empty page.
 */
import { type SearchScoresOutput, searchScoresInputSchema } from '@sheet-music/music-contracts';
import { type AppResult, ok } from '../errors';
import type { AuthenticatedPrincipal, SavedScoreQuery, SavedScoreRepository } from '../ports';
import { fromStore, parseInput, requireOwner, scoreSummary } from '../shared';

export interface SearchScoresDependencies {
  readonly saved: SavedScoreRepository;
}

export class SearchScores {
  constructor(private readonly deps: SearchScoresDependencies) {}

  /** `input` is the search_scores input `{ query?, tags?, limit?, offset? }` (untrusted). */
  async execute(
    principal: AuthenticatedPrincipal | null | undefined,
    input: unknown,
  ): Promise<AppResult<SearchScoresOutput>> {
    const owner = requireOwner(principal);
    if (!owner.ok) {
      return owner;
    }
    const parsed = parseInput(searchScoresInputSchema, input);
    if (!parsed.ok) {
      return parsed;
    }
    const { query: text, tags, limit, offset } = parsed.value;
    const query: SavedScoreQuery = { ...(text === undefined ? {} : { text }), tags, limit, offset };
    const page = await fromStore(() => this.deps.saved.search(owner.value, query));
    if (!page.ok) {
      return page;
    }
    const { items, total } = page.value;
    const end = offset + items.length;
    return ok({
      items: items.map(scoreSummary),
      page: { limit, offset, total, nextOffset: items.length > 0 && end < total ? end : null },
    });
  }
}
