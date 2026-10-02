/**
 * SPEC-03 (issue #2): exact rhythm. Full bars sum exactly in 4/4, 7/4 and 6/8,
 * with dots, 3:2/5:4/7:4 tuplets, a pickup, an incomplete bar and local meter
 * changes; incomplete bars use an explicit actual duration shared across
 * voices. Overfill, gaps and invalid tuplet ratios/groups are rejected.
 * Positions are exact fractions (tick conversion itself belongs to #6).
 */
import {
  type Duration,
  type ErrorPath,
  type ScoreSpecInput,
  addFractions,
  buildScoreIndex,
  durationToFraction,
  fraction,
  sumFractions,
} from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import {
  F01,
  F01_ORACLE,
  F04,
  F04_ORACLE,
  F06,
  F06_ORACLE,
  F07,
  F07_ORACLE,
  RICH_WIRE_FIXTURE,
  RICH_WIRE_ORACLE,
  bar,
  dur,
  note,
  rest,
  score,
  staff,
  tup,
  voice,
} from '../src';
import {
  accepted,
  codesAndPaths,
  eventAt,
  measureAt,
  parseFraction,
  rejected,
  summarize,
  toTicks,
  variant,
  voiceAt,
} from './support';

const oneStaff = (
  events: Parameters<typeof voice>[1],
  numerator = 4,
  denominator: ScoreSpecInput['timeSignature']['denominator'] = 4,
): ScoreSpecInput =>
  score({
    id: 'rhythm',
    timeSignature: { numerator, denominator },
    staves: [staff('rh', 'right', [bar('m1', 1, [voice('v1', events)])])],
  });

describe('SPEC-03 exact rhythm', () => {
  describe('exact lengths of written values', () => {
    const lengths: { name: string; duration: Duration; expected: [number, number] }[] = [
      { name: 'whole', duration: { value: 'whole' }, expected: [1, 1] },
      { name: 'quarter', duration: { value: 'quarter' }, expected: [1, 4] },
      { name: 'dotted quarter', duration: { value: 'quarter', dots: 1 }, expected: [3, 8] },
      { name: 'double-dotted half', duration: { value: 'half', dots: 2 }, expected: [7, 8] },
      {
        name: 'dotted thirty-second',
        duration: { value: 'thirtySecond', dots: 1 },
        expected: [3, 64],
      },
      {
        name: 'eighth-triplet member (3:2)',
        duration: { value: 'eighth', tuplet: { groupId: 'g', actual: 3, normal: 2 } },
        expected: [1, 12],
      },
      {
        name: 'eighth-quintuplet member (5:4)',
        duration: { value: 'eighth', tuplet: { groupId: 'g', actual: 5, normal: 4 } },
        expected: [1, 10],
      },
      {
        name: 'sixteenth-septuplet member (7:4)',
        duration: { value: 'sixteenth', tuplet: { groupId: 'g', actual: 7, normal: 4 } },
        expected: [1, 28],
      },
    ];

    it.each(lengths)(
      '$name lasts exactly the expected fraction of a whole note',
      ({ duration, expected }) => {
        expect(durationToFraction(duration)).toEqual({
          numerator: expected[0],
          denominator: expected[1],
        });
      },
    );

    it('sums tuplet fractions without floating-point drift', () => {
      const quintupletSixteenth: Duration = {
        value: 'sixteenth',
        tuplet: { groupId: 'g', actual: 5, normal: 4 },
      };
      const floats = Array.from({ length: 10 }, () => 0.1).reduce(
        (total, value) => total + value,
        0,
      );
      expect(floats).not.toBe(1);
      expect(
        sumFractions(Array.from({ length: 20 }, () => durationToFraction(quintupletSixteenth))),
      ).toEqual(fraction(1));
    });

    it('adds fractions over their common denominator, beyond the range of cross products', () => {
      // The cross products of (2^40 + 1)/2^20 and 1/2^20 reach 2^60; the sum is (2^39 + 1)/2^19.
      expect(addFractions(fraction(2 ** 40 + 1, 2 ** 20), fraction(1, 2 ** 20))).toEqual({
        numerator: 549_755_813_889,
        denominator: 524_288,
      });
    });
  });

  describe('valid bars', () => {
    const valid: { name: string; input: ScoreSpecInput }[] = [
      { name: '4/4 quarters (F01)', input: F01 },
      { name: '7/4, a local 6/8 bar and 7/4 again (F04)', input: F04 },
      { name: '3:2, 5:4 and 7:4 tuplets (F06)', input: F06 },
      { name: 'quarter pickup and incomplete last bar on both hands (F07)', input: F07 },
      {
        name: 'dotted and double-dotted values',
        input: oneStaff(
          [
            note('n1', 'C4', dur('half', 1)),
            note('n2', 'D4', 'quarter'),
            note('n3', 'E4', dur('quarter', 2)),
            note('n4', 'F4', 'sixteenth'),
            rest('r1', 'half'),
          ],
          8,
          4,
        ),
      },
      {
        name: 'a triplet of quarter + eighth (unequal members)',
        input: oneStaff([
          note('n1', 'C4', tup('quarter', 'g1')),
          note('n2', 'D4', tup('eighth', 'g1')),
          note('n3', 'E4', dur('half', 1)),
        ]),
      },
      {
        name: 'a pickup whose actual duration is not in lowest terms',
        input: variant(F07, (draft) => {
          measureAt(draft, 0, 0).actualDuration = { numerator: 2, denominator: 8 };
          measureAt(draft, 1, 0).actualDuration = { numerator: 2, denominator: 8 };
        }),
      },
    ];

    it.each(valid)('accepts $name', ({ input }) => {
      expect(accepted(input).id).toBe(input.id);
    });
  });

  describe('exact positions match the independent tick oracles', () => {
    it('F01: quarters start on each beat and the score lasts one bar', () => {
      const index = buildScoreIndex(accepted(F01));
      expect(
        F01_ORACLE.noteIds.map((id) => toTicks(index.location(id)?.onset ?? fraction(-1))),
      ).toEqual(F01_ORACLE.startTicks);
      expect(toTicks(index.totalDuration)).toBe(F01_ORACLE.totalTicks);
    });

    it('F04: 7/4 and local 6/8 bars start and last where expected', () => {
      const index = buildScoreIndex(accepted(F04));
      expect(index.bars.map((info) => toTicks(info.start))).toEqual(F04_ORACLE.barStartTicks);
      expect(index.bars.map((info) => toTicks(info.duration))).toEqual(F04_ORACLE.barDurationTicks);
      expect(
        index.bars.map(
          (info) => `${info.timeSignature.numerator}/${info.timeSignature.denominator}`,
        ),
      ).toEqual(F04_ORACLE.meters);
      expect(toTicks(index.totalDuration)).toBe(F04_ORACLE.totalTicks);
    });

    it('F06: triplet and quintuplet members start at exact positions; septuplets stay exact fractions', () => {
      const index = buildScoreIndex(accepted(F06));
      const startTicks = (ids: readonly string[]): number[] =>
        ids.map((id) => toTicks(index.location(id)?.onset ?? fraction(-1)));
      expect(startTicks(F06_ORACLE.triplet.noteIds)).toEqual(F06_ORACLE.triplet.startTicks);
      expect(startTicks(F06_ORACLE.quintuplet.noteIds)).toEqual(F06_ORACLE.quintuplet.startTicks);
      expect(startTicks(['f06-n9'])).toEqual([F06_ORACLE.quarterAfterTupletsStartTicks]);
      expect(F06_ORACLE.septuplet.noteIds.map((id) => index.location(id)?.onset)).toEqual(
        F06_ORACLE.septuplet.startWholeNotes.map(parseFraction),
      );
      expect(index.location('f06-n10')?.duration).toEqual(
        parseFraction(F06_ORACLE.septuplet.memberWholeNotes),
      );
      expect(startTicks(['f06-n17'])).toEqual([F06_ORACLE.dottedHalfAfterSeptupletStartTicks]);
      expect(index.tupletGroups.map((group) => [group.id, group.members.length])).toEqual([
        ['f06-t1', 3],
        ['f06-q1', 5],
        ['f06-s1', 7],
      ]);
    });

    it('F07 and the rich fixture: pickup and incomplete bars last their declared actual duration', () => {
      const pickup = buildScoreIndex(accepted(F07));
      expect(pickup.bars.map((info) => toTicks(info.start))).toEqual(F07_ORACLE.barStartTicks);
      expect(pickup.bars.map((info) => toTicks(info.duration))).toEqual(
        F07_ORACLE.barDurationTicks,
      );
      expect(toTicks(pickup.totalDuration)).toBe(F07_ORACLE.totalTicks);

      const rich = buildScoreIndex(accepted(RICH_WIRE_FIXTURE));
      expect(rich.bars.map((info) => toTicks(info.start))).toEqual(RICH_WIRE_ORACLE.barStartTicks);
      expect(rich.bars.map((info) => toTicks(info.duration))).toEqual(
        RICH_WIRE_ORACLE.barDurationTicks,
      );
      expect(toTicks(rich.totalDuration)).toBe(RICH_WIRE_ORACLE.totalTicks);
    });
  });

  describe('voices must fill their bar exactly', () => {
    const voicePath = (staffIndex: number, measure: number, voiceIndex = 0): ErrorPath => [
      'staves',
      staffIndex,
      'measures',
      measure,
      'voices',
      voiceIndex,
    ];
    const mismatches: { name: string; input: ScoreSpecInput; path: ErrorPath; ids: string[] }[] = [
      {
        name: 'a 4/4 bar overfilled with five quarters',
        input: variant(F01, (draft) => {
          voiceAt(draft, 0, 0, 0).events.push(note('extra', 'G4', 'quarter'));
        }),
        path: voicePath(0, 0),
        ids: ['f01-rh-m1-v1'],
      },
      {
        name: 'a full 4/4 bar with an unexplained gap',
        input: variant(F01, (draft) => {
          voiceAt(draft, 0, 0, 0).events.pop();
        }),
        path: voicePath(0, 0),
        ids: ['f01-rh-m1-v1'],
      },
      {
        name: 'a 7/4 bar filled as 4/4',
        input: variant(F04, (draft) => {
          voiceAt(draft, 0, 0, 0).events = [note('f04-rh-n1', 'E4', 'whole')];
        }),
        path: voicePath(0, 0),
        ids: ['f04-rh-m1-v1'],
      },
      {
        name: 'a local 6/8 bar filled with four quarters',
        input: variant(F04, (draft) => {
          voiceAt(draft, 1, 1, 0).events = [note('f04-lh-n3', 'F2', 'whole')];
        }),
        path: voicePath(1, 1),
        ids: ['f04-lh-m2-v1'],
      },
      {
        name: 'a pickup voice shorter than its actual duration',
        input: variant(F07, (draft) => {
          eventAt(draft, 0, 0, 0, 0).duration = { value: 'eighth' };
        }),
        path: voicePath(0, 0),
        ids: ['f07-rh-m1-v1'],
      },
      {
        name: 'a second pickup voice that does not share the actual duration',
        input: variant(F07, (draft) => {
          measureAt(draft, 1, 0).voices.push(voice('f07-lh-m1-v2', [rest('f07-lh-r2', 'half')]));
        }),
        path: voicePath(1, 0, 1),
        ids: ['f07-lh-m1-v2'],
      },
    ];

    it.each(mismatches)('rejects $name', ({ input, path, ids }) => {
      expect(summarize(rejected(input))).toEqual({
        code: 'SCORE_VALIDATION_FAILED',
        details: [{ code: 'VOICE_DURATION_MISMATCH', path, ids }],
      });
    });

    // Short bars holding one quarter note but declaring 1/p of a whole note, for
    // large coprime primes p the schema accepts: summing these bar lengths
    // leaves the safe-integer range, so validation must not rely on them.
    const shortBar = (number: number, kind: 'pickup' | 'incomplete', denominator: number) =>
      bar(`m${number}`, number, [voice(`v${number}`, [note(`n${number}`, 'C4', 'quarter')])], {
        kind,
        actualDuration: { numerator: 1, denominator },
      });
    const unfillable: { name: string; input: ScoreSpecInput; voices: [number, string][] }[] = [
      {
        name: 'incomplete bars of 1/999983, 1/999979 and 1/999961 after a full bar',
        input: score({
          id: 'coprime-incomplete',
          staves: [
            staff('rh', 'right', [
              bar('m1', 1, [voice('v1', [note('n1', 'C4', 'whole')])]),
              shortBar(2, 'incomplete', 999_983),
              shortBar(3, 'incomplete', 999_979),
              shortBar(4, 'incomplete', 999_961),
            ]),
          ],
        }),
        voices: [
          [1, 'v2'],
          [2, 'v3'],
          [3, 'v4'],
        ],
      },
      {
        name: 'a pickup of 1/999983 followed by incomplete bars of 1/999979 and 1/999961',
        input: score({
          id: 'coprime-pickup',
          staves: [
            staff('rh', 'right', [
              shortBar(1, 'pickup', 999_983),
              shortBar(2, 'incomplete', 999_979),
              shortBar(3, 'incomplete', 999_961),
            ]),
          ],
        }),
        voices: [
          [0, 'v1'],
          [1, 'v2'],
          [2, 'v3'],
        ],
      },
    ];

    it.each(unfillable)('reports every voice, without throwing, for $name', ({ input, voices }) => {
      expect(summarize(rejected(input))).toEqual({
        code: 'SCORE_VALIDATION_FAILED',
        details: voices.map(([measure, id]) => ({
          code: 'VOICE_DURATION_MISMATCH',
          path: voicePath(0, measure),
          ids: [id],
        })),
      });
    });
  });

  describe('pickup and incomplete bars must be declared', () => {
    const barPath = (staffIndex: number, measure: number): ErrorPath => [
      'staves',
      staffIndex,
      'measures',
      measure,
    ];
    const kinds: {
      name: string;
      input: ScoreSpecInput;
      details: { path: ErrorPath; ids: string[] }[];
    }[] = [
      {
        name: 'a pickup without actualDuration',
        input: variant(F07, (draft) => {
          delete measureAt(draft, 0, 0).actualDuration;
          delete measureAt(draft, 1, 0).actualDuration;
        }),
        details: [
          { path: barPath(0, 0), ids: ['f07-m1'] },
          { path: barPath(1, 0), ids: ['f07-m1'] },
        ],
      },
      {
        name: 'actualDuration on a full bar',
        input: variant(F01, (draft) => {
          measureAt(draft, 0, 0).actualDuration = { numerator: 1, denominator: 1 };
        }),
        details: [{ path: barPath(0, 0), ids: ['f01-m1'] }],
      },
      {
        name: 'an incomplete bar as long as the full bar',
        input: variant(F07, (draft) => {
          measureAt(draft, 0, 2).actualDuration = { numerator: 4, denominator: 4 };
          measureAt(draft, 1, 2).actualDuration = { numerator: 4, denominator: 4 };
        }),
        details: [
          { path: barPath(0, 2), ids: ['f07-m3'] },
          { path: barPath(1, 2), ids: ['f07-m3'] },
        ],
      },
      {
        name: 'a pickup that is not the first bar',
        input: variant(F07, (draft) => {
          measureAt(draft, 0, 2).kind = 'pickup';
          measureAt(draft, 1, 2).kind = 'pickup';
        }),
        details: [
          { path: barPath(0, 2), ids: ['f07-m3'] },
          { path: barPath(1, 2), ids: ['f07-m3'] },
        ],
      },
      {
        name: 'a short first bar marked incomplete instead of pickup',
        input: variant(F07, (draft) => {
          measureAt(draft, 0, 0).kind = 'incomplete';
          measureAt(draft, 1, 0).kind = 'incomplete';
        }),
        details: [
          { path: barPath(0, 0), ids: ['f07-m1'] },
          { path: barPath(1, 0), ids: ['f07-m1'] },
        ],
      },
    ];

    it.each(kinds)('rejects $name', ({ input, details }) => {
      expect(summarize(rejected(input))).toEqual({
        code: 'SCORE_VALIDATION_FAILED',
        details: details.map((detail) => ({ code: 'MEASURE_KIND_INVALID', ...detail })),
      });
    });

    it('rejects a pickup whose actual duration differs between the hands', () => {
      const input = variant(F07, (draft) => {
        measureAt(draft, 1, 0).actualDuration = { numerator: 1, denominator: 8 };
        eventAt(draft, 1, 0, 0, 0).duration = { value: 'eighth' };
      });
      expect(summarize(rejected(input)).details).toEqual([
        { code: 'MEASURE_ALIGNMENT_MISMATCH', path: ['staves', 1, 'measures', 0], ids: ['f07-m1'] },
      ]);
    });
  });

  describe('meters and tuplet ratios are validated', () => {
    const firstDuration: ErrorPath = [
      'staves',
      0,
      'measures',
      0,
      'voices',
      0,
      'events',
      0,
      'duration',
    ];
    const setRatio = (draft: ScoreSpecInput, actual: number, normal: number): void => {
      const tuplet = eventAt(draft, 0, 0, 0, 0).duration.tuplet;
      if (tuplet !== undefined) {
        Object.assign(tuplet, { actual, normal });
      }
    };
    const scalars: { name: string; input: ScoreSpecInput; code: string; path: ErrorPath }[] = [
      {
        name: 'a meter denominator of 3',
        input: variant(F01, (draft) => Object.assign(draft.timeSignature, { denominator: 3 })),
        code: 'INVALID_VALUE',
        path: ['timeSignature', 'denominator'],
      },
      {
        name: 'a meter numerator of 0',
        input: variant(F01, (draft) => Object.assign(draft.timeSignature, { numerator: 0 })),
        code: 'INVALID_VALUE',
        path: ['timeSignature', 'numerator'],
      },
      {
        name: 'a tuplet ratio with actual equal to normal',
        input: variant(F06, (draft) => setRatio(draft, 3, 3)),
        code: 'INVALID_VALUE',
        path: [...firstDuration, 'tuplet'],
      },
      {
        name: 'a tuplet ratio with actual 0',
        input: variant(F06, (draft) => setRatio(draft, 0, 2)),
        code: 'INVALID_VALUE',
        path: [...firstDuration, 'tuplet', 'actual'],
      },
      {
        name: 'a fractional tuplet ratio',
        input: variant(F06, (draft) => setRatio(draft, 2.5, 2)),
        code: 'INVALID_TYPE',
        path: [...firstDuration, 'tuplet', 'actual'],
      },
    ];

    it.each(scalars)('rejects $name', ({ input, code, path }) => {
      expect(codesAndPaths(rejected(input))).toEqual([{ code, path }]);
    });
  });

  describe('tuplet groups', () => {
    const tupletPath = (event: number, measure = 0): ErrorPath => [
      'staves',
      0,
      'measures',
      measure,
      'voices',
      0,
      'events',
      event,
      'duration',
      'tuplet',
    ];
    const groups: {
      name: string;
      input: ScoreSpecInput;
      details: { path: ErrorPath; ids: string[] }[];
    }[] = [
      {
        name: 'members separated by another event',
        input: variant(F06, (draft) => {
          const events = voiceAt(draft, 0, 0, 0).events;
          const quarter = events.splice(8, 1);
          events.splice(1, 0, ...quarter);
        }),
        details: [{ path: tupletPath(0), ids: ['f06-t1'] }],
      },
      {
        name: 'a group ID reused in the next bar',
        input: variant(F06, (draft) => {
          for (const event of voiceAt(draft, 0, 1, 0).events.slice(0, 7)) {
            if (event.duration.tuplet !== undefined) {
              event.duration.tuplet.groupId = 'f06-t1';
            }
          }
        }),
        details: [{ path: tupletPath(0), ids: ['f06-t1'] }],
      },
      {
        name: 'members with different ratios',
        input: variant(F06, (draft) => {
          const tuplet = eventAt(draft, 0, 0, 0, 2).duration.tuplet;
          if (tuplet !== undefined) {
            Object.assign(tuplet, { actual: 6, normal: 4 });
          }
        }),
        details: [{ path: tupletPath(0), ids: ['f06-t1'] }],
      },
      {
        name: 'a single-member group',
        input: oneStaff([
          note('n1', 'C4', {
            value: 'half',
            dots: 1,
            tuplet: { groupId: 'g1', actual: 3, normal: 2 },
          }),
          note('n2', 'D4', 'half'),
        ]),
        details: [{ path: tupletPath(0), ids: ['g1'] }],
      },
      {
        name: 'three "triplets" of four eighths each (incomplete groups)',
        input: oneStaff(
          ['g1', 'g2', 'g3'].flatMap((groupId) =>
            ['C4', 'D4', 'E4', 'F4'].map((spelled, position) =>
              note(`${groupId}-n${position + 1}`, spelled, tup('eighth', groupId)),
            ),
          ),
        ),
        details: [
          { path: tupletPath(0), ids: ['g1'] },
          { path: tupletPath(4), ids: ['g2'] },
          { path: tupletPath(8), ids: ['g3'] },
        ],
      },
    ];

    it.each(groups)('rejects $name', ({ input, details }) => {
      expect(summarize(rejected(input))).toEqual({
        code: 'SCORE_VALIDATION_FAILED',
        details: details.map((detail) => ({ code: 'TUPLET_GROUP_INVALID', ...detail })),
      });
    });
  });
});
