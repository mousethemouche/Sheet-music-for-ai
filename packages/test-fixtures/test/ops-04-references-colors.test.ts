/**
 * OPS-04 (issue #3): references and P-03 at batch level. An edit that leaves
 * dangling references or a teaching-color conflict is rejected as a whole;
 * nothing is silently discarded or resolved by "last wins". The same edit
 * with an explicit repair (removal, reused IDs, recolor) in the batch
 * succeeds. The detailed conflict permutations are SPEC-06 (#2).
 */
import { describe, expect, it } from 'vitest';
import { F03, F08, F09, note, parseFixture, voice } from '../src';
import { editError, edited } from './ops-support';
import { summarize } from './support';

const f03 = parseFixture(F03);
const f08 = parseFixture(F08);
const f09 = parseFixture(F09);

/** F08 bar 1 rewritten with new pitches; `ids` names its four right-hand notes. */
function f08BarOne(ids: readonly [string, string, string, string]) {
  return {
    id: 'f08-m1',
    staves: [
      {
        staffId: 'f08-rh',
        voices: [
          voice('f08-rh-m1-v1', [
            note(ids[0], 'E4', 'quarter'),
            note(ids[1], 'F4', 'quarter'),
            note(ids[2], 'G4', 'quarter'),
            note(ids[3], 'A4', 'quarter'),
          ]),
        ],
      },
      { staffId: 'f08-lh', voices: [voice('f08-lh-m1-v1', [note('f08-lh-n1', 'C3', 'whole')])] },
    ],
  };
}

const replaceBarOne = (ids: readonly [string, string, string, string]) => ({
  type: 'replace_measures',
  measureIds: ['f08-m1'],
  bars: [f08BarOne(ids)],
});

const NEW_IDS = ['new-n1', 'new-n2', 'new-n3', 'new-n4'] as const;

const conflictOnN3 = {
  type: 'add_annotation',
  annotation: { id: 'f09-a2', color: '#1e90ff', noteIds: ['f09-n3', 'f09-n4'], text: 'Fifth' },
};

describe('OPS-04 references and teaching colors in a batch', () => {
  it('rejects a replacement that leaves slurs and dynamics pointing at removed notes', () => {
    expect(summarize(editError(f08, [replaceBarOne(NEW_IDS)]))).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        { code: 'REFERENCE_NOT_FOUND', path: ['slurs', 0, 'startNoteId'], ids: ['f08-rh-n1'] },
        { code: 'REFERENCE_NOT_FOUND', path: ['slurs', 0, 'endNoteId'], ids: ['f08-rh-n4'] },
        { code: 'REFERENCE_NOT_FOUND', path: ['dynamics', 0, 'eventId'], ids: ['f08-rh-n1'] },
        {
          code: 'REFERENCE_NOT_FOUND',
          path: ['dynamics', 1, 'startEventId'],
          ids: ['f08-rh-n1'],
        },
        { code: 'REFERENCE_NOT_FOUND', path: ['dynamics', 1, 'endEventId'], ids: ['f08-rh-n4'] },
      ],
    });
  });

  it('accepts the same replacement when the batch removes those references explicitly', () => {
    const result = edited(f08, [
      replaceBarOne(NEW_IDS),
      { type: 'remove_slur', slurId: 'f08-s1' },
      { type: 'remove_dynamic', dynamicId: 'f08-d1' },
      { type: 'remove_dynamic', dynamicId: 'f08-d2' },
    ]);
    expect(result.slurs?.map((slur) => slur.id)).toEqual(['f08-s2']);
    expect(result.dynamics?.map((dynamic) => dynamic.id)).toEqual(['f08-d3', 'f08-d4']);
    expect(result.pedal).toEqual(f08.pedal);
  });

  it('keeps every reference when the replacement reuses the note IDs', () => {
    const result = edited(f08, [
      replaceBarOne(['f08-rh-n1', 'f08-rh-n2', 'f08-rh-n3', 'f08-rh-n4']),
    ]);
    expect(result.slurs).toEqual(f08.slurs);
    expect(result.dynamics).toEqual(f08.dynamics);
  });

  it('rejects deleting a bar that still carries harmony and a scale-degree label', () => {
    expect(
      summarize(editError(f03, [{ type: 'delete_measures', measureIds: ['f03-m2'] }])),
    ).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        { code: 'REFERENCE_NOT_FOUND', path: ['harmony', 2, 'measureId'], ids: ['f03-m2'] },
        { code: 'REFERENCE_NOT_FOUND', path: ['scaleDegrees', 4, 'noteId'], ids: ['f03-rh-n5'] },
      ],
    });
  });

  it('deletes that bar when the batch removes its teaching material explicitly', () => {
    const result = edited(f03, [
      { type: 'remove_chord_symbol', harmonyId: 'f03-h3' },
      { type: 'remove_harmonic_analysis', harmonyId: 'f03-h3' },
      { type: 'remove_scale_degree', scaleDegreeId: 'f03-sd5' },
      { type: 'delete_measures', measureIds: ['f03-m2'] },
    ]);
    expect(result.harmony?.map((harmony) => harmony.id)).toEqual(['f03-h1', 'f03-h2']);
    expect(result.scaleDegrees?.map((label) => label.id)).toEqual([
      'f03-sd1',
      'f03-sd2',
      'f03-sd3',
      'f03-sd4',
    ]);
  });

  it.each([
    { name: 'an added annotation', operations: [conflictOnN3] },
    {
      name: 'an annotation update',
      operations: [
        { ...conflictOnN3, annotation: { ...conflictOnN3.annotation, noteIds: ['f09-n4'] } },
        { type: 'update_annotation', annotationId: 'f09-a2', noteIds: ['f09-n3', 'f09-n4'] },
      ],
    },
  ])('rejects $name that gives a note a second teaching color', ({ operations }) => {
    expect(summarize(editError(f09, operations))).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        {
          code: 'ANNOTATION_COLOR_CONFLICT',
          path: ['annotations'],
          ids: ['f09-n3', 'f09-a1', 'f09-a2'],
        },
      ],
    });
  });

  it.each([
    {
      name: 'narrowing the first annotation',
      repair: { type: 'update_annotation', annotationId: 'f09-a1', noteIds: ['f09-n1', 'f09-n2'] },
      colors: { 'f09-a1': '#ff69b4', 'f09-a2': '#1e90ff' },
    },
    {
      name: 'recoloring the first annotation',
      repair: { type: 'update_annotation', annotationId: 'f09-a1', color: 'DodgerBlue' },
      colors: { 'f09-a1': '#1e90ff', 'f09-a2': '#1e90ff' },
    },
  ])('accepts the conflicting annotation with an explicit repair: $name', ({ repair, colors }) => {
    const result = edited(f09, [conflictOnN3, repair]);
    expect(
      Object.fromEntries(result.annotations.map((annotation) => [annotation.id, annotation.color])),
    ).toEqual(colors);
  });
});
