import { scoreIdSchema } from '@sheet-music/music-contracts';
import { ScorePlayer } from '@sheet-music/score-ui';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router';
import type { ApiResult, SavedScoreResponse, ScoresApi } from '../api/scoresApi';
import type { WebPlayer } from '../player/webPlayer';
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

  if (result === null) {
    return (
      <section aria-labelledby="score-title">
        <h1 id="score-title">Saved score</h1>
        <p role="status">Loading the score…</p>
      </section>
    );
  }

  if (!result.ok) {
    return (
      <section aria-labelledby="score-title">
        <h1 id="score-title">Saved score</h1>
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
    <section aria-labelledby="score-title">
      <p>
        <Link to="/library">Back to your library</Link>
      </p>
      <h1 id="score-title">{saved.title}</h1>
      {saved.tags.length > 0 && (
        <ul aria-label="Tags">
          {saved.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      <p>
        Saved <time dateTime={saved.createdAt}>{formatDate(saved.createdAt)}</time>, updated{' '}
        <time dateTime={saved.updatedAt}>{formatDate(saved.updatedAt)}</time>, revision{' '}
        {saved.revision}.
      </p>
      <p>
        Score ID: <code>{saved.scoreId}</code>
      </p>
      <p>
        To keep working on this score with the AI, give it this ID in a conversation. Its edits
        update this saved score.
      </p>
      <ScorePlayer artifact={saved} ports={player.ports} />
      <p>
        <Link to="/about">Piano sound credits</Link>
      </p>
    </section>
  );
}
