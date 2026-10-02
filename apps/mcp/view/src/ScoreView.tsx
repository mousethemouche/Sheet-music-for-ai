import { Alert, AlertDescription } from '@sheet-music/ui/components/alert';
import { Spinner } from '@sheet-music/ui/components/spinner';
import { cn } from '@sheet-music/ui/lib/utils';
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

/**
 * The View's notices are the compact Alert of an embedded card: 10 x 12 px
 * padding, 8 px gap, 1.45 line height, long words wrapped anywhere.
 */
const NOTICE_CLASS = 'gap-2 px-3 py-2.5 leading-[1.45] wrap-anywhere';

/** Decorative (the notice's text says it all): a circled "!" or, for information, "i". */
function AlertIcon({ info = false }: { readonly info?: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
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
 * (Tailwind, with the @sheet-music/ui tokens). The shell carries the theme
 * class of the store's theme, the one the player gets, so the shell's tokens
 * and the player always agree; `sv` scopes the host-text colors (view.css).
 */
export function ScoreView({ store, ScoreMount }: ScoreViewProps): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { artifact, notice, connection, theme } = state;
  return (
    <main
      data-testid="score-view"
      data-connection={connection}
      className={cn(
        'sv',
        theme,
        'flex min-w-0 flex-col gap-3 font-sans text-base text-(--sv-on-host-text) antialiased [&>*]:min-w-0',
      )}
    >
      {notice === null ? null : (
        <Alert
          role="alert"
          // A cancellation is information, not an error: the neutral tone.
          variant={notice.kind === 'cancelled' ? 'default' : 'error'}
          className={cn(
            NOTICE_CLASS,
            notice.kind === 'cancelled' && '[&>svg]:text-muted-foreground',
          )}
          data-testid="view-notice"
          data-notice-kind={notice.kind}
          data-error-code={notice.kind === 'rejected' ? notice.code : undefined}
        >
          <AlertIcon info={notice.kind === 'cancelled'} />
          <AlertDescription className="gap-1">
            <p>{noticeText(notice, artifact !== null)}</p>
            {notice.kind === 'rejected' && notice.details.length > 0 ? (
              // The first details of a rejected call (the envelope's), smaller.
              <ul aria-label="Details" className="list-disc pl-[1.1em] text-sm">
                {notice.details.map((detail, index) => (
                  <li key={`${index}:${detail}`}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      )}
      {connection === 'failed' ? (
        <Alert role="alert" variant="error" className={NOTICE_CLASS}>
          <AlertIcon />
          <span>This view could not connect to its host.</span>
        </Alert>
      ) : null}
      {artifact === null ? (
        // Nothing to wait for once the host is gone, unreachable or answered with a notice.
        connection === 'closed' || connection === 'failed' || notice !== null ? null : (
          <p
            role="status"
            className="flex min-h-24 items-center justify-center gap-2 rounded-xl border bg-muted p-4 text-center text-sm text-muted-foreground"
          >
            <Spinner size="sm" />
            Waiting for the score…
          </p>
        )
      ) : (
        // Block flow: nothing here may narrow the player (the notation takes
        // the root's full content width).
        <section
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
