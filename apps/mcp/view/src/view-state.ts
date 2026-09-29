/**
 * State of the View shell: the last valid score artifact and a recoverable
 * notice. Pure reducer plus a tiny external store, so bridge events can be
 * recorded before React subscribes.
 *
 * Acceptance rules for a parsed score artifact:
 * - the first valid artifact is shown, and the View stays bound to its score ID;
 * - the same ID at a higher revision replaces it (the player applies P-01);
 * - the same or a lower revision of that ID (duplicate or stale) is ignored;
 * - another score ID is ignored (one View shows one score).
 * A tool error, an unreadable result or a cancellation keeps the last valid
 * artifact and only sets a notice. The theme follows the host's (light until
 * the host or the system says otherwise).
 */
import type { ScoreArtifact } from '@sheet-music/music-contracts';
import { parseToolResult } from './tool-result';

export type ViewNotice =
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly message: string;
      /** Messages of the envelope's first details (at most MAX_NOTICE_DETAILS). */
      readonly details: readonly string[];
    }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'cancelled' };

export type ViewTheme = 'light' | 'dark';

export interface ViewState {
  readonly connection: 'connecting' | 'connected' | 'failed' | 'closed';
  readonly artifact: ScoreArtifact | null;
  readonly notice: ViewNotice | null;
  /** Color scheme the player draws with (host context `theme`). */
  readonly theme: ViewTheme;
}

export type ViewEvent =
  | { readonly type: 'connected' }
  | { readonly type: 'connection-failed' }
  | { readonly type: 'tool-result'; readonly result: unknown }
  | { readonly type: 'tool-cancelled' }
  | { readonly type: 'host-theme'; readonly theme: ViewTheme }
  | { readonly type: 'teardown' };

export const INITIAL_VIEW_STATE: ViewState = {
  connection: 'connecting',
  artifact: null,
  notice: null,
  theme: 'light',
};

const UNREADABLE_ERROR = {
  code: 'UNKNOWN',
  message: 'The request failed and the host sent no readable error.',
  details: undefined,
};

/** How many of a rejection's details the notice lists. */
export const MAX_NOTICE_DETAILS = 3;

function acceptsArtifact(current: ScoreArtifact | null, next: ScoreArtifact): boolean {
  return current === null || (next.scoreId === current.scoreId && next.revision > current.revision);
}

function onToolResult(state: ViewState, result: unknown): ViewState {
  const parsed = parseToolResult(result);
  switch (parsed.kind) {
    case 'artifact':
      return acceptsArtifact(state.artifact, parsed.artifact)
        ? { ...state, artifact: parsed.artifact, notice: null }
        : state;
    case 'tool-error': {
      const { code, message, details } = parsed.error ?? UNREADABLE_ERROR;
      const shown = (details ?? []).slice(0, MAX_NOTICE_DETAILS).map((detail) => detail.message);
      return { ...state, notice: { kind: 'rejected', code, message, details: shown } };
    }
    case 'invalid':
      return { ...state, notice: { kind: 'unreadable' } };
  }
}

export function reduceViewState(state: ViewState, event: ViewEvent): ViewState {
  switch (event.type) {
    case 'connected':
      return { ...state, connection: 'connected' };
    case 'connection-failed':
      return { ...state, connection: 'failed' };
    case 'tool-result':
      return onToolResult(state, event.result);
    case 'tool-cancelled':
      return { ...state, notice: { kind: 'cancelled' } };
    case 'host-theme':
      return event.theme === state.theme ? state : { ...state, theme: event.theme };
    case 'teardown':
      return { ...state, connection: 'closed', artifact: null, notice: null };
  }
}

/** Function properties (not methods): React calls getState/subscribe detached. */
export interface ViewStore {
  readonly getState: () => ViewState;
  readonly dispatch: (event: ViewEvent) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createViewStore(initial: ViewState = INITIAL_VIEW_STATE): ViewStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: (event) => {
      const next = reduceViewState(state, event);
      if (next !== state) {
        state = next;
        for (const listener of [...listeners]) {
          listener();
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
