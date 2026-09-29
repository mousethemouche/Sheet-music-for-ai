/**
 * Where the playback band goes (DESIGN_SYSTEM.md §4): a soft rectangle
 * behind the notes that are sounding, so the current position reads without
 * relying on the notehead's hue alone (teaching colors may be close to the
 * accent). Pure: from the highlighted note IDs and the LayoutMap of the
 * displayed rendering to one rectangle per system.
 *
 * Each rectangle spans the sounding notes horizontally and the system's
 * staves vertically (extended to the notes on ledger lines), with a small
 * margin, clamped to the surface. Unknown IDs (not laid out) are ignored.
 */
import type { Bounds, LayoutMap } from '@sheet-music/renderer-core';

/** CSS px added around the notes (left and right) and the staves (top and bottom). */
export const BAND_PADDING = { x: 6, y: 8 } as const;

export interface PlaybackBand {
  readonly systemId: string;
  readonly bounds: Bounds;
}

interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function placePlaybackBands(noteIds: readonly string[], layout: LayoutMap): PlaybackBand[] {
  const extents = new Map<string, Extent>();
  for (const noteId of noteIds) {
    const note = layout.notes.get(noteId);
    if (note === undefined) {
      continue;
    }
    const { x, y, width, height } = note.bounds;
    const extent = extents.get(note.systemId);
    if (extent === undefined) {
      extents.set(note.systemId, { left: x, right: x + width, top: y, bottom: y + height });
    } else {
      extent.left = Math.min(extent.left, x);
      extent.right = Math.max(extent.right, x + width);
      extent.top = Math.min(extent.top, y);
      extent.bottom = Math.max(extent.bottom, y + height);
    }
  }
  return layout.systems.flatMap((system) => {
    const extent = extents.get(system.systemId);
    if (extent === undefined) {
      return [];
    }
    for (const staff of system.staves) {
      extent.top = Math.min(extent.top, staff.bounds.y);
      extent.bottom = Math.max(extent.bottom, staff.bounds.y + staff.bounds.height);
    }
    const left = Math.max(0, extent.left - BAND_PADDING.x);
    const right = Math.min(layout.width, extent.right + BAND_PADDING.x);
    const top = Math.max(0, extent.top - BAND_PADDING.y);
    const bottom = Math.min(layout.height, extent.bottom + BAND_PADDING.y);
    return [
      {
        systemId: system.systemId,
        bounds: {
          x: left,
          y: top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        },
      },
    ];
  });
}
