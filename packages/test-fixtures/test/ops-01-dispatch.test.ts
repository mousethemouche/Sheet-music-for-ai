/**
 * OPS-01 (issue #3): dispatch. One compact before/operation/after case per
 * operation handler: the result must equal the hand-written expected document
 * (the listed change, revision + 1, every other field and ID untouched).
 * Unknown operations, an empty batch and path/JSON-Patch shapes are rejected.
 * Scalar and schema rules shared with ScoreSpec are tested once in #2.
 */
import {
  SCORE_OPERATION_TYPES,
  type ScoreSpec,
  type ScoreSpecInput,
} from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import { F01, F02, F03, F08, F09, F10, note, parseFixture, pitch, voice } from '../src';
import { edited, editError, expectedAfter } from './ops-support';
import { at, measureAt, summarize } from './support';

const f01 = parseFixture(F01);
const f02 = parseFixture(F02);
const f03 = parseFixture(F03);
const f08 = parseFixture(F08);
const f09 = parseFixture(F09);
const f10 = parseFixture(F10);

interface DispatchCase {
  readonly operation: { readonly type: string } & Record<string, unknown>;
  readonly before: ScoreSpec;
  /** The only change the operation makes, written by hand on a copy of `before`. */
  readonly change: (draft: ScoreSpecInput) => void;
}

const newBar = {
  id: 'f02-m3',
  staves: [
    { staffId: 'f02-rh', voices: [voice('f02-rh-m3-v1', [note('f02-rh-n4', 'G4', 'whole')])] },
    { staffId: 'f02-lh', voices: [voice('f02-lh-m3-v1', [note('f02-lh-n5', 'G2', 'whole')])] },
  ],
};

const CASES: readonly DispatchCase[] = [
  {
    operation: { type: 'set_tempo', bpm: 90 },
    before: f01,
    change: (d) => {
      d.tempo = { bpm: 90 };
    },
  },
  {
    operation: { type: 'set_time_signature', numerator: 2, denominator: 2 },
    before: f01,
    change: (d) => {
      d.timeSignature = { numerator: 2, denominator: 2 };
    },
  },
  {
    operation: { type: 'set_key_signature', keySignature: { fifths: -1 } },
    before: f03,
    change: (d) => {
      d.keySignature = { fifths: -1 };
    },
  },
  {
    operation: {
      type: 'set_tonal_context',
      tonalContext: { tonic: { step: 'A', alter: 0 }, mode: 'minor' },
    },
    before: f03,
    change: (d) => {
      d.tonalContext = { tonic: { step: 'A', alter: 0 }, mode: 'minor' };
    },
  },
  {
    operation: { type: 'set_playback_feel', playbackFeel: { type: 'swing' } },
    before: f10,
    change: (d) => {
      d.playbackFeel = { type: 'swing' };
    },
  },
  {
    operation: { type: 'set_title', title: null },
    before: f01,
    change: (d) => {
      delete d.metadata.title;
    },
  },
  {
    operation: { type: 'set_tags', tags: ['jazz'] },
    before: f03,
    change: (d) => {
      d.metadata.tags = ['jazz'];
    },
  },
  {
    operation: { type: 'insert_measures', position: 'after', measureId: 'f02-m2', bars: [newBar] },
    before: f02,
    change: (d) => {
      d.staves.forEach((staff, index) => {
        staff.measures.push({ id: 'f02-m3', number: 3, voices: at(newBar.staves, index).voices });
      });
    },
  },
  {
    operation: {
      type: 'replace_measures',
      measureIds: ['f02-m2'],
      bars: [{ ...newBar, id: 'f02-m2' }],
    },
    before: f02,
    change: (d) => {
      d.staves.forEach((staff, index) => {
        staff.measures[1] = { id: 'f02-m2', number: 2, voices: at(newBar.staves, index).voices };
      });
    },
  },
  {
    operation: { type: 'delete_measures', measureIds: ['f02-m2'] },
    before: f02,
    change: (d) => {
      d.staves.forEach((staff) => staff.measures.pop());
    },
  },
  {
    operation: { type: 'transpose', semitones: 2, target: {} },
    before: f01,
    change: (d) => {
      const events = at(measureAt(d, 0, 0).voices, 0).events;
      ['D4', 'E4', 'F#4', 'G4'].forEach((spelled, index) => {
        const event = at(events, index);
        if (event.type === 'note') {
          event.pitch = pitch(spelled);
        }
      });
    },
  },
  {
    operation: {
      type: 'set_chord_symbol',
      harmonyId: 'f03-h3',
      chord: { root: { step: 'C', alter: 0 }, quality: 'major', extension: 6, display: 'C6' },
    },
    before: f03,
    change: (d) => {
      at(d.harmony, 2).chord = {
        root: { step: 'C', alter: 0 },
        quality: 'major',
        extension: 6,
        display: 'C6',
      };
    },
  },
  {
    operation: { type: 'remove_chord_symbol', harmonyId: 'f03-h1' },
    before: f03,
    change: (d) => {
      delete at(d.harmony, 0).chord;
    },
  },
  {
    operation: {
      type: 'set_harmonic_analysis',
      harmonyId: 'f03-h2',
      analysis: { romanNumeral: 'V7(b9)' },
    },
    before: f03,
    change: (d) => {
      at(d.harmony, 1).analysis = { romanNumeral: 'V7(b9)' };
    },
  },
  {
    operation: { type: 'remove_harmonic_analysis', harmonyId: 'f03-h3' },
    before: f03,
    change: (d) => {
      delete at(d.harmony, 2).analysis;
    },
  },
  {
    operation: { type: 'set_fingering', noteId: 'f03-lh-c1-d', fingering: 5 },
    before: f03,
    change: (d) => {
      const chord = at(at(measureAt(d, 1, 0).voices, 0).events, 0);
      if (chord.type === 'chord') {
        at(chord.notes, 0).fingering = 5;
      }
    },
  },
  {
    operation: { type: 'remove_fingering', noteId: 'f03-rh-n1' },
    before: f03,
    change: (d) => {
      const first = at(at(measureAt(d, 0, 0).voices, 0).events, 0);
      if (first.type === 'note') {
        delete first.fingering;
      }
    },
  },
  {
    operation: {
      type: 'set_articulations',
      noteId: 'f08-rh-n5',
      articulations: ['staccato', 'accent'],
    },
    before: f08,
    change: (d) => {
      const first = at(at(measureAt(d, 0, 1).voices, 0).events, 0);
      if (first.type === 'note') {
        first.articulations = ['staccato', 'accent'];
      }
    },
  },
  {
    operation: {
      type: 'add_slur',
      slur: { id: 'f08-s3', startNoteId: 'f08-rh-n5', endNoteId: 'f08-rh-n8' },
    },
    before: f08,
    change: (d) => {
      d.slurs?.push({ id: 'f08-s3', startNoteId: 'f08-rh-n5', endNoteId: 'f08-rh-n8' });
    },
  },
  {
    operation: { type: 'remove_slur', slurId: 'f08-s2' },
    before: f08,
    change: (d) => {
      d.slurs?.splice(1, 1);
    },
  },
  {
    operation: {
      type: 'set_dynamic',
      dynamic: { id: 'f08-d1', type: 'mark', eventId: 'f08-rh-n1', marking: 'pp' },
    },
    before: f08,
    change: (d) => {
      const mark = at(d.dynamics, 0);
      if (mark.type === 'mark') {
        mark.marking = 'pp';
      }
    },
  },
  {
    operation: { type: 'remove_dynamic', dynamicId: 'f08-d4' },
    before: f08,
    change: (d) => {
      d.dynamics?.splice(3, 1);
    },
  },
  {
    operation: {
      type: 'set_pedal',
      pedal: { id: 'f08-p3', type: 'sustain', startEventId: 'f08-lh-n1', endEventId: 'f08-lh-n1' },
    },
    before: f08,
    change: (d) => {
      d.pedal?.push({
        id: 'f08-p3',
        type: 'sustain',
        startEventId: 'f08-lh-n1',
        endEventId: 'f08-lh-n1',
      });
    },
  },
  {
    operation: { type: 'remove_pedal', pedalId: 'f08-p1' },
    before: f08,
    change: (d) => {
      d.pedal?.splice(0, 1);
    },
  },
  {
    operation: {
      type: 'set_scale_degree',
      scaleDegree: { id: 'f03-sd6', noteId: 'f03-lh-c3-b', degree: 7 },
    },
    before: f03,
    change: (d) => {
      d.scaleDegrees?.push({ id: 'f03-sd6', noteId: 'f03-lh-c3-b', degree: 7 });
    },
  },
  {
    operation: { type: 'remove_scale_degree', scaleDegreeId: 'f03-sd5' },
    before: f03,
    change: (d) => {
      d.scaleDegrees?.splice(4, 1);
    },
  },
  {
    operation: {
      type: 'add_annotation',
      annotation: { id: 'f09-a2', color: 'DodgerBlue', noteIds: ['f09-n4'], text: 'Octave' },
    },
    before: f09,
    change: (d) => {
      d.annotations.push({ id: 'f09-a2', color: '#1e90ff', noteIds: ['f09-n4'], text: 'Octave' });
    },
  },
  {
    operation: { type: 'update_annotation', annotationId: 'f09-a1', text: 'Tonic triad' },
    before: f09,
    change: (d) => {
      at(d.annotations, 0).text = 'Tonic triad';
    },
  },
  {
    operation: { type: 'remove_annotation', annotationId: 'f09-a1' },
    before: f09,
    change: (d) => {
      d.annotations = [];
    },
  },
];

describe('OPS-01 dispatch', () => {
  it('has exactly one case per operation type of v1', () => {
    expect(CASES.map((testCase) => testCase.operation.type)).toEqual([...SCORE_OPERATION_TYPES]);
  });

  it.each(CASES.map((testCase) => [testCase.operation.type, testCase] as const))(
    '%s changes only its target',
    (_, { operation, before, change }) => {
      expect(edited(before, [operation])).toEqual(expectedAfter(before, change));
    },
  );

  it.each([
    {
      name: 'an unknown operation type',
      operation: { type: 'set_json_path', path: '/tempo/bpm', value: 90 },
      detail: { code: 'INVALID_VALUE', path: ['operations', 1, 'type'] },
    },
    {
      name: 'a JSON Patch operation',
      operation: { op: 'replace', path: '/tempo/bpm', value: 90 },
      detail: { code: 'INVALID_VALUE', path: ['operations', 1, 'type'] },
    },
    {
      name: 'a JSON path added to a known operation',
      operation: { type: 'set_tempo', bpm: 90, path: '/tempo/bpm' },
      detail: { code: 'UNKNOWN_FIELD', path: ['operations', 1, 'path'] },
    },
  ])('rejects $name, even after a valid operation', ({ operation, detail }) => {
    expect(summarize(editError(f01, [{ type: 'set_title', title: 'Kept?' }, operation]))).toEqual({
      code: 'INVALID_OPERATION',
      details: [detail],
    });
  });

  it('rejects an empty batch', () => {
    expect(summarize(editError(f01, []))).toEqual({
      code: 'INVALID_OPERATION',
      details: [{ code: 'INVALID_VALUE', path: ['operations'] }],
    });
  });
});
