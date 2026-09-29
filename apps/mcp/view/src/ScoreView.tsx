import { type ComponentType, type JSX, useSyncExternalStore } from 'react';
import type { ScoreMountProps } from './score-mount';
import { ScoreHeader } from './ScoreHeader';
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
      // The code stays out of the text (it is the notice's data-error-code).
      return `The request was rejected: ${notice.message}${unchanged}`;
    case 'unreadable':
      return `The host sent a result this view cannot display.${unchanged}`;
    case 'cancelled':
      return `The request was cancelled.${unchanged}`;
  }
}

/** Decorative (the notice's text says it all): a circled "!" or, for information, "i". */
function AlertIcon({ info = false }: { readonly info?: boolean }): JSX.Element {
  return (
    <svg className="sv-alert__icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      {info ? <path d="M8 7.25v3.75M8 5h.01" /> : <path d="M8 4.75v3.75M8 11h.01" />}
    </svg>
  );
}

/**
 * The View shell. Test hooks (docs/architecture/MCP_VIEW.md §6): `score-view`
 * with `data-connection`, `view-notice` with `data-notice-kind` (and
 * `data-error-code` for a rejected call), and `score-mount` with
 * `data-score-id`, `data-revision` and `data-theme`. Classes are styling only
 * (view.css); `sv--dark` follows the same theme as the player.
 */
export function ScoreView({ store, ScoreMount }: ScoreViewProps): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { artifact, notice, connection, theme } = state;
  return (
    <main
      data-testid="score-view"
      data-connection={connection}
      className={theme === 'dark' ? 'sv sv--dark' : 'sv'}
    >
      {notice === null ? null : (
        <div
          role="alert"
          className="sv-alert"
          data-testid="view-notice"
          data-notice-kind={notice.kind}
          data-error-code={notice.kind === 'rejected' ? notice.code : undefined}
        >
          <AlertIcon info={notice.kind === 'cancelled'} />
          <div className="sv-alert__body">
            <p>{noticeText(notice, artifact !== null)}</p>
            {notice.kind === 'rejected' && notice.details.length > 0 ? (
              <ul aria-label="Details" className="sv-alert__details">
                {notice.details.map((detail, index) => (
                  <li key={`${index}:${detail}`}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}
      {connection === 'failed' ? (
        <p role="alert" className="sv-alert">
          <AlertIcon />
          <span>This view could not connect to its host.</span>
        </p>
      ) : null}
      {artifact === null ? (
        // Nothing to wait for once the host is gone, unreachable or answered with a notice.
        connection === 'closed' || connection === 'failed' || notice !== null ? null : (
          <p role="status" className="sv-waiting">
            <span aria-hidden="true" className="sv-spinner" />
            Waiting for the score…
          </p>
        )
      ) : (
        <section
          className="sv-score"
          data-testid="score-mount"
          data-score-id={artifact.scoreId}
          data-revision={artifact.revision}
          data-theme={theme}
        >
          <ScoreHeader artifact={artifact} />
          <ScoreMount key={artifact.scoreId} artifact={artifact} theme={theme} />
        </section>
      )}
    </main>
  );
}
