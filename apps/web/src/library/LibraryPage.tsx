import {
  PAYLOAD_LIMITS,
  type ListScoresResponse,
  type ScoreSummary,
} from '@sheet-music/music-contracts';
import { Button } from '@sheet-music/ui/components/button';
import { Card } from '@sheet-music/ui/components/card';
import { Chip } from '@sheet-music/ui/components/chip';
import { emptyMediaVariants, emptyVariants } from '@sheet-music/ui/components/empty';
import { Input } from '@sheet-music/ui/components/input';
import { Label } from '@sheet-music/ui/components/label';
import { Skeleton } from '@sheet-music/ui/components/skeleton';
import { Spinner } from '@sheet-music/ui/components/spinner';
import { cn } from '@sheet-music/ui/lib/utils';
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
    <section aria-labelledby="library-title">
      <div className="mb-6 flex flex-col gap-1">
        <h1 id="library-title">Your library</h1>
        {user?.email && <p className="text-muted-foreground">Signed in as {user.email}.</p>}
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
        <div className="mb-6 flex flex-col gap-3">
          <form
            role="search"
            aria-label="Search your library"
            onSubmit={onSubmit}
            className="flex flex-wrap items-center gap-2"
          >
            <div className="relative min-w-0 flex-[1_1_260px]">
              <Label htmlFor={inputId} className="sr-only">
                Search titles and tags
              </Label>
              <Icon
                name="search"
                className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id={inputId}
                type="search"
                className="pl-[38px]"
                placeholder="Search titles and tags"
                value={draft}
                maxLength={PAYLOAD_LIMITS.searchQueryLength}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
            </div>
            <Button type="submit">Search</Button>
          </form>

          {searching && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {search.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <p id={filtersId} className="text-sm text-muted-foreground">
                    Showing only scores tagged with all of:
                  </p>
                  <ul aria-labelledby={filtersId} className={CHIP_LIST}>
                    {search.tags.map((tag) => (
                      <li key={tag}>
                        <Chip asChild selected>
                          <button
                            type="button"
                            aria-label={`Remove tag filter ${tag}`}
                            onClick={() => removeTag(tag)}
                          >
                            {tag}{' '}
                            <span
                              className="text-[1.15em] leading-none opacity-80"
                              aria-hidden="true"
                            >
                              ×
                            </span>
                          </button>
                        </Chip>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear search
              </Button>
            </div>
          )}
        </div>
      )}

      {/* One live region for every state: the same element; only its surroundings change. */}
      <div className={STATUS_CLASS[view]}>
        {(view === 'empty' || view === 'no-match') && (
          <span className={cn(emptyMediaVariants({ variant: 'icon' }), 'mb-1')} aria-hidden="true">
            <Icon name={view === 'empty' ? 'music' : 'search'} />
          </span>
        )}
        {view === 'empty' && <h2 className={STATE_TITLE}>No saved scores yet</h2>}
        {(view === 'loading' || view === 'loading-more') && <Spinner size="sm" />}
        <p
          role="status"
          className={
            view === 'no-match' ? STATE_TITLE : view === 'empty' ? 'max-w-[46ch]' : undefined
          }
        >
          {statusText(result, load, items.length, page?.total, searching)}
        </p>
        {view === 'no-match' && (
          <p className="max-w-[46ch]">Try other words, or remove a tag filter.</p>
        )}
      </div>

      {result && !result.ok && (
        <ApiFailureAlert
          className="mb-4"
          error={result.error}
          resource="library"
          onRetry={() => setLoad({ ...load })}
        />
      )}

      {view === 'loading' && (
        <div className={CARD_GRID} aria-hidden="true">
          {SKELETON_CARDS.map((key) => (
            <Card key={key} className={cn(CARD_LAYOUT, 'shadow-none')}>
              <Skeleton className="h-[1.125rem] w-3/5" />
              <Skeleton className="h-[22px] w-[45%] rounded-full" />
              <Skeleton className="mt-auto h-[0.875rem] w-[35%]" />
            </Card>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <ul aria-label="Saved scores" className={CARD_GRID}>
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
        <div className="mt-6 flex justify-center">
          <Button onClick={() => setLoad({ search, offset: page.nextOffset ?? 0, shown: items })}>
            Show more
          </Button>
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
    // The whole card opens the score through its one real link, whose ::after
    // covers the card; the tag buttons sit above it and stay clickable. The
    // card shows the link's focus ring.
    <Card
      asChild
      className={cn(
        CARD_LAYOUT,
        'relative transition-[border-color,box-shadow] duration-120 ease-standard hover:border-border-control hover:shadow-md',
        'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring',
      )}
    >
      <li>
        <h2 className="text-md leading-tight font-semibold wrap-anywhere">
          <Link
            className="after:absolute after:inset-0 focus-visible:outline-none"
            to={`/scores/${encodeURIComponent(summary.scoreId)}`}
          >
            {summary.title}
          </Link>
        </h2>
        {summary.tags.length > 0 && (
          <ul aria-label="Tags" className={CHIP_LIST}>
            {summary.tags.map((tag) => {
              const active = hasTag(activeTags, tag);
              return (
                <li key={tag}>
                  <Chip
                    asChild
                    selected={active}
                    // A tag already used as a filter reads as selected, not as broken.
                    className="z-10 disabled:opacity-100"
                  >
                    <button
                      type="button"
                      aria-label={`Filter by tag ${tag}`}
                      disabled={active}
                      onClick={() => onTag(tag)}
                    >
                      {tag}
                    </button>
                  </Chip>
                </li>
              );
            })}
          </ul>
        )}
        {/* Dates line up at the bottom of each row of cards. */}
        <p className="mt-auto text-sm text-muted-foreground tabular-nums">
          Updated <time dateTime={summary.updatedAt}>{formatDate(summary.updatedAt)}</time>
        </p>
      </li>
    </Card>
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

/** A small count or "Loading…" above the results. */
const STATUS_LINE = 'mb-4 flex items-center gap-2 text-sm text-muted-foreground tabular-nums';

/** The heart of the empty and no-match states: the bordered Empty look. */
const STATUS_STATE = cn(emptyVariants({ variant: 'bordered' }), 'gap-2 text-[0.875rem]');

/** The status line is a small count above the results, or the heart of an empty state. */
const STATUS_CLASS: Readonly<Record<View, string>> = {
  loading: STATUS_LINE,
  'loading-more': STATUS_LINE,
  results: STATUS_LINE,
  empty: STATUS_STATE,
  'no-match': STATUS_STATE,
  // Empty text: kept in the tree (the live region stays), out of the layout.
  error: 'sr-only',
};

const STATE_TITLE = 'text-md font-semibold text-foreground';

/** Responsive list of cards: one column on phones, more when wide. */
const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4';

const CARD_LAYOUT = 'flex flex-col gap-3 sm:p-5';

/** Tag chips: 6 px apart, 8 px on phones where button chips grow to a 40 px target. */
const CHIP_LIST = 'flex flex-wrap gap-1.5 max-sm:gap-2';

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
