import { type ComponentType, type JSX, useSyncExternalStore } from 'react';
import type { ScoreMountProps } from './score-mount';
import type { ViewNotice, ViewStore } from './view-state';

export interface ScoreViewProps {
  readonly store: ViewStore;
  /** What renders an accepted score: the ScorePlayer slot (see score-mount.ts). */
  readonly ScoreMount: ComponentType<ScoreMountProps>;
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

/**
 * The View shell. Test hooks (docs/architecture/MCP_VIEW.md §6): `score-view`
 * with `data-connection`, `view-notice` with `data-notice-kind` (and
 * `data-error-code` for a rejected call), and `score-mount` with
 * `data-score-id`, `data-revision` and `data-theme`.
 */
export function ScoreView({ store, ScoreMount }: ScoreViewProps): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { artifact, notice, connection, theme } = state;
  return (
    <main data-testid="score-view" data-connection={connection}>
      {notice === null ? null : (
        <p
          role="alert"
          data-testid="view-notice"
          data-notice-kind={notice.kind}
          data-error-code={notice.kind === 'rejected' ? notice.code : undefined}
        >
          {noticeText(notice, artifact !== null)}
        </p>
      )}
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
          data-theme={theme}
        >
          <ScoreMount key={artifact.scoreId} artifact={artifact} theme={theme} />
        </section>
      )}
    </main>
  );
}
