/**
 * @sheet-music/renderer-core
 *
 * Renderer port and neutral RenderResult/LayoutMap keyed by domain IDs
 * (ADR-004). Contract: docs/architecture/RENDER_PLAYBACK_PORTS.md.
 */
export type { Bounds, LayoutMap, NoteLayout, StaffLayout, SystemLayout } from './layout';
export type {
  RenderOptions,
  RenderResult,
  RenderTheme,
  ScoreRenderer,
  ScoreRendererFactory,
} from './renderer';
export { RenderError, type RenderErrorCode } from './errors';
