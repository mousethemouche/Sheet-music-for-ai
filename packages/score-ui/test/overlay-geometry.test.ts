/**
 * Overlay geometry of the player, pure functions on a hand-written LayoutMap:
 * - the playback band (placePlaybackBands): one rectangle per system behind
 *   the sounding notes, spanning the staves, padded and clamped to the surface;
 * - annotation stacks (placeAnnotations) keep to the visible width when the
 *   notation is wider than its pane, so their text wraps where it is seen.
 */
import type { Annotation } from '@sheet-music/music-domain';
import type { LayoutMap, NoteLayout, SystemLayout } from '@sheet-music/renderer-core';
import { describe, expect, it } from 'vitest';
import { placeAnnotations } from '../src/annotation-layout';
import { BAND_PADDING, placePlaybackBands } from '../src/playback-band';

function note(noteId: string, systemId: string, x: number, y: number): NoteLayout {
  return {
    noteId,
    systemId,
    staffId: 'rh',
    measureId: 'm1',
    bounds: { x, y, width: 10, height: 8 },
  };
}

function systemAt(index: number, top: number, width: number): SystemLayout {
  return {
    systemId: `system-${index}`,
    index,
    measureIds: ['m1'],
    staves: [
      { staffId: 'rh', bounds: { x: 12, y: top + 20, width, height: 40 } },
      { staffId: 'lh', bounds: { x: 12, y: top + 90, width, height: 40 } },
    ],
    bounds: { x: 12, y: top, width, height: 150 },
    annotationBand: { x: 12, y: top - 30, width, height: 30 },
  };
}

/** Two systems, 348 px wide surface (a narrow excerpt), notes on both. */
const LAYOUT: LayoutMap = {
  width: 348,
  height: 400,
  systems: [systemAt(0, 30, 324), systemAt(1, 230, 324)],
  notes: new Map(
    [
      note('a', 'system-0', 100, 56),
      note('b', 'system-0', 104, 100),
      // On a ledger line above the top staff.
      note('high', 'system-0', 200, 30),
      note('c', 'system-1', 336, 260),
    ].map((entry) => [entry.noteId, entry]),
  ),
};

describe('placePlaybackBands', () => {
  it('draws one band per system behind the sounding notes, across its staves', () => {
    const [band] = placePlaybackBands(['a', 'b'], LAYOUT);
    // Staves of system 0 run from y = 50 to y = 160.
    expect(band).toEqual({
      systemId: 'system-0',
      bounds: {
        x: 100 - BAND_PADDING.x,
        y: 50 - BAND_PADDING.y,
        width: 14 + 2 * BAND_PADDING.x,
        height: 110 + 2 * BAND_PADDING.y,
      },
    });
  });

  it('extends the band to a note above the staves', () => {
    const [band] = placePlaybackBands(['high'], LAYOUT);
    expect(band?.bounds.y).toBe(30 - BAND_PADDING.y);
  });

  it('gives each system its own band and clamps it to the surface', () => {
    const bands = placePlaybackBands(['a', 'c'], LAYOUT);
    expect(bands.map((band) => band.systemId)).toEqual(['system-0', 'system-1']);
    const last = bands[1]?.bounds;
    expect(last?.x).toBe(336 - BAND_PADDING.x);
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBe(LAYOUT.width);
  });

  it('draws nothing for no note or for notes that are not laid out', () => {
    expect(placePlaybackBands([], LAYOUT)).toEqual([]);
    expect(placePlaybackBands(['missing'], LAYOUT)).toEqual([]);
  });
});

describe('placeAnnotations visible width', () => {
  const annotation: Annotation = {
    id: 'an1',
    color: '#e91e63',
    noteIds: ['a'],
    text: 'Third of the chord, played with finger 3',
  };

  it('uses the surface width when the whole surface is visible', () => {
    const [stack] = placeAnnotations([annotation], LAYOUT, 348);
    expect(stack?.width).toBe(348 - 2 * 12);
    expect(placeAnnotations([annotation], LAYOUT)[0]?.width).toBe(348 - 2 * 12);
  });

  it('keeps the stack to the visible width, with the same margins, when the notation scrolls', () => {
    const [stack] = placeAnnotations([annotation], LAYOUT, 320);
    expect(stack?.width).toBe(320 - 2 * 12);
    // The label still starts at its note, within half the narrower stack.
    expect(stack?.labels[0]?.indent).toBe(Math.min(100 - 12, (320 - 24) / 2));
  });
});
