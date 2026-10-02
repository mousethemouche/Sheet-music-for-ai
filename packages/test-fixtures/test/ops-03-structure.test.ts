/**
 * OPS-03 (issue #3): measure insert/replace/delete across both hands. Bars
 * stay aligned and are renumbered; unaffected bars keep their IDs and content.
 * First/last positions work; deleting every bar and a 33-bar result are
 * rejected. A meter change with compatible replacement bars succeeds in one
 * batch; the meter change alone fails the final validation.
 */
import type { ScoreSpec } from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import {
  type EventInput,
  type MeasureInput,
  F02,
  F07,
  F11_THIRTY_TWO_BARS,
  chord,
  dur,
  member,
  note,
  parseFixture,
  rest,
  voice,
} from '../src';
import { editError, edited, expectedAfter } from './ops-support';
import { summarize } from './support';

const f02 = parseFixture(F02);

/** A new F02 bar: the same bar ID on both hands, one voice each. */
function twoHandBar(id: string, right: EventInput[], left: EventInput[]) {
  return {
    id,
    staves: [
      { staffId: 'f02-rh', voices: [voice(`${id}-rh-v1`, right)] },
      { staffId: 'f02-lh', voices: [voice(`${id}-lh-v1`, left)] },
    ],
  };
}

const barX = twoHandBar('x1', [note('x1-rh', 'G4', 'whole')], [note('x1-lh', 'G2', 'whole')]);
const barY = twoHandBar('y1', [note('y1-rh', 'A4', 'whole')], [rest('y1-lh', 'whole')]);

/** How the new bar `bar` appears on staff `staffIndex` at bar number `number`. */
function stored(
  bar: ReturnType<typeof twoHandBar>,
  staffIndex: number,
  number: number,
): MeasureInput {
  const content = bar.staves[staffIndex];
  if (content === undefined) {
    throw new Error(`No staff ${staffIndex}`);
  }
  return { id: bar.id, number, voices: content.voices };
}

const barIdsOf = (score: ScoreSpec): string[][] =>
  score.staves.map((staff) => staff.measures.map((measure) => measure.id));

describe('OPS-03 structure across both hands', () => {
  it.each([
    { name: 'before the first bar', position: 'before', measureId: 'f02-m1', at: 0 },
    { name: 'between two bars', position: 'after', measureId: 'f02-m1', at: 1 },
    { name: 'after the last bar', position: 'after', measureId: 'f02-m2', at: 2 },
  ])('inserts a bar $name, renumbers and keeps the other bars', ({ position, measureId, at }) => {
    const result = edited(f02, [{ type: 'insert_measures', position, measureId, bars: [barX] }]);
    expect(result).toEqual(
      expectedAfter(f02, (d) => {
        d.staves.forEach((staff, staffIndex) => {
          staff.measures.splice(at, 0, stored(barX, staffIndex, at + 1));
          staff.measures.forEach((measure, index) => {
            measure.number = index + 1;
          });
        });
      }),
    );
  });

  it('replaces one bar by two new bars and keeps the unaffected bar', () => {
    const result = edited(f02, [
      { type: 'replace_measures', measureIds: ['f02-m1'], bars: [barX, barY] },
    ]);
    expect(result).toEqual(
      expectedAfter(f02, (d) => {
        d.staves.forEach((staff, staffIndex) => {
          const kept = staff.measures[1];
          if (kept === undefined) {
            throw new Error('F02 has two bars');
          }
          staff.measures = [stored(barX, staffIndex, 1), stored(barY, staffIndex, 2), kept];
          kept.number = 3;
        });
      }),
    );
  });

  it.each([
    { name: 'the first bar', measureIds: ['f02-m1'], remaining: 'f02-m2' },
    { name: 'the last bar', measureIds: ['f02-m2'], remaining: 'f02-m1' },
  ])('deletes $name from both hands', ({ measureIds, remaining }) => {
    const result = edited(f02, [{ type: 'delete_measures', measureIds }]);
    expect(result).toEqual(
      expectedAfter(f02, (d) => {
        d.staves.forEach((staff) => {
          staff.measures = staff.measures.filter((measure) => measure.id === remaining);
          staff.measures.forEach((measure) => {
            measure.number = 1;
          });
        });
      }),
    );
  });

  it.each([
    {
      name: 'deleting every bar',
      score: f02,
      operation: { type: 'delete_measures', measureIds: ['f02-m1', 'f02-m2'] },
      expected: {
        code: 'INVALID_OPERATION',
        details: [
          {
            code: 'OPERATION_INVALID',
            path: ['operations', 0, 'measureIds'],
            ids: ['f02-m1', 'f02-m2'],
          },
        ],
      },
    },
    {
      name: 'replacing bars that are not contiguous',
      score: parseFixture(F07),
      operation: {
        type: 'replace_measures',
        measureIds: ['f07-m1', 'f07-m3'],
        bars: [
          {
            id: 'z1',
            staves: [
              { staffId: 'f07-rh', voices: [voice('z1-rh', [rest('z1-r1', 'whole')])] },
              { staffId: 'f07-lh', voices: [voice('z1-lh', [rest('z1-r2', 'whole')])] },
            ],
          },
        ],
      },
      expected: {
        code: 'INVALID_OPERATION',
        details: [
          {
            code: 'OPERATION_INVALID',
            path: ['operations', 0, 'measureIds'],
            ids: ['f07-m1', 'f07-m3'],
          },
        ],
      },
    },
    {
      name: 'a new bar without content for every staff',
      score: f02,
      operation: {
        type: 'insert_measures',
        position: 'after',
        measureId: 'f02-m2',
        bars: [{ id: 'x1', staves: [{ staffId: 'f02-rh', voices: barX.staves[0]?.voices }] }],
      },
      expected: {
        code: 'INVALID_OPERATION',
        details: [
          { code: 'OPERATION_INVALID', path: ['operations', 0, 'bars', 0, 'staves'], ids: ['x1'] },
        ],
      },
    },
    {
      name: 'an unknown bar',
      score: f02,
      operation: { type: 'delete_measures', measureIds: ['f02-m9'] },
      expected: {
        code: 'TARGET_NOT_FOUND',
        details: [
          {
            code: 'REFERENCE_NOT_FOUND',
            path: ['operations', 0, 'measureIds', 0],
            ids: ['f02-m9'],
          },
        ],
      },
    },
  ])('rejects $name', ({ score, operation, expected }) => {
    expect(summarize(editError(score, [operation]))).toEqual(expected);
  });

  it('rejects an insertion that makes a 33-bar score', () => {
    const score = parseFixture(F11_THIRTY_TWO_BARS);
    const bar = {
      id: 'f11-32-m33',
      staves: [
        { staffId: 'f11-32-s1', voices: [voice('v33-1', [rest('r33-1', 'whole')])] },
        { staffId: 'f11-32-s2', voices: [voice('v33-2', [rest('r33-2', 'whole')])] },
      ],
    };
    const error = editError(score, [
      { type: 'insert_measures', position: 'after', measureId: 'f11-32-m32', bars: [bar] },
    ]);
    expect(summarize(error)).toEqual({
      code: 'MVP_LIMIT_EXCEEDED',
      details: [
        { code: 'TOO_MANY_MEASURES', path: ['staves', 0, 'measures'] },
        { code: 'TOO_MANY_MEASURES', path: ['staves', 1, 'measures'] },
      ],
    });
  });

  it('changes 4/4 to 7/4 with compatible replacement bars in one batch', () => {
    const bar1 = twoHandBar(
      'f02-m1',
      [
        chord(
          'f02-c1',
          [member('f02-c1-c', 'C4'), member('f02-c1-e', 'E4'), member('f02-c1-g', 'G4')],
          'whole',
        ),
        note('f02-rh-n1', 'F4', dur('half', 1)),
      ],
      [note('f02-lh-n1', 'C3', 'whole'), note('f02-lh-n2', 'G2', dur('half', 1))],
    );
    const bar2 = twoHandBar(
      'f02-m2',
      [note('f02-rh-n3', 'C5', 'whole'), rest('f02-rh-r1', dur('half', 1))],
      [note('f02-lh-n4', 'C3', 'whole'), rest('f02-lh-r1', dur('half', 1))],
    );
    const result = edited(f02, [
      { type: 'set_time_signature', numerator: 7, denominator: 4 },
      { type: 'replace_measures', measureIds: ['f02-m1', 'f02-m2'], bars: [bar1, bar2] },
    ]);
    expect(result.timeSignature).toEqual({ numerator: 7, denominator: 4 });
    expect(barIdsOf(result)).toEqual([
      ['f02-m1', 'f02-m2'],
      ['f02-m1', 'f02-m2'],
    ]);
    expect(result.staves[1]?.measures[0]?.voices).toEqual(bar1.staves[1]?.voices);
  });

  it('rejects the same meter change without replacement bars', () => {
    const error = editError(f02, [{ type: 'set_time_signature', numerator: 7, denominator: 4 }]);
    expect(summarize(error)).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        {
          code: 'VOICE_DURATION_MISMATCH',
          path: ['staves', 0, 'measures', 0, 'voices', 0],
          ids: ['f02-rh-m1-v1'],
        },
        {
          code: 'VOICE_DURATION_MISMATCH',
          path: ['staves', 0, 'measures', 1, 'voices', 0],
          ids: ['f02-rh-m2-v1'],
        },
        {
          code: 'VOICE_DURATION_MISMATCH',
          path: ['staves', 1, 'measures', 0, 'voices', 0],
          ids: ['f02-lh-m1-v1'],
        },
        {
          code: 'VOICE_DURATION_MISMATCH',
          path: ['staves', 1, 'measures', 1, 'voices', 0],
          ids: ['f02-lh-m2-v1'],
        },
      ],
    });
  });
});
