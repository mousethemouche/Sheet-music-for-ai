/**
 * Crowded scores for REN-I02 (engraving review of the label rows): each packs
 * labels where they are most likely to meet. Written by hand, not derived
 * from adapter code.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import {
  bar,
  chord,
  member,
  note,
  rest,
  score,
  staff,
  tup,
  voice,
} from '@sheet-music/test-fixtures';

/**
 * Two bars in C minor. Bar 1: chord symbols and Roman numerals on every beat
 * (long ones side by side), two voices on the bass staff with fingerings and
 * scale degrees at one onset ("b3" over "1"), a crescendo into "ff", a pedal
 * change on beat 3. Bar 2: a one-eighth pedal followed straight away by a
 * new pedal (a pedal change on the next eighth) while the bar shares its
 * system and is justified, a diminuendo under a slur.
 */
export const DENSE_BAR: ScoreSpecInput = score({
  id: 'a1',
  keySignature: { fifths: -3 },
  tonalContext: { tonic: { step: 'C', alter: 0 }, mode: 'minor' },
  staves: [
    staff(
      'a1-rh',
      'right',
      [
        bar('a1-m1', 1, [
          voice('a1-rh-v1', [
            note('a1-rh-1', 'C6', 'quarter', { fingering: 5, articulations: ['marcato'] }),
            note('a1-rh-2', 'Ab5', tup('eighth', 'a1-rt'), { fingering: 4 }),
            note('a1-rh-3', 'G5', tup('eighth', 'a1-rt')),
            note('a1-rh-4', 'F#5', tup('eighth', 'a1-rt'), { fingering: 2 }),
            note('a1-rh-5', 'G5', 'half', { articulations: ['accent', 'tenuto'] }),
          ]),
        ]),
        bar('a1-m2', 2, [
          voice('a1-rh-v2', [
            chord(
              'a1-rh-c',
              [
                member('a1-rh-c-e', 'Eb5'),
                member('a1-rh-c-g', 'G5', { fingering: 3 }),
                member('a1-rh-c-c', 'C6', { fingering: 5 }),
              ],
              'whole',
            ),
          ]),
        ]),
      ],
      'treble',
    ),
    staff(
      'a1-lh',
      'left',
      [
        bar('a1-m1', 1, [
          voice('a1-lh-v1', [
            note('a1-lh-1', 'Eb2', 'quarter', { fingering: 5, articulations: ['staccato'] }),
            note('a1-lh-2', 'G2', tup('eighth', 'a1-lt'), { fingering: 3 }),
            note('a1-lh-3', 'Ab2', tup('eighth', 'a1-lt')),
            note('a1-lh-4', 'B2', tup('eighth', 'a1-lt'), { fingering: 1 }),
            note('a1-lh-5', 'C3', 'half', { fingering: 2 }),
          ]),
          voice('a1-lh-v2', [
            note('a1-lh-6', 'C2', 'half', { fingering: 5 }),
            note('a1-lh-7', 'D2', 'half', { fingering: 4 }),
          ]),
        ]),
        bar('a1-m2', 2, [
          voice('a1-lh-v3', [
            note('a1-lh-8', 'A1', 'eighth', { fingering: 5 }),
            note('a1-lh-9', 'C2', 'eighth'),
            note('a1-lh-10', 'Eb2', 'eighth'),
            note('a1-lh-11', 'G2', 'eighth', { fingering: 1 }),
            note('a1-lh-12', 'C1', 'half', { fingering: 5 }),
          ]),
        ]),
      ],
      'bass',
    ),
  ],
  harmony: [
    {
      id: 'a1-h1',
      measureId: 'a1-m1',
      chord: {
        root: { step: 'C', alter: 0 },
        quality: 'minor',
        extension: 9,
        display: 'Cm(maj9)/Eb',
      },
      analysis: { romanNumeral: 'i(maj9)6' },
    },
    {
      id: 'a1-h2',
      measureId: 'a1-m1',
      offset: { numerator: 1, denominator: 4 },
      chord: { root: { step: 'B', alter: 0 }, quality: 'diminished', extension: 7 },
      analysis: { romanNumeral: 'viio7/V' },
    },
    {
      id: 'a1-h3',
      measureId: 'a1-m1',
      offset: { numerator: 1, denominator: 2 },
      chord: {
        root: { step: 'G', alter: 0 },
        quality: 'dominant',
        extension: 13,
        alterations: ['b9', '#11'],
      },
      analysis: { romanNumeral: 'V13(b9#11)' },
    },
    {
      id: 'a1-h4',
      measureId: 'a1-m2',
      chord: { root: { step: 'C', alter: 0 }, quality: 'minor' },
      analysis: { romanNumeral: 'i' },
    },
  ],
  dynamics: [
    { id: 'a1-d1', type: 'mark', eventId: 'a1-lh-1', marking: 'mf' },
    { id: 'a1-d2', type: 'mark', eventId: 'a1-lh-6', marking: 'pp' },
    {
      id: 'a1-d3',
      type: 'hairpin',
      direction: 'crescendo',
      startEventId: 'a1-lh-1',
      endEventId: 'a1-lh-4',
    },
    { id: 'a1-d4', type: 'mark', eventId: 'a1-lh-5', marking: 'ff' },
    { id: 'a1-d5', type: 'mark', eventId: 'a1-rh-1', marking: 'fff' },
    {
      id: 'a1-d6',
      type: 'hairpin',
      direction: 'diminuendo',
      startEventId: 'a1-rh-1',
      endEventId: 'a1-rh-4',
    },
    { id: 'a1-d7', type: 'mark', eventId: 'a1-lh-8', marking: 'f' },
    {
      id: 'a1-d8',
      type: 'hairpin',
      direction: 'diminuendo',
      startEventId: 'a1-lh-8',
      endEventId: 'a1-lh-11',
    },
  ],
  pedal: [
    { id: 'a1-p1', type: 'sustain', startEventId: 'a1-lh-1', endEventId: 'a1-lh-4' },
    { id: 'a1-p2', type: 'sustain', startEventId: 'a1-lh-5', endEventId: 'a1-lh-5' },
    { id: 'a1-p3', type: 'sustain', startEventId: 'a1-lh-8', endEventId: 'a1-lh-8' },
    { id: 'a1-p4', type: 'sustain', startEventId: 'a1-lh-9', endEventId: 'a1-lh-12' },
  ],
  scaleDegrees: [
    { id: 'a1-sd1', noteId: 'a1-lh-1', degree: 3, alter: -1, display: 'b3' },
    { id: 'a1-sd2', noteId: 'a1-lh-6', degree: 1 },
    { id: 'a1-sd3', noteId: 'a1-lh-2', degree: 5 },
    { id: 'a1-sd4', noteId: 'a1-lh-3', degree: 6, alter: -1, display: 'b6' },
    { id: 'a1-sd5', noteId: 'a1-lh-4', degree: 7, alter: 1, display: '#7' },
    { id: 'a1-sd6', noteId: 'a1-rh-2', degree: 6, alter: -1, display: 'b6' },
    { id: 'a1-sd7', noteId: 'a1-lh-12', degree: 1 },
  ],
  slurs: [{ id: 'a1-s1', startNoteId: 'a1-lh-8', endNoteId: 'a1-lh-11' }],
});

const BASS_LINE = ['C2', 'G2', 'E2', 'A2', 'F2', 'B1', 'D2', 'G1'];
const ROMANS = ['I', 'V6/4', 'vi', 'iii6', 'IV', 'viiø7/V', 'V7sus4', 'V7(b9)/vi'];
const CHORDS = ['C', 'G/D', 'Am', 'Em/G', 'F', 'F#ø7', 'G7sus4', 'E7(b9)'];

/** A pedal change, a chord symbol, a Roman numeral and a scale degree on every beat of two bars. */
export const PEDAL_EVERY_BEAT: ScoreSpecInput = score({
  id: 'a2',
  keySignature: { fifths: 0 },
  tonalContext: { tonic: { step: 'C', alter: 0 }, mode: 'major' },
  staves: [
    staff(
      'a2-rh',
      'right',
      [0, 1].map((m) =>
        bar(`a2-m${m + 1}`, m + 1, [
          voice(
            `a2-rh-v${m}`,
            ['E5', 'D5', 'C5', 'B4'].map((pitch, b) => note(`a2-rh-${m}-${b}`, pitch, 'quarter')),
          ),
        ]),
      ),
      'treble',
    ),
    staff(
      'a2-lh',
      'left',
      [0, 1].map((m) =>
        bar(`a2-m${m + 1}`, m + 1, [
          voice(
            `a2-lh-v${m}`,
            [0, 1, 2, 3].map((b) =>
              note(
                `a2-lh-${m}-${b}`,
                BASS_LINE[m * 4 + b] ?? 'C2',
                'quarter',
                b === 0 ? { fingering: 5 } : {},
              ),
            ),
          ),
        ]),
      ),
      'bass',
    ),
  ],
  harmony: [0, 1].flatMap((m) =>
    [0, 1, 2, 3].map((b) => ({
      id: `a2-h-${m}-${b}`,
      measureId: `a2-m${m + 1}`,
      ...(b === 0 ? {} : { offset: { numerator: b, denominator: 4 } }),
      chord: { root: { step: 'C' as const, alter: 0 as const }, display: CHORDS[m * 4 + b] ?? 'C' },
      analysis: { romanNumeral: ROMANS[m * 4 + b] ?? 'I' },
    })),
  ),
  dynamics: [
    { id: 'a2-d1', type: 'mark', eventId: 'a2-lh-0-0', marking: 'p' },
    {
      id: 'a2-d2',
      type: 'hairpin',
      direction: 'crescendo',
      startEventId: 'a2-lh-0-1',
      endEventId: 'a2-lh-0-3',
    },
    { id: 'a2-d3', type: 'mark', eventId: 'a2-lh-1-0', marking: 'f' },
  ],
  pedal: [0, 1].flatMap((m) =>
    [0, 1, 2, 3].map((b) => ({
      id: `a2-p-${m}-${b}`,
      type: 'sustain' as const,
      startEventId: `a2-lh-${m}-${b}`,
      endEventId: `a2-lh-${m}-${b}`,
    })),
  ),
  scaleDegrees: [0, 1].flatMap((m) =>
    [0, 1, 2, 3].map((b) => ({
      id: `a2-sd-${m}-${b}`,
      noteId: `a2-lh-${m}-${b}`,
      degree: ((m * 4 + b) % 7) + 1,
    })),
  ),
});

/**
 * Six bars, so every width breaks into systems: low ledger-line notes in two
 * voices on the bass staff (the first voice below the second in bar 2) with
 * fingerings, two rows of dynamic marks, a crescendo and pedal spans across
 * systems, degrees and Roman numerals; then very high treble notes with
 * chord symbols, fingerings and teaching colors (an annotation band).
 */
export const TALL_STACK: ScoreSpecInput = score({
  id: 'a3',
  keySignature: { fifths: 2 },
  tonalContext: { tonic: { step: 'D', alter: 0 }, mode: 'major' },
  staves: [
    staff(
      'a3-rh',
      'right',
      [
        bar('a3-m1', 1, [voice('a3-rh-v1', [note('a3-rh-1', 'D4', 'whole')])]),
        bar('a3-m2', 2, [voice('a3-rh-v2', [note('a3-rh-2', 'F#4', 'whole')])]),
        bar('a3-m3', 3, [voice('a3-rh-v3', [rest('a3-rh-3', 'whole')])]),
        bar('a3-m4', 4, [
          voice('a3-rh-v4', [
            note('a3-rh-4', 'D7', 'quarter', { fingering: 5, articulations: ['marcato'] }),
            note('a3-rh-5', 'C#7', 'quarter', { fingering: 4 }),
            note('a3-rh-6', 'A6', 'half', { fingering: 2, articulations: ['accent'] }),
          ]),
        ]),
        bar('a3-m5', 5, [
          voice('a3-rh-v5', [
            chord(
              'a3-rh-c',
              [
                member('a3-rh-c-f', 'F#6'),
                member('a3-rh-c-a', 'A6'),
                member('a3-rh-c-d', 'D7', { fingering: 5 }),
              ],
              'whole',
            ),
          ]),
        ]),
        bar('a3-m6', 6, [voice('a3-rh-v6', [note('a3-rh-7', 'D6', 'whole')])]),
      ],
      'treble',
    ),
    staff(
      'a3-lh',
      'left',
      [
        bar('a3-m1', 1, [
          voice('a3-lh-v1', [
            note('a3-lh-1', 'D2', 'half', { fingering: 5 }),
            note('a3-lh-2', 'F#2', 'half', { fingering: 3 }),
          ]),
          voice('a3-lh-v2', [note('a3-lh-3', 'D1', 'whole', { fingering: 5 })]),
        ]),
        bar('a3-m2', 2, [
          voice('a3-lh-v3', [
            note('a3-lh-4', 'A0', 'quarter', { fingering: 5 }),
            note('a3-lh-5', 'B0', 'quarter'),
            note('a3-lh-6', 'C#1', 'quarter'),
            note('a3-lh-7', 'D1', 'quarter', { fingering: 1 }),
          ]),
          voice('a3-lh-v4', [note('a3-lh-8', 'A2', 'whole')]),
        ]),
        bar('a3-m3', 3, [voice('a3-lh-v5', [note('a3-lh-9', 'E1', 'whole', { fingering: 5 })])]),
        bar('a3-m4', 4, [voice('a3-lh-v6', [note('a3-lh-10', 'D3', 'whole')])]),
        bar('a3-m5', 5, [voice('a3-lh-v7', [note('a3-lh-11', 'A2', 'whole')])]),
        bar('a3-m6', 6, [voice('a3-lh-v8', [note('a3-lh-12', 'D2', 'whole')])]),
      ],
      'bass',
    ),
  ],
  harmony: [
    {
      id: 'a3-h1',
      measureId: 'a3-m1',
      chord: { root: { step: 'D', alter: 0 }, quality: 'major' },
      analysis: { romanNumeral: 'I' },
    },
    {
      id: 'a3-h2',
      measureId: 'a3-m2',
      chord: { root: { step: 'D', alter: 0 }, display: 'D/F#' },
      analysis: { romanNumeral: 'I6' },
    },
    {
      id: 'a3-h3',
      measureId: 'a3-m3',
      chord: { root: { step: 'E', alter: 0 }, quality: 'minor', extension: 7 },
      analysis: { romanNumeral: 'ii7' },
    },
    {
      id: 'a3-h4',
      measureId: 'a3-m4',
      chord: {
        root: { step: 'A', alter: 0 },
        quality: 'dominant',
        extension: 13,
        alterations: ['b9', '#11'],
      },
      analysis: { romanNumeral: 'V13' },
    },
    {
      id: 'a3-h5',
      measureId: 'a3-m5',
      chord: { root: { step: 'D', alter: 0 }, quality: 'major', extension: 7 },
      analysis: { romanNumeral: 'Imaj7' },
    },
    {
      id: 'a3-h6',
      measureId: 'a3-m6',
      chord: { root: { step: 'D', alter: 0 }, quality: 'major' },
      analysis: { romanNumeral: 'I' },
    },
  ],
  dynamics: [
    { id: 'a3-d1', type: 'mark', eventId: 'a3-lh-1', marking: 'mp' },
    { id: 'a3-d2', type: 'mark', eventId: 'a3-lh-3', marking: 'pp' },
    {
      id: 'a3-d3',
      type: 'hairpin',
      direction: 'crescendo',
      startEventId: 'a3-lh-4',
      endEventId: 'a3-lh-9',
    },
    { id: 'a3-d4', type: 'mark', eventId: 'a3-rh-4', marking: 'ff' },
    { id: 'a3-d5', type: 'mark', eventId: 'a3-lh-10', marking: 'f' },
  ],
  pedal: [
    { id: 'a3-p1', type: 'sustain', startEventId: 'a3-lh-1', endEventId: 'a3-lh-2' },
    { id: 'a3-p2', type: 'sustain', startEventId: 'a3-lh-4', endEventId: 'a3-lh-10' },
    { id: 'a3-p3', type: 'sustain', startEventId: 'a3-lh-11', endEventId: 'a3-lh-12' },
  ],
  scaleDegrees: [
    { id: 'a3-sd1', noteId: 'a3-lh-3', degree: 1 },
    { id: 'a3-sd2', noteId: 'a3-lh-4', degree: 5 },
    { id: 'a3-sd3', noteId: 'a3-lh-9', degree: 2 },
    { id: 'a3-sd4', noteId: 'a3-rh-4', degree: 1 },
  ],
  annotations: [
    {
      id: 'a3-a1',
      color: '#e11d48',
      noteIds: ['a3-rh-4', 'a3-rh-5'],
      text: 'Top voice leading tone',
    },
    { id: 'a3-a2', color: '#2563eb', noteIds: ['a3-lh-3'], text: 'Low pedal point' },
  ],
});

/**
 * The teaching case: a scale degree on every member of two chords (C-E-G as
 * 1-3-5, B-D-F-G as 7-2-4-5), a crescendo into "f" and a diminuendo into "pp".
 */
export const CHORD_DEGREES: ScoreSpecInput = score({
  id: 'a4',
  keySignature: { fifths: 0 },
  tonalContext: { tonic: { step: 'C', alter: 0 }, mode: 'major' },
  staves: [
    staff(
      'a4-rh',
      'right',
      [
        bar('a4-m1', 1, [
          voice('a4-rh-v1', [
            chord(
              'a4-c1',
              [member('a4-c1-c', 'C4'), member('a4-c1-e', 'E4'), member('a4-c1-g', 'G4')],
              'half',
            ),
            chord(
              'a4-c2',
              [
                member('a4-c2-b', 'B3'),
                member('a4-c2-d', 'D4'),
                member('a4-c2-f', 'F4'),
                member('a4-c2-g', 'G4'),
              ],
              'half',
            ),
          ]),
        ]),
      ],
      'treble',
    ),
    staff(
      'a4-lh',
      'left',
      [
        bar('a4-m1', 1, [
          voice('a4-lh-v1', [
            note('a4-lh-1', 'C3', 'quarter'),
            note('a4-lh-2', 'E3', 'quarter'),
            note('a4-lh-3', 'G2', 'quarter'),
            note('a4-lh-4', 'C3', 'quarter'),
          ]),
        ]),
      ],
      'bass',
    ),
  ],
  dynamics: [
    {
      id: 'a4-d1',
      type: 'hairpin',
      direction: 'crescendo',
      startEventId: 'a4-lh-1',
      endEventId: 'a4-lh-2',
    },
    { id: 'a4-d2', type: 'mark', eventId: 'a4-lh-3', marking: 'f' },
    {
      id: 'a4-d3',
      type: 'hairpin',
      direction: 'diminuendo',
      startEventId: 'a4-c1',
      endEventId: 'a4-c1',
    },
    { id: 'a4-d4', type: 'mark', eventId: 'a4-c2', marking: 'pp' },
  ],
  scaleDegrees: [
    { id: 'a4-sd1', noteId: 'a4-c1-c', degree: 1 },
    { id: 'a4-sd2', noteId: 'a4-c1-e', degree: 3 },
    { id: 'a4-sd3', noteId: 'a4-c1-g', degree: 5 },
    { id: 'a4-sd4', noteId: 'a4-c2-b', degree: 7 },
    { id: 'a4-sd5', noteId: 'a4-c2-d', degree: 2 },
    { id: 'a4-sd6', noteId: 'a4-c2-f', degree: 4 },
    { id: 'a4-sd7', noteId: 'a4-c2-g', degree: 5 },
  ],
});
