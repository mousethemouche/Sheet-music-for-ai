/**
 * REN-I02: labels outside the staves never collide, checked on the real
 * adapter in headless Chromium with its bundled fonts (ink measured from the
 * browser's own text metrics, as a reader sees it).
 *
 * For every catalogue fixture that carries labels (chord symbols, Roman
 * numerals, scale degrees, dynamics and hairpins, sustain pedal, fingerings,
 * swing), for the rich wire fixture, a crowded low bass line and the crowded
 * scores of `label-scores.ts`, at a desktop, a wide, a medium and a phone width:
 * - no two labels come closer than CLEARANCE, of different kinds or of one
 *   kind (a pedal release and the next "Ped.", the scale degrees of a chord,
 *   two chord symbols), except the fingerings stacked beside one chord;
 * - no label touches the staff lines, bar lines or noteheads of its own
 *   system or of the neighbouring systems (a fingering, which VexFlow draws
 *   next to its notehead and may set inside the staff, is checked against
 *   the other noteheads and the bar lines only);
 * - every label lies inside its system's LayoutMap bounds, which the next
 *   system and the UI's annotation overlay are placed from.
 * Where voices share a staff, the fingering of a note lying on or beyond an
 * outer staff line, with no other voice sounding further out at its onset,
 * clears every staff and ledger line (listed by hand below).
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import type { LayoutMap } from '@sheet-music/renderer-core';
import {
  F03,
  F05,
  F08,
  F10_SWING_3_2,
  RICH_WIRE_FIXTURE,
  bar,
  chord,
  member,
  note,
  parseFixture,
  score,
  staff,
  voice,
} from '@sheet-music/test-fixtures';
import { beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createVexFlowRendererFactory } from '../src';
import { CHORD_DEGREES, DENSE_BAR, PEDAL_EVERY_BEAT, TALL_STACK } from './label-scores';

const THEME = { ink: '#18181b', playbackHighlight: '#4f46e5' } as const;
const BAND = 28;
/**
 * A desktop width (one system for most scores: bars share a system and are
 * justified), wide, medium and phone widths (a 375 px phone minus the
 * player's padding).
 */
const WIDTHS = [1040, 760, 520, 320] as const;
/** Smallest distance between two labels, or a label and the notation, in px: closer reads as touching. */
const CLEARANCE = 2;
/** Staff lines are 1 px strokes around their path. */
const HALF_STROKE = 0.5;
/** Ledger lines are 1.4 px strokes (the adapter's ledger line style). */
const HALF_LEDGER_STROKE = 0.7;

/**
 * Every label below a low bass line: fingerings under ledger-line notes, two
 * voices with a dynamic mark at one onset (two rows), a hairpin over a short
 * pedal, scale degrees and Roman numerals; above, chord symbols over high
 * treble notes with articulations and fingerings, a dynamic between the staves.
 */
const CROWDED = score({
  id: 'cr',
  keySignature: { fifths: 0 },
  tonalContext: { tonic: { step: 'C', alter: 0 }, mode: 'major' },
  staves: [
    staff(
      'cr-rh',
      'right',
      [
        bar('cr-m1', 1, [
          voice('cr-rh-v1', [
            note('cr-rh-1', 'C6', 'quarter', { fingering: 5, articulations: ['marcato'] }),
            note('cr-rh-2', 'A5', 'quarter', { fingering: 4, articulations: ['accent'] }),
            note('cr-rh-3', 'B5', 'half', { fingering: 5 }),
          ]),
        ]),
        bar('cr-m2', 2, [
          voice('cr-rh-v2', [
            chord(
              'cr-rh-c',
              [
                member('cr-rh-c-e', 'E5'),
                member('cr-rh-c-g', 'G5', { fingering: 3 }),
                member('cr-rh-c-c', 'C6', { fingering: 5 }),
              ],
              'whole',
            ),
          ]),
        ]),
      ],
      'treble',
    ),
    staff(
      'cr-lh',
      'left',
      [
        bar('cr-m1', 1, [
          voice('cr-lh-v1', [
            note('cr-lh-1', 'E2', 'half', { fingering: 5 }),
            note('cr-lh-2', 'G2', 'half', { fingering: 3 }),
          ]),
          voice('cr-lh-v2', [note('cr-lh-3', 'C2', 'whole', { fingering: 5 })]),
        ]),
        bar('cr-m2', 2, [
          voice('cr-lh-v3', [
            note('cr-lh-4', 'C2', 'quarter', { fingering: 5 }),
            note('cr-lh-5', 'D2', 'quarter'),
            note('cr-lh-6', 'E2', 'quarter'),
            note('cr-lh-7', 'F2', 'quarter', { fingering: 1 }),
          ]),
        ]),
      ],
      'bass',
    ),
  ],
  harmony: [
    {
      id: 'cr-h1',
      measureId: 'cr-m1',
      chord: { root: { step: 'C', alter: 0 }, quality: 'major', extension: 7 },
      analysis: { romanNumeral: 'Imaj7' },
    },
    {
      id: 'cr-h2',
      measureId: 'cr-m1',
      offset: { numerator: 1, denominator: 2 },
      chord: { root: { step: 'C', alter: 0 }, quality: 'dominant', extension: 7 },
      analysis: { romanNumeral: 'V7/IV' },
    },
    {
      id: 'cr-h3',
      measureId: 'cr-m2',
      chord: { root: { step: 'F', alter: 0 }, quality: 'major' },
      analysis: { romanNumeral: 'IV' },
    },
  ],
  dynamics: [
    { id: 'cr-d1', type: 'mark', eventId: 'cr-lh-1', marking: 'f' },
    { id: 'cr-d2', type: 'mark', eventId: 'cr-lh-3', marking: 'p' },
    {
      id: 'cr-d3',
      type: 'hairpin',
      direction: 'diminuendo',
      startEventId: 'cr-lh-4',
      endEventId: 'cr-lh-7',
    },
    { id: 'cr-d4', type: 'mark', eventId: 'cr-rh-1', marking: 'ff' },
  ],
  pedal: [
    { id: 'cr-p1', type: 'sustain', startEventId: 'cr-lh-1', endEventId: 'cr-lh-2' },
    { id: 'cr-p2', type: 'sustain', startEventId: 'cr-lh-5', endEventId: 'cr-lh-5' },
  ],
  scaleDegrees: [
    { id: 'cr-sd1', noteId: 'cr-lh-1', degree: 3 },
    { id: 'cr-sd2', noteId: 'cr-lh-4', degree: 1 },
    { id: 'cr-sd3', noteId: 'cr-rh-2', degree: 6 },
  ],
});

const CASES: readonly { readonly name: string; readonly input: ScoreSpecInput }[] = [
  { name: 'rich wire fixture', input: RICH_WIRE_FIXTURE },
  { name: 'F03 chord symbols, Roman numerals, degrees, fingerings', input: F03 },
  { name: 'F05 altered scale degrees', input: F05 },
  { name: 'F08 dynamics, hairpins, pedal spans, fingerings', input: F08 },
  { name: 'F10 swing indication', input: F10_SWING_3_2 },
  { name: 'crowded low bass line', input: CROWDED },
  { name: 'dense bar: pedal changes, voices, degrees at one onset', input: DENSE_BAR },
  { name: 'pedal change on every beat', input: PEDAL_EVERY_BEAT },
  { name: 'tall stack of rows across systems', input: TALL_STACK },
  { name: 'scale degrees of chord members, hairpins into marks', input: CHORD_DEGREES },
];

/**
 * Fingerings that must clear every staff and ledger line: notes of a staff
 * shared by voices, on or beyond an outer staff line, with no other voice
 * sounding further out at their onset (the outer side is free).
 */
const CLEAR_FINGERINGS: readonly {
  readonly name: string;
  readonly input: ScoreSpecInput;
  readonly noteIds: readonly string[];
}[] = [
  { name: 'crowded low bass line', input: CROWDED, noteIds: ['cr-lh-2', 'cr-lh-3'] },
  { name: 'dense bar', input: DENSE_BAR, noteIds: ['a1-lh-2', 'a1-lh-6', 'a1-lh-7'] },
  {
    name: 'tall stack, first voice below the second',
    input: TALL_STACK,
    noteIds: ['a3-lh-2', 'a3-lh-3', 'a3-lh-4', 'a3-lh-7'],
  },
];

/** Label kinds, by the groups the adapter draws them in (README, data-* hooks). */
const LABEL_SELECTORS: Readonly<Record<string, string>> = {
  'chord symbol': '.vf-chord-symbol text',
  swing: '.vf-swing text',
  'Roman numeral': '.vf-roman-numeral text',
  'scale degree': '.vf-scale-degree text',
  dynamic: '.vf-dynamic text',
  hairpin: '.vf-hairpin path',
  pedal: '.vf-pedal text',
};

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Drawn {
  readonly kind: string;
  readonly system: number;
  readonly text: string;
  readonly box: Box;
  /** The notehead group a notehead or fingering glyph belongs to. */
  readonly head?: Element;
}

async function engraved<T>(
  input: ScoreSpecInput,
  width: number,
  check: (target: HTMLElement, layoutMap: LayoutMap) => T,
): Promise<T> {
  const target = document.createElement('div');
  document.body.append(target);
  const renderer = createVexFlowRendererFactory()();
  try {
    const { layoutMap } = await renderer.render(parseFixture(input), target, {
      width,
      theme: THEME,
      annotationBandHeight: BAND,
    });
    return check(target, layoutMap);
  } finally {
    renderer.destroy();
    target.remove();
  }
}

const context = (() => {
  const canvas = document.createElement('canvas').getContext('2d');
  if (canvas === null) {
    throw new Error('no canvas');
  }
  return canvas;
})();

/** A box of an element's own user space, in the SVG surface (through the system translation). */
function onSurface(
  element: Element,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Box {
  const matrix = (element as SVGGraphicsElement).getCTM();
  if (matrix === null) {
    throw new Error('element is not rendered');
  }
  const a = new DOMPoint(left, top).matrixTransform(matrix);
  const b = new DOMPoint(right, bottom).matrixTransform(matrix);
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/** Ink of a text element from the browser's glyph metrics (its SVG box is the whole line box). */
function textInk(text: Element): Box {
  const style = getComputedStyle(text);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const metrics = context.measureText(text.textContent);
  const x = Number(text.getAttribute('x'));
  const y = Number(text.getAttribute('y'));
  return onSurface(
    text,
    x - metrics.actualBoundingBoxLeft,
    y - metrics.actualBoundingBoxAscent,
    x + metrics.actualBoundingBoxRight,
    y + metrics.actualBoundingBoxDescent,
  );
}

function pathBox(path: Element, stroke = 0): Box {
  const box = (path as SVGGraphicsElement).getBBox();
  return onSurface(
    path,
    box.x - stroke,
    box.y - stroke,
    box.x + box.width + stroke,
    box.y + box.height + stroke,
  );
}

const systemOf = (element: Element): number =>
  Number(element.closest('[data-system-index]')?.getAttribute('data-system-index'));

const isFingering = (text: Element): boolean => /^[1-5]$/.test(text.textContent);

/** Labels, staff lines, bar lines and noteheads as drawn in `target`. */
function drawnParts(target: HTMLElement): {
  readonly labels: readonly Drawn[];
  readonly notation: readonly Drawn[];
} {
  const labels: Drawn[] = [];
  for (const [kind, selector] of Object.entries(LABEL_SELECTORS)) {
    for (const element of target.querySelectorAll(selector)) {
      labels.push({
        kind,
        system: systemOf(element),
        text: element.textContent,
        box: element.tagName.toLowerCase() === 'text' ? textInk(element) : pathBox(element),
      });
    }
  }
  const notation: Drawn[] = [];
  // A notehead group holds its glyph, then the fingering and articulation glyphs of that key.
  for (const head of target.querySelectorAll('.vf-notehead')) {
    const [glyph, ...modifiers] = [...head.querySelectorAll(':scope > text')];
    if (glyph !== undefined) {
      notation.push({
        kind: 'notehead',
        system: systemOf(head),
        text: head.getAttribute('data-note-id') ?? 'rest',
        box: textInk(glyph),
        head,
      });
    }
    for (const fingering of modifiers.filter(isFingering)) {
      labels.push({
        kind: 'fingering',
        system: systemOf(fingering),
        text: fingering.textContent,
        box: textInk(fingering),
        head,
      });
    }
  }
  for (const line of target.querySelectorAll('.vf-stave > path')) {
    notation.push({
      kind: 'staff line',
      system: systemOf(line),
      text: '',
      box: pathBox(line, HALF_STROKE),
    });
  }
  // Bar lines of each stave, and the lines joining the staves of a system.
  for (const line of target.querySelectorAll(
    '.vf-stavebarline > rect, [data-system-index] > rect',
  )) {
    notation.push({ kind: 'bar line', system: systemOf(line), text: '', box: pathBox(line) });
  }
  return { labels, notation };
}

/** The fingering drawn with a note's notehead, and the staff and ledger lines of its system. */
function fingeringAndLines(
  target: HTMLElement,
  noteId: string,
): { readonly fingering: Box; readonly lines: readonly Box[] } {
  const head = target.querySelector(`.vf-notehead[data-note-id="${noteId}"]`);
  const digit = [...(head?.querySelectorAll(':scope > text') ?? [])].find(isFingering);
  if (head === null || digit === undefined) {
    throw new Error(`no fingering drawn for ${noteId}`);
  }
  const system = head.closest('[data-system-index]');
  const lines = [
    ...[...(system?.querySelectorAll('.vf-stave > path') ?? [])].map((line) =>
      pathBox(line, HALF_STROKE),
    ),
    // Ledger lines are the paths a note group draws itself (stems have their own group).
    ...[...(system?.querySelectorAll('.vf-stavenote > path') ?? [])].map((line) =>
      pathBox(line, HALF_LEDGER_STROKE),
    ),
  ];
  return { fingering: textInk(digit), lines };
}

const apart = (a: Box, b: Box): boolean =>
  a.right + CLEARANCE <= b.left ||
  b.right + CLEARANCE <= a.left ||
  a.bottom + CLEARANCE <= b.top ||
  b.bottom + CLEARANCE <= a.top;

const describeBox = (box: Box): string =>
  `[${box.left.toFixed(1)}, ${box.top.toFixed(1)} .. ${box.right.toFixed(1)}, ${box.bottom.toFixed(1)}]`;

const describePart = (part: Drawn): string =>
  `${part.kind} "${part.text}" (system ${part.system}) ${describeBox(part.box)}`;

/** The note group (one per event) a fingering belongs to: a chord's fingerings share it. */
const chordOf = (part: Drawn): Element | null | undefined => part.head?.closest('.vf-stavenote');

/** Every pair of labels, and every label and notation part, that touch. */
function collisions(labels: readonly Drawn[], notation: readonly Drawn[]): string[] {
  const found: string[] = [];
  labels.forEach((label, position) => {
    for (const other of labels.slice(position + 1)) {
      const sameChord =
        label.kind === 'fingering' &&
        other.kind === 'fingering' &&
        chordOf(label) === chordOf(other);
      if (!sameChord && !apart(label.box, other.box)) {
        found.push(`${describePart(label)} touches ${describePart(other)}`);
      }
    }
    for (const part of notation) {
      const neighbour = Math.abs(part.system - label.system) === 1;
      const own =
        part.system === label.system &&
        (label.kind !== 'fingering' ||
          part.kind === 'bar line' ||
          (part.kind === 'notehead' && part.head !== label.head));
      if ((neighbour || own) && !apart(label.box, part.box)) {
        found.push(`${describePart(label)} touches ${describePart(part)}`);
      }
    }
  });
  return found;
}

/** Labels that stick out of their system's LayoutMap bounds. */
function outsideSystems(labels: readonly Drawn[], layout: LayoutMap): string[] {
  return labels.flatMap((label) => {
    const bounds = layout.systems[label.system]?.bounds;
    const inside =
      bounds !== undefined &&
      label.box.left >= bounds.x - 0.5 &&
      label.box.top >= bounds.y - 0.5 &&
      label.box.right <= bounds.x + bounds.width + 0.5 &&
      label.box.bottom <= bounds.y + bounds.height + 0.5;
    return inside ? [] : [`${describePart(label)} is outside its system's bounds`];
  });
}

beforeAll(async () => {
  await page.viewport(1200, 1200);
});

describe.each(CASES)('REN-I02 label rows: $name', ({ input }) => {
  it.each(WIDTHS)(
    'keeps labels apart from each other and from the notation at %i px',
    async (width) => {
      await engraved(input, width, (target, layoutMap) => {
        const { labels, notation } = drawnParts(target);

        expect(labels.length).toBeGreaterThan(0);
        expect(collisions(labels, notation)).toEqual([]);
        expect(outsideSystems(labels, layoutMap)).toEqual([]);
        layoutMap.systems.forEach((system, index) => {
          const next = layoutMap.systems[index + 1];
          if (next !== undefined) {
            expect(system.bounds.y + system.bounds.height).toBeLessThan(next.annotationBand.y);
          }
        });
      });
    },
  );
});

describe.each(CLEAR_FINGERINGS)(
  'REN-I02 fingerings of shared staves: $name',
  ({ input, noteIds }) => {
    it.each(WIDTHS)(
      'sets the fingering of a note beyond an outer line clear of staff and ledger lines at %i px',
      async (width) => {
        await engraved(input, width, (target) => {
          const struck = noteIds.flatMap((noteId) => {
            const { fingering, lines } = fingeringAndLines(target, noteId);
            return lines
              .filter((line) => !apart(fingering, line))
              .map((line) => `${noteId} ${describeBox(fingering)} touches ${describeBox(line)}`);
          });

          expect(struck).toEqual([]);
        });
      },
    );
  },
);
