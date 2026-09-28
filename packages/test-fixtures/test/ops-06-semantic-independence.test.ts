/**
 * OPS-06 (issue #3): semantic independence. Fingering and teaching color
 * target one chord member; chord symbol and Roman analysis are independent
 * parts of a harmony event; a slur changes phrasing, not written rhythm or
 * pitch; the playback feel never rewrites durations. Also the no-op and
 * repeated-removal policy of SCORE_OPERATIONS_V1.md. Reuses the dispatch
 * fixtures rather than a second music matrix.
 */
import { describe, expect, it } from 'vitest';
import { F02, F03, F08, F10, parseFixture } from '../src';
import { editError, edited, expectedAfter } from './ops-support';
import { summarize } from './support';

const f02 = parseFixture(F02);
const f03 = parseFixture(F03);
const f08 = parseFixture(F08);
const f10 = parseFixture(F10);

/** Members of F02's C4-E4-G4 chord in a result. */
function chordMembers(score: typeof f02) {
  const event = score.staves[0]?.measures[0]?.voices[0]?.events[0];
  if (event?.type !== 'chord') {
    throw new Error('F02 starts with a chord');
  }
  return event.notes;
}

describe('OPS-06 semantic independence', () => {
  it('sets a fingering on one chord member only', () => {
    const result = edited(f02, [{ type: 'set_fingering', noteId: 'f02-c1-e', fingering: 3 }]);
    expect(chordMembers(result).map((member) => member.fingering)).toEqual([
      undefined,
      3,
      undefined,
    ]);
  });

  it('colors chord members independently: two colors on two members of one chord are valid', () => {
    const result = edited(f02, [
      {
        type: 'add_annotation',
        annotation: { id: 'a-third', color: 'orange', noteIds: ['f02-c1-e'], text: 'Third' },
      },
      {
        type: 'add_annotation',
        annotation: { id: 'a-fifth', color: 'teal', noteIds: ['f02-c1-g'], text: 'Fifth' },
      },
    ]);
    expect(result.annotations.map(({ noteIds, color }) => ({ noteIds, color }))).toEqual([
      { noteIds: ['f02-c1-e'], color: '#ffa500' },
      { noteIds: ['f02-c1-g'], color: '#008080' },
    ]);
    expect(chordMembers(result)).toEqual(chordMembers(f02));
  });

  it.each([
    {
      name: 'a new chord symbol keeps the analysis',
      operations: [
        {
          type: 'set_chord_symbol',
          harmonyId: 'f03-h1',
          chord: { root: { step: 'F', alter: 0 }, quality: 'major', extension: 6 },
        },
      ],
      expected: {
        id: 'f03-h1',
        measureId: 'f03-m1',
        chord: { root: { step: 'F', alter: 0 }, quality: 'major', extension: 6 },
        analysis: { romanNumeral: 'ii7', function: 'predominant' },
      },
    },
    {
      name: 'removing the analysis keeps the chord symbol',
      operations: [{ type: 'remove_harmonic_analysis', harmonyId: 'f03-h1' }],
      expected: {
        id: 'f03-h1',
        measureId: 'f03-m1',
        chord: { root: { step: 'D', alter: 0 }, quality: 'minor', extension: 7, display: 'Dm7' },
      },
    },
    {
      name: 'a new harmony event can carry an analysis alone',
      operations: [
        {
          type: 'set_harmonic_analysis',
          harmonyId: 'f03-h4',
          measureId: 'f03-m2',
          offset: { numerator: 1, denominator: 2 },
          analysis: { romanNumeral: 'I6' },
        },
      ],
      expected: {
        id: 'f03-h4',
        measureId: 'f03-m2',
        offset: { numerator: 1, denominator: 2 },
        analysis: { romanNumeral: 'I6' },
      },
    },
  ])('keeps chord and Roman fields independent: $name', ({ operations, expected }) => {
    const result = edited(f03, operations);
    expect(result.harmony?.find((harmony) => harmony.id === expected.id)).toEqual(expected);
  });

  it('removes a harmony event once both its chord symbol and analysis are removed', () => {
    const result = edited(f03, [
      { type: 'remove_chord_symbol', harmonyId: 'f03-h1' },
      { type: 'remove_harmonic_analysis', harmonyId: 'f03-h1' },
    ]);
    expect(result.harmony?.map((harmony) => harmony.id)).toEqual(['f03-h2', 'f03-h3']);
  });

  it('needs a bar to create a harmony event', () => {
    const error = editError(f03, [
      { type: 'set_chord_symbol', harmonyId: 'f03-h9', chord: { root: { step: 'C', alter: 0 } } },
    ]);
    expect(summarize(error)).toEqual({
      code: 'INVALID_OPERATION',
      details: [
        { code: 'OPERATION_INVALID', path: ['operations', 0, 'measureId'], ids: ['f03-h9'] },
      ],
    });
  });

  it('adds a slur without changing any written pitch or rhythm', () => {
    const result = edited(f08, [
      {
        type: 'add_slur',
        slur: { id: 'f08-s3', startNoteId: 'f08-rh-n5', endNoteId: 'f08-rh-n8' },
      },
    ]);
    expect(result.staves).toEqual(f08.staves);
  });

  it('sets swing without rewriting any written duration', () => {
    const result = edited(f10, [
      {
        type: 'set_playback_feel',
        playbackFeel: { type: 'swing', ratio: { long: 3, short: 2 } },
      },
    ]);
    expect(result.staves).toEqual(f10.staves);
  });

  describe('no-op and repeated-removal policy', () => {
    it.each([
      { name: 'setting the current tempo', operation: { type: 'set_tempo', bpm: 120 } },
      {
        name: 'clearing a fingering the note does not have',
        operation: { type: 'remove_fingering', noteId: 'f02-rh-n1' },
      },
      {
        name: 'clearing a key signature the score does not have',
        operation: { type: 'set_key_signature', keySignature: null },
      },
    ])('accepts $name as a successful no-op (revision + 1)', ({ operation }) => {
      expect(edited(f02, [operation])).toEqual(expectedAfter(f02, () => undefined));
    });

    it('rejects removing the same slur twice in one batch', () => {
      const error = editError(f08, [
        { type: 'remove_slur', slurId: 'f08-s1' },
        { type: 'remove_slur', slurId: 'f08-s1' },
      ]);
      expect(summarize(error)).toEqual({
        code: 'TARGET_NOT_FOUND',
        details: [
          { code: 'REFERENCE_NOT_FOUND', path: ['operations', 1, 'slurId'], ids: ['f08-s1'] },
        ],
      });
    });

    it('rejects a removal whose ID names another kind of element', () => {
      const error = editError(f08, [{ type: 'remove_pedal', pedalId: 'f08-s1' }]);
      expect(summarize(error)).toEqual({
        code: 'TARGET_NOT_FOUND',
        details: [
          { code: 'REFERENCE_KIND_MISMATCH', path: ['operations', 0, 'pedalId'], ids: ['f08-s1'] },
        ],
      });
    });

    it('rejects a note attribute on a whole chord (target one member instead)', () => {
      const error = editError(f02, [{ type: 'set_fingering', noteId: 'f02-c1', fingering: 1 }]);
      expect(summarize(error)).toEqual({
        code: 'TARGET_NOT_FOUND',
        details: [
          { code: 'REFERENCE_KIND_MISMATCH', path: ['operations', 0, 'noteId'], ids: ['f02-c1'] },
        ],
      });
    });
  });
});
