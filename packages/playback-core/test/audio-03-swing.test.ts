/**
 * AUDIO-03 (issue #6, P-02): swing. Absent or straight feel is straight;
 * swing requested without a ratio is 2:1 on eighths; an explicit ratio or
 * subdivision wins; explicit tuplets are not swung a second time; the written
 * rhythm (beats, bar lines, total) is unchanged.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import {
  F10,
  F10_ORACLE,
  F10_SWING_2_1,
  F10_SWING_3_2,
  F10_SWING_DEFAULT,
  RICH_WIRE_FIXTURE,
  bar,
  cloneFixture,
  dur,
  note,
  score,
  staff,
  tup,
  voice,
} from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { compile, spanOf, starts } from './support';

const withFeel = (feel: NonNullable<ScoreSpecInput['playbackFeel']>): ScoreSpecInput => ({
  ...cloneFixture(F10),
  playbackFeel: feel,
});

const oneBar = (
  id: string,
  feel: ScoreSpecInput['playbackFeel'],
  events: Parameters<typeof voice>[1],
) =>
  score({
    id,
    ...(feel === undefined ? {} : { playbackFeel: feel }),
    staves: [staff(`${id}-rh`, 'right', [bar(`${id}-m1`, 1, [voice(`${id}-v1`, events)])])],
  });

describe('AUDIO-03 swing', () => {
  it.each([
    { name: 'absent feel', input: F10, expected: F10_ORACLE.straightStartTicks },
    {
      name: 'explicit straight',
      input: withFeel({ type: 'straight' }),
      expected: F10_ORACLE.straightStartTicks,
    },
    {
      name: 'swing requested without ratio (2:1 eighths)',
      input: F10_SWING_DEFAULT,
      expected: F10_ORACLE.swing2to1StartTicks,
    },
    { name: 'explicit 2:1', input: F10_SWING_2_1, expected: F10_ORACLE.swing2to1StartTicks },
    {
      name: 'explicit 3:2 overrides the default',
      input: F10_SWING_3_2,
      expected: F10_ORACLE.swing3to2StartTicks,
    },
    {
      name: 'explicit 1:1 (even timing)',
      input: withFeel({ type: 'swing', ratio: { long: 1, short: 1 } }),
      expected: F10_ORACLE.straightStartTicks,
    },
    {
      name: 'sixteenth swing leaves eighths on its pair grid',
      input: withFeel({ type: 'swing', subdivision: 'sixteenth' }),
      expected: F10_ORACLE.straightStartTicks,
    },
  ])('$name: F10 eighths start at the expected ticks', ({ input, expected }) => {
    const plan = compile(input);
    expect(starts(plan, F10_ORACLE.noteIds)).toEqual(expected);
    expect(plan.events.map((event) => event.startTick)).toEqual(expected);
    expect(plan.totalTicks).toBe(F10_ORACLE.totalTicks);
  });

  it('a swung 2:1 pair splits one quarter into 640 + 320 ticks', () => {
    const plan = compile(F10_SWING_DEFAULT);
    expect([spanOf(plan, 'f10-n1'), spanOf(plan, 'f10-n2')]).toEqual([
      { noteId: 'f10-n1', startTick: 0, endTick: 640 },
      { noteId: 'f10-n2', startTick: 640, endTick: 960 },
    ]);
  });

  it('swing requested without ratio compiles exactly like explicit 2:1 eighths', () => {
    expect(compile(F10_SWING_DEFAULT)).toEqual(compile(F10_SWING_2_1));
  });

  it('sixteenth swing swings sixteenths within each eighth: 0/320/480/800', () => {
    const plan = compile(
      oneBar('s16', { type: 'swing', subdivision: 'sixteenth' }, [
        note('s16-n1', 'C4', 'sixteenth'),
        note('s16-n2', 'D4', 'sixteenth'),
        note('s16-n3', 'E4', 'sixteenth'),
        note('s16-n4', 'F4', 'sixteenth'),
        note('s16-n5', 'G4', 'quarter'),
        note('s16-n6', 'A4', 'half'),
      ]),
    );
    expect(starts(plan, ['s16-n1', 's16-n2', 's16-n3', 's16-n4', 's16-n5', 's16-n6'])).toEqual([
      0, 320, 480, 800, 960, 1920,
    ]);
  });

  it('written triplets are not swung a second time, next to swung eighths', () => {
    const plan = compile(
      oneBar('tr', { type: 'swing' }, [
        note('tr-n1', 'C5', tup('eighth', 'tr-t1')),
        note('tr-n2', 'D5', tup('eighth', 'tr-t1')),
        note('tr-n3', 'E5', tup('eighth', 'tr-t1')),
        note('tr-n4', 'F5', 'eighth'),
        note('tr-n5', 'G5', 'eighth'),
        note('tr-n6', 'A5', 'half'),
      ]),
    );
    expect(starts(plan, ['tr-n1', 'tr-n2', 'tr-n3', 'tr-n4', 'tr-n5', 'tr-n6'])).toEqual([
      0, 320, 640, 960, 1600, 1920,
    ]);
  });

  it('rich fixture: swung pickup eighths, unswung triplet run, unchanged bar lines', () => {
    const plan = compile(RICH_WIRE_FIXTURE);
    expect(starts(plan, ['rich-rh-n1', 'rich-rh-n2'])).toEqual([0, 640]);
    expect(starts(plan, ['rich-rh-n4', 'rich-rh-n5', 'rich-rh-n6'])).toEqual([3840, 4160, 4480]);
    expect(starts(plan, ['rich-rh-c1-g', 'rich-rh-n7', 'rich-rh-c2-g'])).toEqual([960, 4800, 7680]);
    expect(plan.totalTicks).toBe(10560);
  });

  it('a swing pair cut by a bar line stays straight (an eighth pickup)', () => {
    const plan = compile(
      score({
        id: 'ep',
        playbackFeel: { type: 'swing' },
        staves: [
          staff('ep-rh', 'right', [
            bar('ep-m1', 1, [voice('ep-v1', [note('ep-n1', 'G4', 'eighth')])], {
              kind: 'pickup',
              actualDuration: { numerator: 1, denominator: 8 },
            }),
            bar('ep-m2', 2, [
              voice('ep-v2', [
                note('ep-n2', 'C5', 'eighth'),
                note('ep-n3', 'D5', 'eighth'),
                note('ep-n4', 'E5', dur('half', 1)),
              ]),
            ]),
          ]),
        ],
      }),
    );
    expect(starts(plan, ['ep-n1', 'ep-n2', 'ep-n3', 'ep-n4'])).toEqual([0, 480, 1120, 1440]);
  });

  it('the written rhythm is unchanged: beats and the total stay where straight puts them', () => {
    const straight = compile(F10);
    const swung = compile(F10_SWING_3_2);
    const beats = ['f10-n1', 'f10-n3', 'f10-n5', 'f10-n7'];
    expect(starts(swung, beats)).toEqual(starts(straight, beats));
    expect(swung.highlights.map((span) => span.noteId)).toEqual(
      straight.highlights.map((span) => span.noteId),
    );
    expect(spanOf(swung, 'f10-n8').endTick).toBe(spanOf(straight, 'f10-n8').endTick);
  });
});
