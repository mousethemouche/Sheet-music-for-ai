/**
 * OPS-05 (issue #3): transposition under the documented key-aware spelling
 * policy (SCORE_OPERATIONS_V1.md). C4-E4-G4 +2 in C is D4-F#4-A4. Descending,
 * octave, range and tied-member cases are distinct branches. IDs and every
 * untouched field are preserved; chord symbols, Roman numerals, scale degrees
 * and the key never become silently stale: a whole-score shift moves them
 * with the music, a partial shift must remove or replace them explicitly.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import {
  F02,
  F03,
  RICH_WIRE_FIXTURE,
  bar,
  chord,
  frozen,
  member,
  note,
  parseFixture,
  score,
  staff,
  voice,
} from '../src';
import { editError, edited, expectedAfter, setPitches, spellings } from './ops-support';
import { at, eventPath, summarize } from './support';

const f02 = parseFixture(F02);
const f03 = parseFixture(F03);

/** A G4 chord member tied across the bar line into a G4 whole note. */
const TIED: ScoreSpecInput = frozen(
  score({
    id: 'tie',
    staves: [
      staff('tie-rh', 'right', [
        bar('tie-m1', 1, [
          voice('tie-m1-v1', [
            note('tie-n1', 'C4', 'half'),
            chord(
              'tie-c1',
              [member('tie-c1-e', 'E4'), member('tie-c1-g', 'G4', { tie: { start: true } })],
              'half',
            ),
          ]),
        ]),
        bar('tie-m2', 2, [
          voice('tie-m2-v1', [note('tie-n2', 'G4', 'whole', { tie: { end: true } })]),
        ]),
      ]),
    ],
  }),
);

const wholeScore = (semitones: number) => ({ type: 'transpose', semitones, target: {} });

describe('OPS-05 transposition', () => {
  it('transposes C4-E4-G4 up 2 semitones to D4-F#4-A4 and keeps every ID', () => {
    const result = edited(f02, [wholeScore(2)]);
    expect(result).toEqual(
      expectedAfter(f02, (d) => {
        setPitches(d, {
          'f02-c1-c': 'D4',
          'f02-c1-e': 'F#4',
          'f02-c1-g': 'A4',
          'f02-rh-n1': 'G4',
          'f02-rh-n2': 'F#4',
          'f02-rh-n3': 'D5',
          'f02-lh-n1': 'D3',
          'f02-lh-n2': 'A2',
          'f02-lh-n3': 'D3',
          'f02-lh-n4': 'D3',
        });
      }),
    );
  });

  it('transposes down 3 semitones by a minor third (C major to A major spelling)', () => {
    const result = edited(f02, [wholeScore(-3)]);
    expect(spellings(result, 0)).toEqual(['A3+C#4+E4', 'D4', 'C#4', 'A4']);
    expect(spellings(result, 1)).toEqual(['A2', 'E2', 'A2', 'A2']);
  });

  it.each([
    {
      name: '+1 in C is spelled up to Db',
      operations: [wholeScore(1)],
      chord: 'Db4+F4+Ab4',
      keySignature: undefined,
    },
    {
      name: '+1 in Bb is spelled up to B (5 sharps rather than 7 flats)',
      operations: [{ type: 'set_key_signature', keySignature: { fifths: -2 } }, wholeScore(1)],
      chord: 'C#4+E#4+G#4',
      keySignature: { fifths: 5 },
    },
    {
      name: '+6 in C picks the flat key on a tie (Gb, not F#)',
      operations: [{ type: 'set_key_signature', keySignature: { fifths: 0 } }, wholeScore(6)],
      chord: 'Gb4+Bb4+Db5',
      keySignature: { fifths: -6 },
    },
  ])('spells from the key: $name', ({ operations, chord: expectedChord, keySignature }) => {
    const result = edited(f02, operations);
    expect(spellings(result, 0)[0]).toBe(expectedChord);
    expect(result.keySignature).toEqual(keySignature);
  });

  it('moves one staff by an octave and keeps its harmony and scale-degree labels', () => {
    const result = edited(f03, [
      { type: 'transpose', semitones: 12, target: { staffIds: ['f03-rh'] } },
    ]);
    expect(result).toEqual(
      expectedAfter(f03, (d) => {
        setPitches(d, {
          'f03-rh-n1': 'F5',
          'f03-rh-n2': 'E5',
          'f03-rh-n3': 'D5',
          'f03-rh-n4': 'B4',
          'f03-rh-n5': 'C5',
        });
      }),
    );
  });

  it('rejects a shift that leaves the piano range and names the notes', () => {
    const error = editError(f02, [
      { type: 'transpose', semitones: -24, target: { staffIds: ['f02-lh'] } },
    ]);
    expect(summarize(error)).toEqual({
      code: 'INVALID_OPERATION',
      details: [
        { code: 'PITCH_OUT_OF_RANGE', path: ['operations', 0, 'semitones'], ids: ['f02-lh-n2'] },
      ],
    });
  });

  it('keeps a tie from a chord member when both tied notes move', () => {
    const tied = parseFixture(TIED);
    expect(edited(tied, [wholeScore(2)])).toEqual(
      expectedAfter(tied, (d) => {
        setPitches(d, { 'tie-n1': 'D4', 'tie-c1-e': 'F#4', 'tie-c1-g': 'A4', 'tie-n2': 'A4' });
      }),
    );
  });

  it('rejects a selection that moves only one end of a tie', () => {
    const tied = parseFixture(TIED);
    const error = editError(tied, [
      { type: 'transpose', semitones: 2, target: { measureIds: ['tie-m1'] } },
    ]);
    expect(summarize(error)).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        {
          code: 'TIE_UNMATCHED',
          path: [...eventPath(0, 0, 0, 1), 'notes', 1, 'tie'],
          ids: ['tie-c1-g'],
        },
        { code: 'TIE_UNMATCHED', path: [...eventPath(0, 1, 0, 0), 'tie'], ids: ['tie-n2'] },
      ],
    });
  });

  it('moves key, tonal context and chord symbols with a whole-score shift; Roman numerals and degrees stay', () => {
    const result = edited(f03, [wholeScore(2)]);
    expect(result).toEqual(
      expectedAfter(f03, (d) => {
        d.keySignature = { fifths: 2 };
        d.tonalContext = { tonic: { step: 'D', alter: 0 }, mode: 'major' };
        setPitches(d, {
          'f03-rh-n1': 'G4',
          'f03-rh-n2': 'F#4',
          'f03-rh-n3': 'E4',
          'f03-rh-n4': 'C#4',
          'f03-rh-n5': 'D4',
          'f03-lh-c1-d': 'E3',
          'f03-lh-c1-f': 'G3',
          'f03-lh-c1-a': 'B3',
          'f03-lh-c1-c': 'D4',
          'f03-lh-c2-g': 'A2',
          'f03-lh-c2-b': 'C#3',
          'f03-lh-c2-d': 'E3',
          'f03-lh-c2-f': 'G3',
          'f03-lh-c3-c': 'D3',
          'f03-lh-c3-e': 'F#3',
          'f03-lh-c3-g': 'A3',
          'f03-lh-c3-b': 'C#4',
        });
        const [h1, h2, h3] = [at(d.harmony, 0), at(d.harmony, 1), at(d.harmony, 2)];
        h1.chord = {
          root: { step: 'E', alter: 0 },
          quality: 'minor',
          extension: 7,
          display: 'Em7',
        };
        h2.chord = {
          root: { step: 'A', alter: 0 },
          quality: 'dominant',
          extension: 7,
          alterations: ['b9'],
          display: 'A7(b9)',
        };
        h3.chord = {
          root: { step: 'D', alter: 0 },
          quality: 'major',
          extension: 7,
          display: 'Dmaj7',
        };
      }),
    );
  });

  it('rewrites a slash-chord display with its bass', () => {
    const rich = parseFixture(RICH_WIRE_FIXTURE);
    const result = edited(rich, [wholeScore(2)]);
    expect(result.keySignature).toEqual({ fifths: 3 });
    expect(result.harmony?.map((harmony) => harmony.chord)).toEqual([
      { root: { step: 'A', alter: 0 }, quality: 'major', extension: 7, display: 'Amaj7' },
      { root: { step: 'B', alter: 0 }, quality: 'minor', extension: 7 },
      {
        root: { step: 'E', alter: 0 },
        quality: 'dominant',
        extension: 7,
        alterations: ['b9'],
        display: 'E7(b9)',
      },
      {
        root: { step: 'A', alter: 0 },
        quality: 'major',
        bass: { step: 'C', alter: 1 },
        display: 'A/C#',
      },
    ]);
  });

  it('rejects a chord display it cannot rewrite', () => {
    const error = editError(f03, [
      {
        type: 'set_chord_symbol',
        harmonyId: 'f03-h1',
        chord: { root: { step: 'D', alter: 0 }, quality: 'minor', extension: 7, display: 'Dm7/C' },
      },
      wholeScore(2),
    ]);
    expect(summarize(error)).toEqual({
      code: 'INVALID_OPERATION',
      details: [{ code: 'OPERATION_INVALID', path: ['operations', 1, 'target'], ids: ['f03-h1'] }],
    });
  });

  it('rejects a partial shift that would leave harmony and scale degrees stale', () => {
    const error = editError(f03, [
      { type: 'transpose', semitones: 2, target: { measureIds: ['f03-m1'] } },
    ]);
    const stale = ['f03-h1', 'f03-h2', 'f03-sd1', 'f03-sd2', 'f03-sd3', 'f03-sd4'];
    expect(summarize(error)).toEqual({
      code: 'INVALID_OPERATION',
      details: stale.map((id) => ({
        code: 'OPERATION_INVALID',
        path: ['operations', 0, 'target'],
        ids: [id],
      })),
    });
  });

  it('accepts that partial shift once the batch removes the stale labels first', () => {
    const result = edited(f03, [
      { type: 'remove_chord_symbol', harmonyId: 'f03-h1' },
      { type: 'remove_harmonic_analysis', harmonyId: 'f03-h1' },
      { type: 'remove_chord_symbol', harmonyId: 'f03-h2' },
      { type: 'remove_harmonic_analysis', harmonyId: 'f03-h2' },
      ...['f03-sd1', 'f03-sd2', 'f03-sd3', 'f03-sd4'].map((scaleDegreeId) => ({
        type: 'remove_scale_degree',
        scaleDegreeId,
      })),
      { type: 'transpose', semitones: 2, target: { measureIds: ['f03-m1'] } },
    ]);
    expect(spellings(result, 0)).toEqual(['G4', 'F#4', 'E4', 'C#4', 'C4']);
    expect(result.keySignature).toEqual({ fifths: 0 });
    expect(result.harmony?.map((harmony) => harmony.id)).toEqual(['f03-h3']);
    expect(result.scaleDegrees?.map((label) => label.id)).toEqual(['f03-sd5']);
  });
});
