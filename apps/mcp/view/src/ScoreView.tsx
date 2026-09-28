import { type ComponentType, type JSX, useSyncExternalStore } from 'react';
import type { ScoreMountProps } from './score-mount';
import { ScoreSummary } from './ScoreSummary';
import type { ViewNotice, ViewStore } from './view-state';

export interface ScoreViewProps {
  readonly store: ViewStore;
  /** What renders an accepted score: the ScorePlayer slot (see score-mount.ts). */
  readonly ScoreMount?: ComponentType<ScoreMountProps>;
}

function noticeText(notice: ViewNotice, hasScore: boolean): string {
  const unchanged = hasScore ? ' The score shown is unchanged.' : '';
  switch (notice.kind) {
    case 'rejected':
      return `The request was rejected (${notice.code}): ${notice.message}${unchanged}`;
    case 'unreadable':
      return `The host sent a result this view cannot display.${unchanged}`;
    case 'cancelled':
      return `The request was cancelled.${unchanged}`;
  }
}

export function ScoreView({ store, ScoreMount = ScoreSummary }: ScoreViewProps): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { artifact, notice, connection } = state;
  return (
    <main>
      {notice === null ? null : <p role="alert">{noticeText(notice, artifact !== null)}</p>}
      {connection === 'failed' ? (
        <p role="alert">This view could not connect to its host.</p>
      ) : null}
      {artifact === null ? (
        connection === 'closed' || notice !== null ? null : (
          <p role="status">Waiting for the score…</p>
        )
      ) : (
        <section
          data-testid="score-mount"
          data-score-id={artifact.scoreId}
          data-revision={artifact.revision}
        >
          <ScoreMount key={artifact.scoreId} artifact={artifact} />
        </section>
      )}
    </main>
  );
}
