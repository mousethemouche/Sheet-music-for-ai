import {
  PAYLOAD_LIMITS,
  type ListScoresResponse,
  type ScoreSummary,
} from '@sheet-music/music-contracts';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { Link } from 'react-router';
import type { ApiResult, ScoresApi } from '../api/scoresApi';
import { Icon } from '../shell/icons';
import { ApiFailureAlert } from './ApiFailureAlert';
import { formatDate } from './format';
import { usePrivateCleanup, useSignedInUser } from './privateState';

/**
 * The saved-score library (#15, US-F1/F2): the signed-in user's own saved
 * scores with title, tags and date, text and tag search, and a link to open
 * each one. Loading, a genuinely empty library, a search without match and a
 * failed request are distinct states; a failure is never shown as an empty
 * library.
 */
export function LibraryPage(props: { scores: ScoresApi }): JSX.Element {
  const user = useSignedInUser();
  return (
    <section aria-labelledby="library-title" className="library">
      <div className="ui-page-header">
        <div className="ui-page-header__titles">
          <h1 id="library-title">Your library</h1>
          {user?.email && <p className="ui-page-subtitle">Signed in as {user.email}.</p>}
        </div>
      </div>
      {user && <Library key={user.id} scores={props.scores} />}
    </section>
  );
}

/** The committed search: what the list currently shows. */
interface Search {
  readonly query: string;
  readonly tags: readonly string[];
}

/** One list request: a search, the page offset, and the items already shown above that page. */
interface Load {
  readonly search: Search;
  readonly offset: number;
  readonly shown: readonly ScoreSummary[];
}

interface Outcome {
  readonly load: Load;
  readonly result: ApiResult<ListScoresResponse>;
}

const NO_SEARCH: Search = { query: '', tags: [] };

const firstPage = (search: Search): Load => ({ search, offset: 0, shown: [] });

const hasTag = (tags: readonly string[], tag: string): boolean =>
  tags.some((existing) => existing.toLowerCase() === tag.toLowerCase());

function Library(props: { scores: ScoresApi }): JSX.Element {
  const { scores } = props;
  const inputId = useId();
  const filtersId = useId();
  const [draft, setDraft] = useState('');
  const [load, setLoad] = useState<Load>(() => firstPage(NO_SEARCH));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Every new `load` supersedes the previous request: it is aborted and its
  // response, even if it still arrives, is ignored. Unmounting does the same.
  useEffect(() => {
    const controller = new AbortController();
    inFlight.current = controller;
    let current = true;
    const { search, offset } = load;
    void scores
      .listScores({ query: search.query, tags: search.tags, offset }, controller.signal)
      .then((result) => {
        if (current) setOutcome({ load, result });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [scores, load]);

  // Sign-out or account switch: stop fetching this account's library now.
  usePrivateCleanup(useCallback(() => inFlight.current?.abort(), []));

  const { search } = load;
  const searching = search.query.trim() !== '' || search.tags.length > 0;
  const result = outcome?.load === load ? outcome.result : null;
  const page = result?.ok ? result.value.page : null;
  const items = result?.ok ? appendPage(load.shown, result.value.items) : load.shown;
  const view = viewOf(result, load, items.length, searching);

  const start = (next: Search) => setLoad(firstPage(next));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    start({ query: draft, tags: search.tags });
  };
  const addTag = (tag: string) => {
    if (hasTag(search.tags, tag) || search.tags.length >= PAYLOAD_LIMITS.searchTags) return;
    start({ query: search.query, tags: [...search.tags, tag] });
  };
  const removeTag = (tag: string) =>
    start({ query: search.query, tags: search.tags.filter((existing) => existing !== tag) });
  const clear = () => {
    setDraft('');
    start(NO_SEARCH);
  };

  return (
    <>
      {/* Nothing to search in an empty library: the empty state says what to do instead. */}
      {view !== 'empty' && (
        <div className="library__search">
          <form
            role="search"
            aria-label="Search your library"
            onSubmit={onSubmit}
            className="library__search-form"
          >
            <div className="library__search-field">
              <label htmlFor={inputId} className="ui-visually-hidden">
                Search titles and tags
              </label>
              <Icon name="search" className="library__search-icon" />
              <input
                id={inputId}
                type="search"
                className="ui-input library__search-input"
                placeholder="Search titles and tags"
                value={draft}
                maxLength={PAYLOAD_LIMITS.searchQueryLength}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
            </div>
            <button type="submit" className="ui-button ui-button--secondary">
              Search
            </button>
          </form>

          {searching && (
            <div className="library__refine">
              {search.tags.length > 0 && (
                <div className="library__filters">
                  <p id={filtersId} className="library__filters-label">
                    Showing only scores tagged with all of:
                  </p>
                  <ul aria-labelledby={filtersId} className="ui-chip-list">
                    {search.tags.map((tag) => (
                      <li key={tag}>
                        <button
                          type="button"
                          className="ui-chip ui-chip--selected"
                          aria-label={`Remove tag filter ${tag}`}
                          onClick={() => removeTag(tag)}
                        >
                          {tag}{' '}
                          <span className="ui-chip__remove" aria-hidden="true">
                            ×
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm library__clear"
                onClick={clear}
              >
                Clear search
              </button>
            </div>
          )}
        </div>
      )}

      {/* One live region for every state; only its surroundings change. */}
      <div className={STATUS_CLASS[view]}>
        {(view === 'empty' || view === 'no-match') && (
          <span className="ui-state__icon" aria-hidden="true">
            <Icon name={view === 'empty' ? 'music' : 'search'} />
          </span>
        )}
        {view === 'empty' && <h2 className="ui-state__title">No saved scores yet</h2>}
        {(view === 'loading' || view === 'loading-more') && (
          <span className="ui-spinner ui-spinner--sm" aria-hidden="true" />
        )}
        <p
          role="status"
          className={
            view === 'no-match'
              ? 'ui-state__title'
              : view === 'empty'
                ? 'ui-state__text'
                : undefined
          }
        >
          {statusText(result, load, items.length, page?.total, searching)}
        </p>
        {view === 'no-match' && (
          <p className="ui-state__text">Try other words, or remove a tag filter.</p>
        )}
      </div>

      {result && !result.ok && (
        <ApiFailureAlert
          error={result.error}
          resource="library"
          onRetry={() => setLoad({ ...load })}
        />
      )}

      {view === 'loading' && (
        <div className="ui-card-grid" aria-hidden="true">
          {SKELETON_CARDS.map((key) => (
            <div key={key} className="ui-card library-card library-card--skeleton">
              <span className="ui-skeleton ui-skeleton--title" />
              <span className="ui-skeleton library-card__skeleton-chips" />
              <span className="ui-skeleton library-card__skeleton-meta" />
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <ul aria-label="Saved scores" className="ui-card-grid">
          {items.map((summary) => (
            <SummaryItem
              key={summary.scoreId}
              summary={summary}
              activeTags={search.tags}
              onTag={addTag}
            />
          ))}
        </ul>
      )}

      {page?.nextOffset != null && (
        <div className="library__more">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => setLoad({ search, offset: page.nextOffset ?? 0, shown: items })}
          >
            Show more
          </button>
        </div>
      )}
    </>
  );
}

function SummaryItem(props: {
  summary: ScoreSummary;
  activeTags: readonly string[];
  onTag: (tag: string) => void;
}): JSX.Element {
  const { summary, activeTags, onTag } = props;
  return (
    <li className="ui-card ui-card--interactive library-card">
      <h2 className="ui-card__title">
        <Link className="ui-card__link" to={`/scores/${encodeURIComponent(summary.scoreId)}`}>
          {summary.title}
        </Link>
      </h2>
      {summary.tags.length > 0 && (
        <ul aria-label="Tags" className="ui-chip-list">
          {summary.tags.map((tag) => {
            const active = hasTag(activeTags, tag);
            return (
              <li key={tag}>
                <button
                  type="button"
                  className={active ? 'ui-chip ui-chip--selected' : 'ui-chip'}
                  aria-label={`Filter by tag ${tag}`}
                  disabled={active}
                  onClick={() => onTag(tag)}
                >
                  {tag}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="ui-card__meta library-card__meta">
        Updated <time dateTime={summary.updatedAt}>{formatDate(summary.updatedAt)}</time>
      </p>
    </li>
  );
}

/** Items of the next page after those already shown; a score shown twice (list changed meanwhile) is kept once. */
function appendPage(
  shown: readonly ScoreSummary[],
  next: readonly ScoreSummary[],
): readonly ScoreSummary[] {
  if (shown.length === 0) return next;
  const seen = new Set(shown.map((summary) => summary.scoreId));
  return [...shown, ...next.filter((summary) => !seen.has(summary.scoreId))];
}

/** What the list area shows; the status line's text is statusText. */
type View = 'loading' | 'loading-more' | 'results' | 'empty' | 'no-match' | 'error';

function viewOf(
  result: ApiResult<ListScoresResponse> | null,
  load: Load,
  shownCount: number,
  searching: boolean,
): View {
  if (result === null) return load.offset === 0 ? 'loading' : 'loading-more';
  if (!result.ok) return 'error';
  if (shownCount > 0) return 'results';
  return searching ? 'no-match' : 'empty';
}

/** The status line is a small count above the results, or the heart of an empty state. */
const STATUS_CLASS: Readonly<Record<View, string>> = {
  loading: 'library__status',
  'loading-more': 'library__status',
  results: 'library__status',
  empty: 'library__status ui-state ui-state--bordered',
  'no-match': 'library__status ui-state ui-state--bordered',
  // Empty text: kept in the tree (the live region stays), out of the layout.
  error: 'ui-visually-hidden',
};

const SKELETON_CARDS = ['a', 'b', 'c'] as const;

function statusText(
  result: ApiResult<ListScoresResponse> | null,
  load: Load,
  shownCount: number,
  total: number | undefined,
  searching: boolean,
): string {
  if (result === null) return load.offset === 0 ? 'Loading your library…' : 'Loading more scores…';
  if (!result.ok) return '';
  if (shownCount === 0) {
    return searching
      ? 'No saved scores match your search.'
      : 'Your library is empty. In Claude, ask the AI to write a score, then ask it to save the score.';
  }
  const noun = total === 1 ? 'score' : 'scores';
  return `Showing ${shownCount} of ${total ?? shownCount} ${searching ? 'matching' : 'saved'} ${noun}.`;
}
