/**
 * AUDIO-02 (issue #6): rhythm table at PPQ 960. Durations are read from the
 * notated highlight spans (the sounding gate is AUDIO-05's subject). The
 * septuplet case checks the documented rounding rule: an absolute position p
 * (in whole notes) becomes round(p x 3840), halves up, and a duration is the
 * difference of two rounded positions, so rounding never accumulates.
 */
import {
  F04,
  F04_ORACLE,
  F06,
  F06_ORACLE,
  F07,
  F07_ORACLE,
  bar,
  note,
  score,
  staff,
  tup,
  voice,
} from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { compile, spanOf, starts } from './support';

const lengths = (plan: ReturnType<typeof compile>, ids: readonly string[]): number[] =>
  ids.map((id) => spanOf(plan, id).endTick - spanOf(plan, id).startTick);

describe('AUDIO-02 rhythm table', () => {
  const f04 = compile(F04);
  const f06 = compile(F06);
  const f07 = compile(F07);

  it.each([
    {
      name: 'dotted quarter (6/8 bar of F04)',
      plan: f04,
      id: 'f04-rh-n4',
      start: 6720,
      length: 1440,
    },
    {
      name: 'dotted half closing a 7/4 bar',
      plan: f04,
      id: 'f04-rh-n3',
      start: 3840,
      length: 2880,
    },
    {
      name: 'quarter pickup (F07)',
      plan: f07,
      id: 'f07-rh-n1',
      start: 0,
      length: F07_ORACLE.pickupTicks,
    },
    { name: 'first note after the pickup', plan: f07, id: 'f07-rh-n2', start: 960, length: 1920 },
  ])('$name starts at $start and lasts $length ticks', ({ plan, id, start, length }) => {
    expect(spanOf(plan, id)).toEqual({ noteId: id, startTick: start, endTick: start + length });
  });

  it('three eighth-triplet members last 320 ticks each (960 in total)', () => {
    const { noteIds, startTicks, memberTicks } = F06_ORACLE.triplet;
    expect(starts(f06, noteIds)).toEqual(startTicks);
    expect(lengths(f06, noteIds)).toEqual([memberTicks, memberTicks, memberTicks]);
  });

  it('five eighth-quintuplet members last 384 ticks each (1920 in total)', () => {
    const { noteIds, startTicks, memberTicks } = F06_ORACLE.quintuplet;
    expect(starts(f06, noteIds)).toEqual(startTicks);
    expect(lengths(f06, noteIds)).toEqual(noteIds.map(() => memberTicks));
    expect(spanOf(f06, 'f06-n9').startTick).toBe(F06_ORACLE.quarterAfterTupletsStartTicks);
  });

  it('a 7:4 septuplet (137 1/7 ticks per member) rounds positions, not durations', () => {
    const { noteIds } = F06_ORACLE.septuplet;
    // 3840 + round(k x 960 / 7) for k = 0..6.
    expect(starts(f06, noteIds)).toEqual([3840, 3977, 4114, 4251, 4389, 4526, 4663]);
    expect(lengths(f06, noteIds)).toEqual([137, 137, 137, 138, 137, 137, 137]);
    expect(spanOf(f06, 'f06-n17').startTick).toBe(F06_ORACLE.dottedHalfAfterSeptupletStartTicks);
    expect(f06.totalTicks).toBe(F06_ORACLE.totalTicks);
  });

  it('twelve bars of septuplets never drift: every bar line stays a multiple of 3840', () => {
    const bars = Array.from({ length: 12 }, (_, b) =>
      bar(`d-m${b + 1}`, b + 1, [
        voice(
          `d-v${b + 1}`,
          Array.from({ length: 28 }, (_, n) =>
            note(
              `d-${b + 1}-${n}`,
              'C5',
              tup('sixteenth', `d-t${b + 1}-${Math.floor(n / 7)}`, 7, 4),
            ),
          ),
        ),
      ]),
    );
    const plan = compile(score({ id: 'drift', staves: [staff('d-rh', 'right', bars)] }));
    expect(plan.totalTicks).toBe(12 * 3840);
    expect(Array.from({ length: 12 }, (_, b) => spanOf(plan, `d-${b + 1}-0`).startTick)).toEqual(
      Array.from({ length: 12 }, (_, b) => b * 3840),
    );
    expect(spanOf(plan, 'd-12-27').endTick).toBe(12 * 3840);
  });

  it('F04 7/4 and local 6/8 bars keep both hands aligned (6720 + 2880 + 6720 = 16320)', () => {
    const [bar1, bar2, bar3] = F04_ORACLE.barStartTicks;
    expect(f04.totalTicks).toBe(F04_ORACLE.totalTicks);
    expect(starts(f04, ['f04-rh-n1', 'f04-lh-n1'])).toEqual([bar1, bar1]);
    expect(starts(f04, ['f04-rh-n4', 'f04-lh-n3'])).toEqual([bar2, bar2]);
    expect(starts(f04, ['f04-rh-n6', 'f04-lh-n4'])).toEqual([bar3, bar3]);
    expect(spanOf(f04, 'f04-lh-n3').endTick - (bar2 ?? 0)).toBe(2880);
  });

  it('F07 pickup and final incomplete bar give 960 + 3840 + 2880 = 7680', () => {
    expect(f07.totalTicks).toBe(F07_ORACLE.totalTicks);
    expect(starts(f07, ['f07-rh-n5', 'f07-lh-n2'])).toEqual([4800, 4800]);
  });
});
