/**
 * F01-F10 of the fixture catalogue (docs/testing/TEST_PLAN.md §4). Every
 * export is a valid ScoreSpec v1 input unless its name says otherwise, and is
 * deep-frozen: derive variants with cloneFixture. Independent numeric
 * expectations live in ./oracles.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import {
  bar,
  chord,
  cloneFixture,
  dur,
  frozen,
  member,
  note,
  rest,
  score,
  staff,
  tup,
  voice,
} from './builders';

/** F01: 4/4, C4-D4-E4-F4 quarters on one staff. */
export const F01: ScoreSpecInput = frozen(
  score({
    id: 'f01',
    metadata: { title: 'F01 four quarters' },
    staves: [
      staff(
        'f01-rh',
        'right',
        [
          bar('f01-m1', 1, [
            voice('f01-rh-m1-v1', [
              note('f01-n1', 'C4', 'quarter'),
              note('f01-n2', 'D4', 'quarter'),
              note('f01-n3', 'E4', 'quarter'),
              note('f01-n4', 'F4', 'quarter'),
            ]),
          ]),
        ],
        'treble',
      ),
    ],
  }),
);

/** F02: two aligned hands over two shared bars; a C4-E4-G4 chord with addressable members. */
export const F02: ScoreSpecInput = frozen(
  score({
    id: 'f02',
    metadata: { title: 'F02 two hands' },
    staves: [
      staff(
        'f02-rh',
        'right',
        [
          bar('f02-m1', 1, [
            voice('f02-rh-m1-v1', [
              chord(
                'f02-c1',
                [member('f02-c1-c', 'C4'), member('f02-c1-e', 'E4'), member('f02-c1-g', 'G4')],
                'half',
              ),
              note('f02-rh-n1', 'F4', 'quarter'),
              note('f02-rh-n2', 'E4', 'quarter'),
            ]),
          ]),
          bar('f02-m2', 2, [voice('f02-rh-m2-v1', [note('f02-rh-n3', 'C5', 'whole')])]),
        ],
        'treble',
      ),
      staff(
        'f02-lh',
        'left',
        [
          bar('f02-m1', 1, [
            voice('f02-lh-m1-v1', [
              note('f02-lh-n1', 'C3', 'quarter'),
              note('f02-lh-n2', 'G2', 'quarter'),
              note('f02-lh-n3', 'C3', 'half'),
            ]),
          ]),
          bar('f02-m2', 2, [voice('f02-lh-m2-v1', [note('f02-lh-n4', 'C3', 'whole')])]),
        ],
        'bass',
      ),
    ],
  }),
);

/** F03: ii-V-I in C with chord symbols, Roman analysis, scale degrees and fingerings. */
export const F03: ScoreSpecInput = frozen(
  score({
    id: 'f03',
    metadata: { title: 'F03 ii-V-I in C', tags: ['harmony', 'ii-v-i'] },
    keySignature: { fifths: 0 },
    tonalContext: { tonic: { step: 'C', alter: 0 }, mode: 'major' },
    staves: [
      staff(
        'f03-rh',
        'right',
        [
          bar('f03-m1', 1, [
            voice('f03-rh-m1-v1', [
              note('f03-rh-n1', 'F4', 'quarter', { fingering: 4 }),
              note('f03-rh-n2', 'E4', 'quarter', { fingering: 3 }),
              note('f03-rh-n3', 'D4', 'quarter', { fingering: 2 }),
              note('f03-rh-n4', 'B3', 'quarter', { fingering: 1 }),
            ]),
          ]),
          bar('f03-m2', 2, [
            voice('f03-rh-m2-v1', [note('f03-rh-n5', 'C4', 'whole', { fingering: 2 })]),
          ]),
        ],
        'treble',
      ),
      staff(
        'f03-lh',
        'left',
        [
          bar('f03-m1', 1, [
            voice('f03-lh-m1-v1', [
              chord(
                'f03-lh-c1',
                [
                  member('f03-lh-c1-d', 'D3'),
                  member('f03-lh-c1-f', 'F3'),
                  member('f03-lh-c1-a', 'A3'),
                  member('f03-lh-c1-c', 'C4'),
                ],
                'half',
              ),
              chord(
                'f03-lh-c2',
                [
                  member('f03-lh-c2-g', 'G2'),
                  member('f03-lh-c2-b', 'B2'),
                  member('f03-lh-c2-d', 'D3'),
                  member('f03-lh-c2-f', 'F3'),
                ],
                'half',
              ),
            ]),
          ]),
          bar('f03-m2', 2, [
            voice('f03-lh-m2-v1', [
              chord(
                'f03-lh-c3',
                [
                  member('f03-lh-c3-c', 'C3'),
                  member('f03-lh-c3-e', 'E3'),
                  member('f03-lh-c3-g', 'G3'),
                  member('f03-lh-c3-b', 'B3'),
                ],
                'whole',
              ),
            ]),
          ]),
        ],
        'bass',
      ),
    ],
    harmony: [
      {
        id: 'f03-h1',
        measureId: 'f03-m1',
        chord: { root: { step: 'D', alter: 0 }, quality: 'minor', extension: 7, display: 'Dm7' },
        analysis: { romanNumeral: 'ii7', function: 'predominant' },
      },
      {
        id: 'f03-h2',
        measureId: 'f03-m1',
        offset: { numerator: 1, denominator: 2 },
        chord: {
          root: { step: 'G', alter: 0 },
          quality: 'dominant',
          extension: 7,
          alterations: ['b9'],
          display: 'G7(b9)',
        },
        analysis: { romanNumeral: 'V7', function: 'dominant' },
      },
      {
        id: 'f03-h3',
        measureId: 'f03-m2',
        chord: { root: { step: 'C', alter: 0 }, quality: 'major', extension: 7, display: 'Cmaj7' },
        analysis: { romanNumeral: 'Imaj7', function: 'tonic' },
      },
    ],
    scaleDegrees: [
      { id: 'f03-sd1', noteId: 'f03-rh-n1', degree: 4 },
      { id: 'f03-sd2', noteId: 'f03-rh-n2', degree: 3 },
      { id: 'f03-sd3', noteId: 'f03-rh-n3', degree: 2 },
      { id: 'f03-sd4', noteId: 'f03-rh-n4', degree: 7 },
      { id: 'f03-sd5', noteId: 'f03-rh-n5', degree: 1 },
    ],
  }),
);

/** F04: 7/4 bar, local 6/8 bar, back to 7/4 (adjacent meter changes), two aligned hands. */
export const F04: ScoreSpecInput = frozen(
  score({
    id: 'f04',
    metadata: { title: 'F04 odd and local meters' },
    timeSignature: { numerator: 7, denominator: 4 },
    staves: [
      staff(
        'f04-rh',
        'right',
        [
          bar('f04-m1', 1, [
            voice('f04-rh-m1-v1', [
              note('f04-rh-n1', 'E4', 'half'),
              note('f04-rh-n2', 'F4', 'half'),
              note('f04-rh-n3', 'G4', dur('half', 1)),
            ]),
          ]),
          bar(
            'f04-m2',
            2,
            [
              voice('f04-rh-m2-v1', [
                note('f04-rh-n4', 'A4', dur('quarter', 1)),
                note('f04-rh-n5', 'G4', dur('quarter', 1)),
              ]),
            ],
            { timeSignature: { numerator: 6, denominator: 8 } },
          ),
          bar('f04-m3', 3, [
            voice('f04-rh-m3-v1', [
              note('f04-rh-n6', 'C5', 'whole'),
              note('f04-rh-n7', 'B4', dur('half', 1)),
            ]),
          ]),
        ],
        'treble',
      ),
      staff(
        'f04-lh',
        'left',
        [
          bar('f04-m1', 1, [
            voice('f04-lh-m1-v1', [
              note('f04-lh-n1', 'C3', 'whole'),
              note('f04-lh-n2', 'G2', dur('half', 1)),
            ]),
          ]),
          bar('f04-m2', 2, [voice('f04-lh-m2-v1', [note('f04-lh-n3', 'F2', dur('half', 1))])], {
            timeSignature: { numerator: 6, denominator: 8 },
          }),
          bar('f04-m3', 3, [
            voice('f04-lh-m3-v1', [
              note('f04-lh-n4', 'C3', 'whole'),
              note('f04-lh-n5', 'C3', dur('half', 1)),
            ]),
          ]),
        ],
        'bass',
      ),
    ],
  }),
);

/** F05: F#4 and Gb4 (same key, different spelling) with altered scale-degree labels #4 and b5. */
export const F05: ScoreSpecInput = frozen(
  score({
    id: 'f05',
    metadata: { title: 'F05 enharmonic spelling' },
    keySignature: { fifths: 0 },
    tonalContext: { tonic: { step: 'C', alter: 0 }, mode: 'major' },
    staves: [
      staff('f05-rh', 'right', [
        bar('f05-m1', 1, [
          voice('f05-rh-m1-v1', [note('f05-fs', 'F#4', 'half'), note('f05-gb', 'Gb4', 'half')]),
        ]),
      ]),
    ],
    scaleDegrees: [
      { id: 'f05-sd1', noteId: 'f05-fs', degree: 4, alter: 1, display: '#4' },
      { id: 'f05-sd2', noteId: 'f05-gb', degree: 5, alter: -1, display: 'b5' },
    ],
  }),
);

/** F06: eighth triplet (3:2), eighth quintuplet (5:4), then a sixteenth septuplet (7:4). */
export const F06: ScoreSpecInput = frozen(
  score({
    id: 'f06',
    metadata: { title: 'F06 tuplets' },
    staves: [
      staff('f06-rh', 'right', [
        bar('f06-m1', 1, [
          voice('f06-rh-m1-v1', [
            note('f06-n1', 'C5', tup('eighth', 'f06-t1')),
            note('f06-n2', 'D5', tup('eighth', 'f06-t1')),
            note('f06-n3', 'E5', tup('eighth', 'f06-t1')),
            note('f06-n4', 'F5', tup('eighth', 'f06-q1', 5, 4)),
            note('f06-n5', 'E5', tup('eighth', 'f06-q1', 5, 4)),
            note('f06-n6', 'D5', tup('eighth', 'f06-q1', 5, 4)),
            note('f06-n7', 'C5', tup('eighth', 'f06-q1', 5, 4)),
            note('f06-n8', 'B4', tup('eighth', 'f06-q1', 5, 4)),
            note('f06-n9', 'C5', 'quarter'),
          ]),
        ]),
        bar('f06-m2', 2, [
          voice('f06-rh-m2-v1', [
            note('f06-n10', 'C5', tup('sixteenth', 'f06-s1', 7, 4)),
            note('f06-n11', 'D5', tup('sixteenth', 'f06-s1', 7, 4)),
            note('f06-n12', 'E5', tup('sixteenth', 'f06-s1', 7, 4)),
            note('f06-n13', 'F5', tup('sixteenth', 'f06-s1', 7, 4)),
            note('f06-n14', 'G5', tup('sixteenth', 'f06-s1', 7, 4)),
            note('f06-n15', 'A5', tup('sixteenth', 'f06-s1', 7, 4)),
            note('f06-n16', 'B5', tup('sixteenth', 'f06-s1', 7, 4)),
            note('f06-n17', 'C6', dur('half', 1)),
          ]),
        ]),
      ]),
    ],
  }),
);

/** F07: quarter pickup, one full bar, final incomplete 3/4 bar; both hands share the short bars. */
export const F07: ScoreSpecInput = frozen(
  score({
    id: 'f07',
    metadata: { title: 'F07 pickup' },
    staves: [
      staff('f07-rh', 'right', [
        bar('f07-m1', 1, [voice('f07-rh-m1-v1', [note('f07-rh-n1', 'G4', 'quarter')])], {
          kind: 'pickup',
          actualDuration: { numerator: 1, denominator: 4 },
        }),
        bar('f07-m2', 2, [
          voice('f07-rh-m2-v1', [
            note('f07-rh-n2', 'C5', 'half'),
            note('f07-rh-n3', 'B4', 'quarter'),
            note('f07-rh-n4', 'A4', 'quarter'),
          ]),
        ]),
        bar('f07-m3', 3, [voice('f07-rh-m3-v1', [note('f07-rh-n5', 'G4', dur('half', 1))])], {
          kind: 'incomplete',
          actualDuration: { numerator: 3, denominator: 4 },
        }),
      ]),
      staff('f07-lh', 'left', [
        bar('f07-m1', 1, [voice('f07-lh-m1-v1', [rest('f07-lh-r1', 'quarter')])], {
          kind: 'pickup',
          actualDuration: { numerator: 1, denominator: 4 },
        }),
        bar('f07-m2', 2, [voice('f07-lh-m2-v1', [note('f07-lh-n1', 'C3', 'whole')])]),
        bar('f07-m3', 3, [voice('f07-lh-m3-v1', [note('f07-lh-n2', 'C3', dur('half', 1))])], {
          kind: 'incomplete',
          actualDuration: { numerator: 3, denominator: 4 },
        }),
      ]),
    ],
  }),
);

/**
 * F08: slur versus tie, fingerings, all four articulations, dynamics with
 * hairpins and two adjacent pedal spans. Bars 1 and 2 are the same notes,
 * slurred then unmarked (paired legato/unmarked comparison); bar 3 slurs a
 * repeated pitch that is NOT tied, next to a real tie.
 */
export const F08: ScoreSpecInput = frozen(
  score({
    id: 'f08',
    metadata: { title: 'F08 expression' },
    tempo: { bpm: 96 },
    staves: [
      staff('f08-rh', 'right', [
        bar('f08-m1', 1, [
          voice('f08-rh-m1-v1', [
            note('f08-rh-n1', 'C4', 'quarter', { fingering: 1 }),
            note('f08-rh-n2', 'D4', 'quarter', { fingering: 2 }),
            note('f08-rh-n3', 'E4', 'quarter', { fingering: 3 }),
            note('f08-rh-n4', 'F4', 'quarter', { fingering: 4 }),
          ]),
        ]),
        bar('f08-m2', 2, [
          voice('f08-rh-m2-v1', [
            note('f08-rh-n5', 'C4', 'quarter'),
            note('f08-rh-n6', 'D4', 'quarter'),
            note('f08-rh-n7', 'E4', 'quarter'),
            note('f08-rh-n8', 'F4', 'quarter'),
          ]),
        ]),
        bar('f08-m3', 3, [
          voice('f08-rh-m3-v1', [
            note('f08-rh-n9', 'G4', 'half', { articulations: ['accent'], tie: { start: true } }),
            note('f08-rh-n10', 'G4', 'quarter', { tie: { end: true } }),
            note('f08-rh-n11', 'G4', 'quarter'),
          ]),
        ]),
        bar('f08-m4', 4, [
          voice('f08-rh-m4-v1', [
            note('f08-rh-n12', 'C5', 'quarter', { articulations: ['accent'] }),
            note('f08-rh-n13', 'B4', 'quarter', { articulations: ['staccato'] }),
            note('f08-rh-n14', 'A4', 'quarter', { articulations: ['tenuto'] }),
            note('f08-rh-n15', 'G4', 'quarter', { articulations: ['marcato'] }),
          ]),
        ]),
      ]),
      staff('f08-lh', 'left', [
        bar('f08-m1', 1, [voice('f08-lh-m1-v1', [note('f08-lh-n1', 'C3', 'whole')])]),
        bar('f08-m2', 2, [voice('f08-lh-m2-v1', [note('f08-lh-n2', 'C3', 'whole')])]),
        bar('f08-m3', 3, [voice('f08-lh-m3-v1', [note('f08-lh-n3', 'G2', 'whole')])]),
        bar('f08-m4', 4, [
          voice('f08-lh-m4-v1', [note('f08-lh-n4', 'C3', 'half'), note('f08-lh-n5', 'G2', 'half')]),
        ]),
      ]),
    ],
    slurs: [
      { id: 'f08-s1', startNoteId: 'f08-rh-n1', endNoteId: 'f08-rh-n4' },
      { id: 'f08-s2', startNoteId: 'f08-rh-n10', endNoteId: 'f08-rh-n11' },
    ],
    dynamics: [
      { id: 'f08-d1', type: 'mark', eventId: 'f08-rh-n1', marking: 'p' },
      {
        id: 'f08-d2',
        type: 'hairpin',
        direction: 'crescendo',
        startEventId: 'f08-rh-n1',
        endEventId: 'f08-rh-n4',
      },
      { id: 'f08-d3', type: 'mark', eventId: 'f08-rh-n12', marking: 'f' },
      {
        id: 'f08-d4',
        type: 'hairpin',
        direction: 'diminuendo',
        startEventId: 'f08-rh-n12',
        endEventId: 'f08-rh-n15',
      },
    ],
    pedal: [
      { id: 'f08-p1', type: 'sustain', startEventId: 'f08-lh-n3', endEventId: 'f08-lh-n3' },
      { id: 'f08-p2', type: 'sustain', startEventId: 'f08-lh-n4', endEventId: 'f08-lh-n5' },
    ],
  }),
);

const F09_BASE = score({
  id: 'f09',
  metadata: { title: 'F09 teaching colors' },
  staves: [
    staff('f09-rh', 'right', [
      bar('f09-m1', 1, [
        voice('f09-rh-m1-v1', [
          note('f09-n1', 'C4', 'quarter'),
          note('f09-n2', 'E4', 'quarter'),
          note('f09-n3', 'G4', 'quarter'),
          note('f09-n4', 'C5', 'quarter'),
        ]),
      ]),
    ]),
  ],
  annotations: [
    {
      id: 'f09-a1',
      color: '#ff69b4',
      noteIds: ['f09-n1', 'f09-n2', 'f09-n3'],
      text: 'C major triad: root, third and fifth',
    },
  ],
});

/** F09: three pink notes with matching explanatory text. */
export const F09: ScoreSpecInput = frozen(F09_BASE);

/** F09 negative: a second, blue annotation also targets f09-n3 (P-03 conflict). INVALID. */
export const F09_COLOR_CONFLICT: ScoreSpecInput = frozen({
  ...cloneFixture(F09_BASE),
  annotations: [
    ...cloneFixture(F09_BASE.annotations),
    { id: 'f09-a2', color: '#1e90ff', noteIds: ['f09-n3', 'f09-n4'], text: 'Fifth and octave' },
  ],
});

/** F09 overlap: the second annotation uses the same color spelled differently ("HotPink"). Valid. */
export const F09_SAME_COLOR_OVERLAP: ScoreSpecInput = frozen({
  ...cloneFixture(F09_BASE),
  annotations: [
    ...cloneFixture(F09_BASE.annotations),
    { id: 'f09-a2', color: 'HotPink', noteIds: ['f09-n3', 'f09-n4'], text: 'Fifth and octave' },
  ],
});

const f10 = (playbackFeel?: ScoreSpecInput['playbackFeel']): ScoreSpecInput =>
  frozen(
    score({
      id: 'f10',
      metadata: { title: 'F10 eighths' },
      ...(playbackFeel === undefined ? {} : { playbackFeel }),
      staves: [
        staff('f10-rh', 'right', [
          bar('f10-m1', 1, [
            voice('f10-rh-m1-v1', [
              note('f10-n1', 'C4', 'eighth'),
              note('f10-n2', 'D4', 'eighth'),
              note('f10-n3', 'E4', 'eighth'),
              note('f10-n4', 'F4', 'eighth'),
              note('f10-n5', 'G4', 'eighth'),
              note('f10-n6', 'A4', 'eighth'),
              note('f10-n7', 'B4', 'eighth'),
              note('f10-n8', 'C5', 'eighth'),
            ]),
          ]),
        ]),
      ],
    }),
  );

/** F10: eight written eighths with no playbackFeel (straight). */
export const F10: ScoreSpecInput = f10();
/** F10 with swing requested and no ratio/subdivision: P-02 defaults (eighth, 2:1). */
export const F10_SWING_DEFAULT: ScoreSpecInput = f10({ type: 'swing' });
/** F10 with an explicit 2:1 eighth swing. */
export const F10_SWING_2_1: ScoreSpecInput = f10({
  type: 'swing',
  subdivision: 'eighth',
  ratio: { long: 2, short: 1 },
});
/** F10 with an explicit 3:2 eighth swing (explicit ratio overrides the default). */
export const F10_SWING_3_2: ScoreSpecInput = f10({
  type: 'swing',
  subdivision: 'eighth',
  ratio: { long: 3, short: 2 },
  displayText: 'Light swing',
});
