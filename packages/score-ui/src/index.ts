/**
 * @sheet-music/score-ui
 *
 * React score/player components shared by the web app and the MCP View. Depends on
 * renderer/playback ports only; concrete adapters are injected by the apps (ADR-004).
 *
 * Built from @sheet-music/ui and Tailwind classes; it ships no stylesheet of
 * its own. A host compiles Tailwind CSS v4, imports
 * `@sheet-music/ui/styles/theme.css` and adds `@source` for this package's
 * `src` (docs/architecture/DESIGN_SYSTEM.md §4).
 */
export { ScorePlayer } from './score-player';
export type {
  ScorePlayerArtifact,
  ScorePlayerControlsPosition,
  ScorePlayerPorts,
  ScorePlayerProps,
  ScorePlayerTheme,
} from './types';
