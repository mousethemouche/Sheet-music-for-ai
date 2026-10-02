/**
 * Neutral layout of one rendering (ADR-004, RENDER_PLAYBACK_PORTS.md §2.5).
 *
 * Coordinates are CSS pixels of the surface as displayed, measured from its
 * top-left corner, which the renderer places at the top-left of the target
 * element. They are ephemeral: valid until the next render, update or resize
 * of the same renderer resolves, and never persisted (ADR-001).
 */

/** An axis-aligned rectangle. Every number is finite; width and height are >= 0. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One written note (a NoteEvent or one chord member) as engraved. */
export interface NoteLayout {
  readonly noteId: string;
  readonly systemId: string;
  readonly staffId: string;
  /** Bar ID, shared by the aligned measures of both staves. */
  readonly measureId: string;
  /** The notehead only: no stem, flag, dot, accidental or label. */
  readonly bounds: Bounds;
}

/** One staff of one system, from its top line to its bottom line. */
export interface StaffLayout {
  readonly staffId: string;
  readonly bounds: Bounds;
}

/** One line of music; for a grand staff both staves belong to the same system. */
export interface SystemLayout {
  /** `system-<index>`: unique within one LayoutMap, not a domain ID, not stable across renders. */
  readonly systemId: string;
  /** 0-based, top to bottom. */
  readonly index: number;
  /** Bars engraved on this system, in score order. */
  readonly measureIds: readonly string[];
  /** Staves in ScoreSpec order (right hand first). */
  readonly staves: readonly StaffLayout[];
  /** Everything the renderer drew for this system (notes, ledger lines, labels, dynamics), band excluded. */
  readonly bounds: Bounds;
  /**
   * Empty rectangle directly above `bounds` (band.y + band.height === bounds.y)
   * and as wide as the staves, reserved for overlay text. Its height is
   * RenderOptions.annotationBandHeight when the system holds a note targeted by
   * an annotation, otherwise 0. The renderer draws nothing inside it.
   */
  readonly annotationBand: Bounds;
}

export interface LayoutMap {
  /** Surface width in CSS px; may exceed the requested width (adapter minimum); 0 when hidden. */
  readonly width: number;
  readonly height: number;
  /** Top to bottom. Empty when hidden (width 0). */
  readonly systems: readonly SystemLayout[];
  /**
   * Exactly one entry per written note of the rendered score (rests excluded),
   * keyed by note ID. A Map, not a plain object: IDs such as `constructor` are
   * valid ScoreSpec IDs. Empty when hidden (width 0).
   */
  readonly notes: ReadonlyMap<string, NoteLayout>;
}
