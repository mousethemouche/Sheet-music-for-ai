import {
  PAYLOAD_LIMITS,
  type ListScoresResponse,
  type ScoreSummary,
} from '@sheet-music/music-contracts';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { Link } from 'react-router';
import type { ApiResult, ScoresApi } from '../api/scoresApi';
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
    <section aria-labelledby="library-title">
      <h1 id="library-title">Your library</h1>
      {user?.email && <p>Signed in as {user.email}.</p>}
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
      <form role="search" aria-label="Search your library" onSubmit={onSubmit}>
        <label htmlFor={inputId}>Search titles and tags</label>{' '}
        <input
          id={inputId}
          type="search"
          value={draft}
          maxLength={PAYLOAD_LIMITS.searchQueryLength}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />{' '}
        <button type="submit">Search</button>{' '}
        {searching && (
          <button type="button" onClick={clear}>
            Clear search
          </button>
        )}
      </form>

      {search.tags.length > 0 && (
        <div>
          <p id={filtersId}>Showing only scores tagged with all of:</p>
          <ul aria-labelledby={filtersId}>
            {search.tags.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  aria-label={`Remove tag filter ${tag}`}
                  onClick={() => removeTag(tag)}
                >
                  {tag} ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p role="status">{statusText(result, load, items.length, page?.total, searching)}</p>

      {result && !result.ok && (
        <ApiFailureAlert
          error={result.error}
          resource="library"
          onRetry={() => setLoad({ ...load })}
        />
      )}

      {items.length > 0 && (
        <ul aria-label="Saved scores">
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
        <button
          type="button"
          onClick={() => setLoad({ search, offset: page.nextOffset ?? 0, shown: items })}
        >
          Show more
        </button>
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
    <li>
      <h2>
        <Link to={`/scores/${encodeURIComponent(summary.scoreId)}`}>{summary.title}</Link>
      </h2>
      <p>
        Updated <time dateTime={summary.updatedAt}>{formatDate(summary.updatedAt)}</time>
      </p>
      {summary.tags.length > 0 && (
        <ul aria-label="Tags">
          {summary.tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                aria-label={`Filter by tag ${tag}`}
                disabled={hasTag(activeTags, tag)}
                onClick={() => onTag(tag)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
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
      : 'Your library is empty. Scores you save from a conversation appear here.';
  }
  const noun = total === 1 ? 'score' : 'scores';
  return `Showing ${shownCount} of ${total ?? shownCount} ${searching ? 'matching' : 'saved'} ${noun}.`;
}
