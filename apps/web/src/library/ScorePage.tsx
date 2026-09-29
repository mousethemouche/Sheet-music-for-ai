import { scoreIdSchema } from '@sheet-music/music-contracts';
import { ScorePlayer } from '@sheet-music/score-ui';
import { Card } from '@sheet-music/ui/components/card';
import { Chip } from '@sheet-music/ui/components/chip';
import { Spinner } from '@sheet-music/ui/components/spinner';
import { cn } from '@sheet-music/ui/lib/utils';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router';
import type { ApiResult, SavedScoreResponse, ScoresApi } from '../api/scoresApi';
import type { WebPlayer } from '../player/webPlayer';
import { CODE, STANDALONE_LINK } from '../shell/classes';
import { usePrefersDark } from '../shell/usePrefersDark';
import { ApiFailureAlert } from './ApiFailureAlert';
import { formatDate } from './format';
import { usePrivateCleanup, useSignedInUser } from './privateState';

/**
 * One saved score (#15, US-F3): its canonical content from GET /scores/:id in
 * the shared ScorePlayer, its library metadata and its stable ID, which the
 * user gives the AI to continue working on it. Opening a score reads only:
 * nothing is saved, and the player never autoplays.
 */
export function ScorePage(props: { scores: ScoresApi; player: WebPlayer }): JSX.Element | null {
  const { scoreId = '' } = useParams();
  const user = useSignedInUser();
  if (!user) return null;
  return (
    <SavedScoreView
      key={`${user.id}\n${scoreId}`}
      scoreId={scoreId}
      scores={props.scores}
      player={props.player}
    />
  );
}

interface Outcome {
  readonly attempt: number;
  readonly result: ApiResult<SavedScoreResponse>;
}

/** An ID that cannot exist is answered like a missing score, without a request. */
const NOT_FOUND: ApiResult<SavedScoreResponse> = {
  ok: false,
  error: { kind: 'not-found', status: null, code: null, correlationId: null },
};

function SavedScoreView(props: {
  scoreId: string;
  scores: ScoresApi;
  player: WebPlayer;
}): JSX.Element {
  const { scoreId, scores, player } = props;
  const validId = scoreIdSchema.safeParse(scoreId).success;
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    inFlight.current = controller;
    let current = true;
    void scores.getSavedScore(scoreId, controller.signal).then((result) => {
      if (current) setOutcome({ attempt, result });
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [scores, scoreId, validId, attempt]);

  // Sign-out or account switch: silence this account's score at once (the
  // player itself is destroyed when the page unmounts) and stop fetching.
  usePrivateCleanup(
    useCallback(() => {
      player.stopAudio();
      inFlight.current?.abort();
    }, [player]),
  );

  const result = !validId ? NOT_FOUND : outcome?.attempt === attempt ? outcome.result : null;
  // The notation paper and ink follow the same scheme as the page (DESIGN_SYSTEM.md §5).
  const theme = usePrefersDark() ? 'dark' : 'light';

  if (result === null) {
    return (
      <section aria-labelledby="score-title" className={PAGE}>
        <BackToLibrary />
        <div className={HEADER}>
          <h1 id="score-title">Saved score</h1>
        </div>
        <Card className="flex min-h-60 flex-col items-center justify-center gap-3 text-[0.875rem] text-muted-foreground shadow-none">
          <Spinner />
          <p role="status">Loading the score…</p>
        </Card>
      </section>
    );
  }

  if (!result.ok) {
    return (
      <section aria-labelledby="score-title" className={PAGE}>
        {/* A missing score's state offers the way back itself: one link, not two. */}
        {result.error.kind !== 'not-found' && <BackToLibrary />}
        <div className={HEADER}>
          <h1 id="score-title">Saved score</h1>
        </div>
        <ApiFailureAlert
          error={result.error}
          resource="score"
          onRetry={() => setAttempt((count) => count + 1)}
        />
      </section>
    );
  }

  const saved = result.value;
  return (
    <section aria-labelledby="score-title" className={PAGE}>
      <BackToLibrary />
      <div className={HEADER}>
        <h1 id="score-title">{saved.title}</h1>
        {saved.tags.length > 0 && (
          <ul aria-label="Tags" className="mt-1 flex flex-wrap gap-1.5 max-sm:gap-2">
            {saved.tags.map((tag) => (
              <Chip asChild key={tag}>
                <li>{tag}</li>
              </Chip>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground tabular-nums">
          Saved <time dateTime={saved.createdAt}>{formatDate(saved.createdAt)}</time>, updated{' '}
          <time dateTime={saved.updatedAt}>{formatDate(saved.updatedAt)}</time>, revision{' '}
          {saved.revision}.
        </p>
      </div>
      {/* No card around it: the notation paper and the controls bar are the only frames. */}
      <div className="min-w-0">
        <ScorePlayer artifact={saved} ports={player.ports} theme={theme} />
      </div>
      {/* The score ID: a quiet row under a rule, not a second card. */}
      <div className="flex flex-col gap-1 border-t pt-4">
        <p className="text-[0.875rem] font-medium text-muted-foreground">
          Score ID:{' '}
          <code
            // One box that wraps inside itself on phones (never two half-chips).
            className={cn(CODE, 'inline-block max-w-full align-top font-normal text-foreground')}
          >
            {saved.scoreId}
          </code>
        </p>
        <p className="text-sm text-muted-foreground">
          To keep working on this score with the AI, give it this ID in a conversation. Its edits
          update this saved score.
        </p>
      </div>
      <p className="text-sm">
        <Link className={STANDALONE_LINK} to="/about">
          Piano sound credits
        </Link>
      </p>
    </section>
  );
}

const PAGE = 'flex min-w-0 flex-col gap-6';

const HEADER = 'flex flex-col items-start gap-2 [&>h1]:wrap-anywhere';

function BackToLibrary(): JSX.Element {
  return (
    <p>
      <Link
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground max-sm:-my-2.5 max-sm:min-h-10"
        to="/library"
      >
        <span aria-hidden="true">←</span>
        Back to your library
      </Link>
    </p>
  );
}
