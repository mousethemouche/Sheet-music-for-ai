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
import {
  apart,
  collisions,
  describeBox,
  drawnParts,
  fingeringAndLines,
  outsideSystems,
} from './label-geometry';
import { CHORD_DEGREES, DENSE_BAR, PEDAL_EVERY_BEAT, TALL_STACK } from './label-scores';

const THEME = { ink: '#18181b', playbackHighlight: '#4f46e5' } as const;
const BAND = 28;
/**
 * A desktop width (one system for most scores: bars share a system and are
 * justified), wide, medium and phone widths (a 375 px phone minus the
 * player's padding).
 */
const WIDTHS = [1040, 760, 520, 320] as const;

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
