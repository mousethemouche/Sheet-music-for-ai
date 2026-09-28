/**
 * One small rich wire fixture (TEST_PLAN §4) combining two staves, chords,
 * triplets under swing, pedal over a tied chord member, a chord member with
 * fingering and a teaching color, chord symbols with Roman analysis and scale
 * degrees, dynamics with hairpins, slurs, all four articulations, a pickup, a
 * local meter and an incomplete final bar. It is written in canonical form
 * (explicit clefs, lowercase "#rrggbb" colors), so validation returns it
 * unchanged. Used for serialization round-trips and adapter checks.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import { bar, chord, dur, frozen, member, note, rest, score, staff, tup, voice } from './builders';

export const RICH_WIRE_FIXTURE: ScoreSpecInput = frozen(
  score({
    id: 'rich',
    revision: 3,
    metadata: { title: 'Rich wire fixture: ii-V-I in G', tags: ['jazz', 'ii-v-i', 'fixture'] },
    tempo: { bpm: 132 },
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: { fifths: 1 },
    tonalContext: { tonic: { step: 'G', alter: 0 }, mode: 'major' },
    playbackFeel: {
      type: 'swing',
      subdivision: 'eighth',
      ratio: { long: 2, short: 1 },
      displayText: 'Swing',
    },
    staves: [
      staff(
        'rich-rh',
        'right',
        [
          bar(
            'rich-m1',
            1,
            [
              voice('rich-rh-m1-v1', [
                note('rich-rh-n1', 'B4', 'eighth', { fingering: 2 }),
                note('rich-rh-n2', 'C5', 'eighth', { fingering: 3 }),
              ]),
            ],
            { kind: 'pickup', actualDuration: { numerator: 1, denominator: 4 } },
          ),
          bar('rich-m2', 2, [
            voice('rich-rh-m2-v1', [
              chord(
                'rich-rh-c1',
                [
                  member('rich-rh-c1-g', 'G4'),
                  member('rich-rh-c1-b', 'B4', { fingering: 3, articulations: ['accent'] }),
                  member('rich-rh-c1-d', 'D5', { tie: { start: true } }),
                ],
                'half',
              ),
              note('rich-rh-n3', 'D5', 'quarter', {
                articulations: ['staccato'],
                tie: { end: true },
              }),
              note('rich-rh-n4', 'E5', tup('eighth', 'rich-t1'), { articulations: ['tenuto'] }),
              note('rich-rh-n5', 'D5', tup('eighth', 'rich-t1')),
              note('rich-rh-n6', 'C5', tup('eighth', 'rich-t1'), { articulations: ['marcato'] }),
            ]),
          ]),
          bar(
            'rich-m3',
            3,
            [
              voice('rich-rh-m3-v1', [
                note('rich-rh-n7', 'B4', 'quarter'),
                note('rich-rh-n8', 'A4', 'quarter'),
                note('rich-rh-n9', 'G4', 'quarter'),
              ]),
            ],
            { timeSignature: { numerator: 3, denominator: 4 } },
          ),
          bar(
            'rich-m4',
            4,
            [
              voice('rich-rh-m4-v1', [
                chord(
                  'rich-rh-c2',
                  [member('rich-rh-c2-g', 'G4'), member('rich-rh-c2-b', 'B4')],
                  dur('half', 1),
                ),
              ]),
            ],
            { kind: 'incomplete', actualDuration: { numerator: 3, denominator: 4 } },
          ),
        ],
        'treble',
      ),
      staff(
        'rich-lh',
        'left',
        [
          bar('rich-m1', 1, [voice('rich-lh-m1-v1', [rest('rich-lh-r1', 'quarter')])], {
            kind: 'pickup',
            actualDuration: { numerator: 1, denominator: 4 },
          }),
          bar('rich-m2', 2, [
            voice('rich-lh-m2-v1', [
              note('rich-lh-n1', 'G2', 'half', { fingering: 5 }),
              note('rich-lh-n2', 'D3', 'half'),
            ]),
          ]),
          bar(
            'rich-m3',
            3,
            [
              voice('rich-lh-m3-v1', [
                note('rich-lh-n3', 'C3', 'half'),
                note('rich-lh-n4', 'D3', 'quarter'),
              ]),
            ],
            { timeSignature: { numerator: 3, denominator: 4 } },
          ),
          bar('rich-m4', 4, [voice('rich-lh-m4-v1', [note('rich-lh-n5', 'G2', dur('half', 1))])], {
            kind: 'incomplete',
            actualDuration: { numerator: 3, denominator: 4 },
          }),
        ],
        'bass',
      ),
    ],
    harmony: [
      {
        id: 'rich-h1',
        measureId: 'rich-m2',
        chord: { root: { step: 'G', alter: 0 }, quality: 'major', extension: 7, display: 'Gmaj7' },
        analysis: { romanNumeral: 'Imaj7', function: 'tonic' },
      },
      {
        id: 'rich-h2',
        measureId: 'rich-m3',
        chord: { root: { step: 'A', alter: 0 }, quality: 'minor', extension: 7 },
        analysis: { romanNumeral: 'ii7', function: 'predominant' },
      },
      {
        id: 'rich-h3',
        measureId: 'rich-m3',
        offset: { numerator: 1, denominator: 2 },
        chord: {
          root: { step: 'D', alter: 0 },
          quality: 'dominant',
          extension: 7,
          alterations: ['b9'],
          display: 'D7(b9)',
        },
        analysis: { romanNumeral: 'V7' },
      },
      {
        id: 'rich-h4',
        measureId: 'rich-m4',
        chord: {
          root: { step: 'G', alter: 0 },
          quality: 'major',
          bass: { step: 'B', alter: 0 },
          display: 'G/B',
        },
        analysis: { romanNumeral: 'I6' },
      },
    ],
    slurs: [{ id: 'rich-s1', startNoteId: 'rich-rh-n7', endNoteId: 'rich-rh-n9' }],
    dynamics: [
      { id: 'rich-d1', type: 'mark', eventId: 'rich-rh-c1', marking: 'mf' },
      {
        id: 'rich-d2',
        type: 'hairpin',
        direction: 'crescendo',
        startEventId: 'rich-rh-n4',
        endEventId: 'rich-rh-n6',
      },
      { id: 'rich-d3', type: 'mark', eventId: 'rich-lh-n1', marking: 'p' },
      {
        id: 'rich-d4',
        type: 'hairpin',
        direction: 'diminuendo',
        startEventId: 'rich-rh-n7',
        endEventId: 'rich-rh-n9',
      },
    ],
    pedal: [
      { id: 'rich-p1', type: 'sustain', startEventId: 'rich-lh-n1', endEventId: 'rich-lh-n2' },
    ],
    scaleDegrees: [
      { id: 'rich-sd1', noteId: 'rich-rh-n7', degree: 3 },
      { id: 'rich-sd2', noteId: 'rich-rh-n8', degree: 2 },
      { id: 'rich-sd3', noteId: 'rich-rh-n9', degree: 1 },
      { id: 'rich-sd4', noteId: 'rich-rh-n6', degree: 4, display: '4' },
    ],
    annotations: [
      {
        id: 'rich-a1',
        color: '#e91e63',
        noteIds: ['rich-rh-c1-b'],
        text: 'Third of the chord, played with finger 3',
      },
      {
        id: 'rich-a2',
        color: '#1e88e5',
        noteIds: ['rich-rh-n4', 'rich-rh-n5', 'rich-rh-n6'],
        text: 'Triplet run: written triplets are not swung twice',
      },
    ],
  }),
);
