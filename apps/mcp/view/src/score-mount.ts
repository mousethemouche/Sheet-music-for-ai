import type { ScoreArtifact } from '@sheet-music/music-contracts';
import type { ViewTheme } from './view-state';

/**
 * Props of the component the View mounts for an accepted score: the slot
 * where the shared ScorePlayer (packages/score-ui, #7) plugs in (`PlayerMount`
 * in main.tsx). The View only mounts it with an artifact that passed
 * parseToolResult, and keeps the same instance (keyed by score ID) across
 * newer revisions so the player applies P-01: stop the old audio, load the
 * new plan at tick 0 and stay paused.
 */
export interface ScoreMountProps {
  /** Validated artifact; `score` is the canonical ScoreSpec. */
  readonly artifact: ScoreArtifact;
  /** Host color scheme (host context `theme`). */
  readonly theme: ViewTheme;
}
