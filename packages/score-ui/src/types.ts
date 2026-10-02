/**
 * Public types of the ScorePlayer (#7). The concrete renderer and synthesizer
 * are never imported here: the app injects them as ports (ADR-004,
 * RENDER_PLAYBACK_PORTS.md).
 */
import type {
  ActiveNoteIdsQuery,
  PlaybackCompiler,
  PlaybackEngineFactory,
} from '@sheet-music/playback-core';
import type { ScoreRendererFactory } from '@sheet-music/renderer-core';

/** Host color scheme. Teaching colors are drawn as stored in both. */
export type ScorePlayerTheme = 'light' | 'dark';

/**
 * Where the playback controls (with the status line and problems) sit:
 * under the notation (`bottom`, the default) or above it (`top`, for a host
 * whose frame grows with its content, so Play is never below the fold).
 */
export type ScorePlayerControlsPosition = 'top' | 'bottom';

/**
 * The score result the player displays: structurally compatible with the
 * `ScoreArtifact` of `@sheet-music/music-contracts` (draft or saved), so an
 * app passes the tool or HTTP result as is. `score` is untrusted: the player
 * validates it with `validateScoreSpec` and checks that its `id` and
 * `revision` equal `scoreId` and `revision` before showing it.
 */
export interface ScorePlayerArtifact {
  readonly scoreId: string;
  readonly revision: number;
  readonly score: unknown;
}

/**
 * Everything the player needs from the outside world. Keep the object's
 * functions stable (module level or memoized): changing a factory destroys the
 * current renderer and engine and creates new ones.
 */
export interface ScorePlayerPorts {
  /** One fresh renderer per mounted player (fonts bound by the app). */
  readonly createRenderer: ScoreRendererFactory;
  /** One fresh engine per mounted player (assets bound by the app). */
  readonly createPlaybackEngine: PlaybackEngineFactory;
  /** `compilePlaybackPlan` of `@sheet-music/playback-core` (#6). */
  readonly compilePlaybackPlan: PlaybackCompiler;
  /** `activeNoteIds` of `@sheet-music/playback-core` (#6). */
  readonly activeNoteIds: ActiveNoteIdsQuery;
}

export interface ScorePlayerProps {
  /**
   * Latest score result from the host. A newer revision of the same score
   * replaces the displayed one (P-01); so does another score ID (the host
   * switched scores, possibly back to one shown earlier), unless it is
   * older than a revision of that score the player already accepted. An
   * invalid, duplicate or older one never does.
   */
  readonly artifact: ScorePlayerArtifact;
  readonly ports: ScorePlayerPorts;
  /** Defaults to `light`. */
  readonly theme?: ScorePlayerTheme;
  /** Defaults to `bottom`. */
  readonly controlsPosition?: ScorePlayerControlsPosition;
}
