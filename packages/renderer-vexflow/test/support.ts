/**
 * Shared setup of the REN-01..03 tests, which run in jsdom.
 *
 * jsdom has no canvas text metrics and no SVG geometry (getBBox). VexFlow 5
 * measures every glyph through a canvas, so these stubs give it and the
 * adapter deterministic, finite numbers. They make the real VexFlow objects
 * and drawing code run, which is enough for mapping, identity and lifecycle;
 * they prove nothing about real layout. REN-I01 checks layout in Chromium
 * with the real fonts.
 */
import type { ScoreSpec, ScoreSpecInput } from '@sheet-music/music-domain';
import type { RenderOptions, ScoreRenderer } from '@sheet-music/renderer-core';
import { parseFixture } from '@sheet-music/test-fixtures';
import { Element as VexElement, Stave } from 'vexflow/bravura';
import { type BarGlyphs, type EventGlyph, buildBar, prepareScore } from '../src/build';
import { createVexFlowRendererFactory } from '../src';

const STUB_GLYPH_WIDTH = 8;

export function installJsdomLayoutStubs(): void {
  const context = {
    font: '',
    measureText: (text: string) => ({
      width: STUB_GLYPH_WIDTH * text.length,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: STUB_GLYPH_WIDTH * text.length,
      actualBoundingBoxAscent: 6,
      actualBoundingBoxDescent: 2,
    }),
  };
  VexElement.setTextMeasurementCanvas({
    getContext: () => context,
  } as unknown as HTMLCanvasElement);
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    writable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
}

/** The highlight is an inline style, which the DOM serializes as rgb(); written that way to compare. */
export const THEME = { ink: '#101010', playbackHighlight: 'rgb(255, 152, 0)' } as const;

export const OPTIONS: RenderOptions = { width: 640, theme: THEME, annotationBandHeight: 24 };

/** A renderer whose fonts are "ready" at once (jsdom has no Font Loading API). */
export function newRenderer(): ScoreRenderer {
  return createVexFlowRendererFactory({ loadFonts: () => Promise.resolve() })();
}

export function mountTarget(): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  return target;
}

/** One bar built on placeholder staves, with the score it came from. */
export function buildFixtureBar(
  input: ScoreSpecInput,
  barIndex = 0,
): { score: ScoreSpec; glyphs: BarGlyphs; staves: Stave[] } {
  const score = parseFixture(input);
  const staves = score.staves.map(() => new Stave(0, 0, 1000));
  return { score, glyphs: buildBar(prepareScore(score), barIndex, staves), staves };
}

export function eventGlyph(glyphs: BarGlyphs, eventId: string): EventGlyph {
  const found = glyphs.staves
    .flatMap((staff) => staff.events)
    .find((event) => event.eventId === eventId);
  if (found === undefined) {
    throw new Error(`Event ${eventId} is not in the bar`);
  }
  return found;
}

/** The notehead glyph group of a written note in a rendered target. */
export function noteheadGroup(target: HTMLElement, noteId: string): Element {
  const group = target.querySelector(`[data-note-id="${noteId}"].vf-notehead`);
  if (group === null) {
    throw new Error(`No notehead drawn for ${noteId}`);
  }
  return group;
}

/**
 * The fill a notehead glyph is drawn with: its inline style (playback
 * highlight) or the nearest `fill` presentation attribute (VexFlow writes an
 * attribute only where it differs from the enclosing group).
 */
export function noteheadFill(target: HTMLElement, noteId: string): string | null {
  const glyph = noteheadGroup(target, noteId).querySelector<SVGElement>(':scope > text');
  const inline = glyph?.style.getPropertyValue('fill') ?? '';
  if (inline !== '') {
    return inline;
  }
  for (let node: Element | null = glyph ?? null; node !== null; node = node.parentElement) {
    const fill = node.getAttribute('fill');
    if (fill !== null) {
      return fill;
    }
  }
  return null;
}
