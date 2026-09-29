/**
 * Renderer port (ADR-004, RENDER_PLAYBACK_PORTS.md §2). An adapter package
 * (renderer-vexflow, #5) implements it; score-ui (#7) consumes it through a
 * ScoreRendererFactory that the app injects. No engraving-library type
 * appears here.
 */
import type { ScoreSpec } from '@sheet-music/music-domain';
import type { LayoutMap } from './layout';

export interface RenderResult {
  /** Plain data only; never carries library objects. */
  readonly layoutMap: LayoutMap;
}

/**
 * Colors the renderer applies itself. Each is a CSS color usable as an SVG
 * fill or stroke. Teaching colors come from `score.annotations` and are drawn
 * exactly as stored in both light and dark themes.
 */
export interface RenderTheme {
  /** Staff lines, glyphs and every label or note without a teaching color. */
  readonly ink: string;
  /** Notes in the current playback highlight set. */
  readonly playbackHighlight: string;
}

export interface RenderOptions {
  /** Available width in CSS px: finite and >= 0; 0 means the target is hidden (§2.4). */
  readonly width: number;
  readonly theme: RenderTheme;
  /**
   * CSS px reserved above each system that holds an annotated note
   * (SystemLayout.annotationBand), for the overlay's annotation text. Finite and >= 0.
   */
  readonly annotationBandHeight: number;
}

/**
 * One renderer instance draws one score into one target, from render() to
 * destroy(). Calls are applied in call order and each promise settles with
 * the outcome of its own call. Every rejection is a RenderError; a rejected
 * call leaves the target showing the last successful rendering (empty if
 * none) and the renderer usable.
 */
export interface ScoreRenderer {
  /** Mounts into `target` (the renderer owns its children until destroy) and engraves `score`. */
  render(score: ScoreSpec, target: HTMLElement, options: RenderOptions): Promise<RenderResult>;
  /** Re-engraves a new score or revision; omitted options keep the previous ones. */
  update(score: ScoreSpec, options?: RenderOptions): Promise<RenderResult>;
  /** Re-engraves the current score at a new width (the other options are kept). */
  resize(width: number): Promise<RenderResult>;
  /**
   * Replaces the whole playback highlight set (an empty array clears it).
   * Synchronous, never changes layout, ignores unknown IDs. A note leaving the
   * set gets back exactly its engraved color: its teaching color or theme ink.
   */
  setPlaybackHighlight(noteIds: readonly string[]): void;
  /** Removes everything the renderer added to the target. Idempotent. */
  destroy(): void;
}

/** Injected by the app: returns a fresh, unmounted renderer (one per mount). */
export type ScoreRendererFactory = () => ScoreRenderer;
