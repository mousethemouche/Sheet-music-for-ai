import { scoreIdSchema } from '@sheet-music/music-contracts';
import { ScorePlayer } from '@sheet-music/score-ui';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router';
import type { ApiResult, SavedScoreResponse, ScoresApi } from '../api/scoresApi';
import type { WebPlayer } from '../player/webPlayer';
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
      <section aria-labelledby="score-title" className="score-page">
        <BackToLibrary />
        <div className="score-page__header">
          <h1 id="score-title">Saved score</h1>
        </div>
        <div className="ui-card ui-card--flat score-page__loading">
          <span className="ui-spinner" aria-hidden="true" />
          <p role="status">Loading the score…</p>
        </div>
      </section>
    );
  }

  if (!result.ok) {
    return (
      <section aria-labelledby="score-title" className="score-page">
        {/* A missing score's state offers the way back itself: one link, not two. */}
        {result.error.kind !== 'not-found' && <BackToLibrary />}
        <div className="score-page__header">
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
    <section aria-labelledby="score-title" className="score-page">
      <BackToLibrary />
      <div className="score-page__header">
        <h1 id="score-title">{saved.title}</h1>
        {saved.tags.length > 0 && (
          <ul aria-label="Tags" className="ui-chip-list">
            {saved.tags.map((tag) => (
              <li key={tag} className="ui-chip">
                {tag}
              </li>
            ))}
          </ul>
        )}
        <p className="ui-meta">
          Saved <time dateTime={saved.createdAt}>{formatDate(saved.createdAt)}</time>, updated{' '}
          <time dateTime={saved.updatedAt}>{formatDate(saved.updatedAt)}</time>, revision{' '}
          {saved.revision}.
        </p>
      </div>
      {/* No card around it: the notation paper and the controls bar are the only frames. */}
      <div className="score-page__player">
        <ScorePlayer artifact={saved} ports={player.ports} theme={theme} />
      </div>
      <div className="score-page__id">
        <p className="score-page__id-value">
          Score ID: <code className="score-page__id-code">{saved.scoreId}</code>
        </p>
        <p className="ui-small ui-muted">
          To keep working on this score with the AI, give it this ID in a conversation. Its edits
          update this saved score.
        </p>
      </div>
      <p className="ui-small">
        <Link className="ui-link" to="/about">
          Piano sound credits
        </Link>
      </p>
    </section>
  );
}

function BackToLibrary(): JSX.Element {
  return (
    <p>
      <Link className="ui-back-link" to="/library">
        <span aria-hidden="true">←</span>
        Back to your library
      </Link>
    </p>
  );
}
