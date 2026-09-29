/**
 * REN-I01 (issue #5): the real adapter in headless Chromium, with pinned
 * VexFlow 5 and its bundled fonts. One rich fixture is engraved, checked for
 * public labels, note-ID mapping against the drawn noteheads and finite
 * geometry, then resized, updated to a new revision and destroyed. Two small
 * scores check what only real glyph metrics show: the marks of short pedal
 * spans and the glyphs of four voices starting together stay apart.
 *
 * Interim harness: MCP-UI-01/02 (#11) host this check once the shared
 * iframe harness exists (TEST_PLAN §3); it then moves there rather than
 * becoming a second browser suite.
 */
import { type ScoreSpecInput, applyScoreEdit, buildScoreIndex } from '@sheet-music/music-domain';
import type { Bounds, LayoutMap, ScoreRenderer } from '@sheet-music/renderer-core';
import {
  RICH_WIRE_FIXTURE,
  RICH_WIRE_ORACLE,
  bar,
  note,
  parseFixture,
  rest,
  score as scoreOf,
  staff,
  voice,
} from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createVexFlowRendererFactory } from '../src';

const THEME = { ink: '#1b1b1b', playbackHighlight: '#ff9800' } as const;
const BAND = 28;
const WIDE = 760;
const NARROW = 360;
const TEACHING_COLORS = ['#e91e63', '#1e88e5'];

const score = parseFixture(RICH_WIRE_FIXTURE);
const noteIds = buildScoreIndex(score).noteTargets.map((note) => note.id);

let target: HTMLElement;
let renderer: ScoreRenderer;
let layout: LayoutMap;

function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

function finite(box: Bounds): boolean {
  return (
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

function noteheadGlyph(noteId: string): SVGTextElement {
  const glyph = target.querySelector<SVGTextElement>(
    `.vf-notehead[data-note-id="${noteId}"] > text`,
  );
  if (glyph === null) {
    throw new Error(`No notehead drawn for ${noteId}`);
  }
  return glyph;
}

/** The drawn glyph in surface coordinates: x from its rendered box, y from its (transformed) baseline. */
function drawnGlyph(noteId: string): { x: number; width: number; baseline: number } {
  const glyph = noteheadGlyph(noteId);
  const origin = target.getBoundingClientRect();
  const rect = glyph.getBoundingClientRect();
  const matrix = glyph.getCTM();
  const y = Number(glyph.getAttribute('y'));
  return {
    x: rect.left - origin.left,
    width: rect.width,
    baseline:
      matrix === null
        ? Number.NaN
        : matrix.b * Number(glyph.getAttribute('x')) + matrix.d * y + matrix.f,
  };
}

function texts(selector: string): string[] {
  return [...target.querySelectorAll(selector)].map((element) => element.textContent);
}

interface InkBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Ink of a drawn glyph in its SVG user space, from the browser's own text metrics. */
function inkBox(text: Element): InkBox {
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) {
    throw new Error('no canvas');
  }
  const style = getComputedStyle(text);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const metrics = context.measureText(text.textContent);
  const x = Number(text.getAttribute('x'));
  const y = Number(text.getAttribute('y'));
  return {
    left: x - metrics.actualBoundingBoxLeft,
    right: x + metrics.actualBoundingBoxRight,
    top: y - metrics.actualBoundingBoxAscent,
    bottom: y + metrics.actualBoundingBoxDescent,
  };
}

const overlap = (a: InkBox, b: InkBox): boolean =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** Engraves `input` into a target of its own; `release` destroys the renderer and removes the target. */
async function engraveAlone(
  input: ScoreSpecInput,
  width: number,
): Promise<{ readonly target: HTMLElement; release(): void }> {
  const alone = document.createElement('div');
  document.body.append(alone);
  const own = createVexFlowRendererFactory()();
  await own.render(parseFixture(input), alone, { width, theme: THEME, annotationBandHeight: 0 });
  return {
    target: alone,
    release: () => {
      own.destroy();
      alone.remove();
    },
  };
}

/** Bar 1 four quarters, bar 2 one whole note pedalled alone, bar 3 a pedal on one quarter. */
const SHORT_PEDALS = scoreOf({
  id: 'sp',
  staves: [
    staff('sp-rh', 'right', [
      bar('sp-m1', 1, [
        voice(
          'sp-v1',
          ['C4', 'D4', 'E4', 'F4'].map((pitch, i) => note(`sp-1${i}`, pitch, 'quarter')),
        ),
      ]),
      bar('sp-m2', 2, [voice('sp-v2', [note('sp-w', 'D4', 'whole')])]),
      bar('sp-m3', 3, [
        voice(
          'sp-v3',
          ['C4', 'D4', 'E4', 'F4'].map((pitch, i) => note(`sp-3${i}`, pitch, 'quarter')),
        ),
      ]),
    ]),
  ],
  pedal: [
    { id: 'sp-p1', type: 'sustain', startEventId: 'sp-w', endEventId: 'sp-w' },
    { id: 'sp-p2', type: 'sustain', startEventId: 'sp-31', endEventId: 'sp-31' },
  ],
});

/** Four voices starting together on one staff, a note of one right where another's rest sits. */
const FOUR_VOICES = scoreOf({
  id: 'fv',
  staves: [
    staff('fv-rh', 'right', [
      bar('fv-m1', 1, [
        voice('fv-v1', [
          note('fv-1', 'C##5', 'half'),
          note('fv-2', 'D5', 'quarter'),
          note('fv-3', 'E5', 'eighth'),
          note('fv-4', 'F5', 'eighth'),
        ]),
        voice('fv-v2', [rest('fv-r1', 'half'), note('fv-5', 'A4', 'half')]),
        voice('fv-v3', [note('fv-6', 'F4', 'whole')]),
        voice('fv-v4', [rest('fv-r2', 'quarter'), note('fv-7', 'D4', { value: 'half', dots: 1 })]),
      ]),
    ]),
  ],
});

beforeAll(async () => {
  await page.viewport(1200, 1200);
  target = document.createElement('div');
  document.body.append(target);
  renderer = createVexFlowRendererFactory()();
  ({ layoutMap: layout } = await renderer.render(score, target, {
    width: WIDE,
    theme: THEME,
    annotationBandHeight: BAND,
  }));
});

afterAll(() => {
  renderer.destroy();
  target.remove();
});

describe('REN-I01 real VexFlow in Chromium', () => {
  it('engraves with the bundled fonts and fetches no font', () => {
    expect(document.fonts.check('30pt Bravura')).toBe(true);
    expect(document.fonts.check('12pt Academico')).toBe(true);
    const fetched = performance.getEntriesByType('resource').map((entry) => entry.name);
    expect(fetched.filter((url) => /jsdelivr|vexflow-fonts|woff2?(\?|$)/.test(url))).toEqual([]);
    expect(target.querySelectorAll('svg')).toHaveLength(1);
  });

  it('draws the public labels', () => {
    expect(texts('.vf-chord-symbol')).toEqual(['Gmaj7', 'Am7', 'D7(b9)', 'G/B']);
    expect(texts('.vf-roman-numeral')).toEqual(['Imaj7', 'ii7', 'V7', 'I6']);
    expect(
      [...target.querySelectorAll('.vf-scale-degree')].map((label) => [
        label.getAttribute('data-note-id'),
        label.textContent,
      ]),
    ).toEqual([
      ['rich-rh-n7', '3'],
      ['rich-rh-n8', '2'],
      ['rich-rh-n9', '1'],
      ['rich-rh-n6', '4'],
    ]);
    expect(texts('.vf-swing')).toEqual(['Swing']);
    expect(
      [...target.querySelectorAll('.vf-dynamic, .vf-hairpin')]
        .map((mark) => mark.getAttribute('data-dynamic-id'))
        .sort(),
    ).toEqual(RICH_WIRE_ORACLE.dynamicIds);
    expect(
      [...target.querySelectorAll('.vf-pedal')].map((pedal) => pedal.getAttribute('data-pedal-id')),
    ).toEqual(RICH_WIRE_ORACLE.pedalIds);
    expect(
      [...target.querySelectorAll('.vf-slur')].map((slur) => slur.getAttribute('data-slur-id')),
    ).toEqual(RICH_WIRE_ORACLE.slurIds);
    expect(
      [...target.querySelectorAll('.vf-tie')].map((tie) => [
        tie.getAttribute('data-tie-from'),
        tie.getAttribute('data-tie-to'),
      ]),
    ).toEqual(RICH_WIRE_ORACLE.tiePairs);
  });

  it('maps every written note ID to finite bounds on the notehead drawn for it', () => {
    expect([...layout.notes.keys()].sort()).toEqual([...noteIds].sort());
    for (const noteId of noteIds) {
      const laid = layout.notes.get(noteId);
      const system = layout.systems.find((candidate) => candidate.systemId === laid?.systemId);
      if (laid === undefined || system === undefined) {
        throw new Error(`${noteId} is not laid out`);
      }
      const drawn = drawnGlyph(noteId);
      expect(finite(laid.bounds), noteId).toBe(true);
      expect(laid.bounds.width, noteId).toBeGreaterThan(5);
      expect(laid.bounds.height, noteId).toBeGreaterThan(5);
      expect(contains(system.bounds, laid.bounds), noteId).toBe(true);
      expect(system.measureIds, noteId).toContain(laid.measureId);
      // Same glyph: horizontal extent from the browser, vertical center on the glyph baseline.
      expect(Math.abs(drawn.x - laid.bounds.x), noteId).toBeLessThan(1.5);
      expect(Math.abs(drawn.width - laid.bounds.width), noteId).toBeLessThan(1.5);
      expect(
        Math.abs(drawn.baseline - (laid.bounds.y + laid.bounds.height / 2)),
        noteId,
      ).toBeLessThan(1.5);
    }
  });

  it('keeps chord members in one column, ordered by pitch', () => {
    const [low, middle, high] = RICH_WIRE_ORACLE.chordMemberIds
      .slice(0, 3)
      .map((id) => layout.notes.get(id)?.bounds);
    expect(low?.x).toBeCloseTo(middle?.x ?? Number.NaN, 0);
    expect(middle?.x).toBeCloseTo(high?.x ?? Number.NaN, 0);
    expect(low?.y).toBeGreaterThan(middle?.y ?? Number.NaN);
    expect(middle?.y).toBeGreaterThan(high?.y ?? Number.NaN);
  });

  it('stacks systems without overlap and reserves the annotation band above annotated systems only', () => {
    expect(layout.systems.length).toBeGreaterThan(1);
    // The content fits: the surface is exactly the width asked for (no host scrollbar).
    expect(layout.width).toBe(WIDE);
    expect(target.querySelector('svg')?.getAttribute('width')).toBe(String(layout.width));
    layout.systems.forEach((system, index) => {
      expect(finite(system.bounds) && finite(system.annotationBand)).toBe(true);
      expect(system.annotationBand.y + system.annotationBand.height).toBeCloseTo(
        system.bounds.y,
        6,
      );
      const annotated = [...layout.notes.values()].some(
        (note) =>
          note.systemId === system.systemId && ['rich-rh-c1-b', 'rich-rh-n4'].includes(note.noteId),
      );
      expect(system.annotationBand.height).toBe(annotated ? BAND : 0);
      for (const staff of system.staves) {
        expect(contains(system.bounds, staff.bounds)).toBe(true);
        expect(staff.bounds.height).toBeCloseTo(40, 0);
      }
      const next = layout.systems[index + 1];
      if (next !== undefined) {
        expect(system.bounds.y + system.bounds.height).toBeLessThan(next.annotationBand.y);
      }
    });
    const last = layout.systems[layout.systems.length - 1];
    expect(layout.height).toBeGreaterThanOrEqual(
      (last?.bounds.y ?? 0) + (last?.bounds.height ?? 0),
    );
  });

  it('paints with the theme ink and stored teaching colors only, and highlights without erasing them', () => {
    const svg = target.querySelector('svg');
    const painted = new Set(
      [...(svg?.querySelectorAll('[fill], [stroke]') ?? [])].flatMap((element) =>
        ['fill', 'stroke']
          .map((name) => element.getAttribute(name))
          .filter((value) => value !== null && value !== 'none'),
      ),
    );
    expect([...painted].sort()).toEqual([THEME.ink, ...TEACHING_COLORS].sort());
    const fill = (id: string): string => getComputedStyle(noteheadGlyph(id)).fill;

    const pink = fill('rich-rh-c1-b');
    expect(pink).toBe('rgb(233, 30, 99)');
    expect(fill('rich-rh-c1-g')).toBe('rgb(27, 27, 27)');
    renderer.setPlaybackHighlight(['rich-rh-c1-b', 'rich-rh-c1-g']);
    expect(fill('rich-rh-c1-b')).toBe('rgb(255, 152, 0)');
    expect(fill('rich-rh-c1-g')).toBe('rgb(255, 152, 0)');
    renderer.setPlaybackHighlight([]);
    expect(fill('rich-rh-c1-b')).toBe(pink);
    expect(fill('rich-rh-c1-g')).toBe('rgb(27, 27, 27)');
  });

  it('re-lays out on resize: more systems at a narrow width, same note IDs, one SVG', async () => {
    const { layoutMap } = await renderer.resize(NARROW);

    expect(layoutMap.systems.length).toBeGreaterThan(layout.systems.length);
    expect(layoutMap.width).toBe(NARROW);
    expect([...layoutMap.notes.keys()].sort()).toEqual([...noteIds].sort());
    expect(layoutMap.systems.flatMap((system) => system.measureIds)).toEqual(
      RICH_WIRE_ORACLE.barIds,
    );
    expect([...layoutMap.notes.values()].every((note) => finite(note.bounds))).toBe(true);
    expect(target.querySelectorAll('svg')).toHaveLength(1);
  });

  it('keeps the marks of short pedal spans and the glyphs of four voices apart', async () => {
    const pedalled = await engraveAlone(SHORT_PEDALS, 700);
    const voices = await engraveAlone(FOUR_VOICES, 500);
    try {
      expect(pedalled.target.querySelectorAll('.vf-pedal')).toHaveLength(2);
      for (const pedal of pedalled.target.querySelectorAll('.vf-pedal')) {
        const [depress, release] = [...pedal.querySelectorAll('text')].map(inkBox);
        expect(depress, pedal.getAttribute('data-pedal-id') ?? '').toBeDefined();
        expect(release?.left, pedal.getAttribute('data-pedal-id') ?? '').toBeGreaterThan(
          depress?.right ?? Number.POSITIVE_INFINITY,
        );
      }
      // One notehead or rest glyph per event; none covers another.
      const glyphs = [...voices.target.querySelectorAll('.vf-stavenote')].map((group) => {
        const glyph = group.querySelector('.vf-notehead > text');
        if (glyph === null) {
          throw new Error(`no glyph drawn in ${group.id}`);
        }
        return inkBox(glyph);
      });
      expect(glyphs).toHaveLength(9);
      glyphs.forEach((glyph, index) => {
        for (const other of glyphs.slice(index + 1)) {
          expect(overlap(glyph, other)).toBe(false);
        }
      });
    } finally {
      pedalled.release();
      voices.release();
    }
  });

  it('drops the notes a new revision removed, then leaves nothing behind on destroy', async () => {
    const edited = applyScoreEdit(score, {
      expectedRevision: score.revision,
      operations: [
        { type: 'delete_measures', measureIds: ['rich-m4'] },
        { type: 'remove_chord_symbol', harmonyId: 'rich-h4' },
        { type: 'remove_harmonic_analysis', harmonyId: 'rich-h4' },
      ],
    });
    if (!edited.ok) {
      throw new Error(JSON.stringify(edited.error));
    }
    const { layoutMap } = await renderer.update(edited.value);
    const removed = ['rich-rh-c2-g', 'rich-rh-c2-b', 'rich-lh-n5'];

    for (const noteId of removed) {
      expect(layoutMap.notes.has(noteId)).toBe(false);
      expect(target.querySelector(`[data-note-id="${noteId}"]`)).toBeNull();
    }
    expect([...layoutMap.notes.keys()].sort()).toEqual(
      noteIds.filter((id) => !removed.includes(id)).sort(),
    );
    expect(texts('.vf-chord-symbol')).toEqual(['Gmaj7', 'Am7', 'D7(b9)']);
    expect(target.querySelectorAll('svg')).toHaveLength(1);

    renderer.destroy();
    expect(target.childNodes).toHaveLength(0);
  });
});
