/**
 * AUDIO-04 (issue #6, P-02): ties and phrasing legato. A tie merges
 * equal-pitch continuity into one sound while every written note keeps its
 * ID and highlight; a slur only makes gates more connected: distinct attacks,
 * pitches, rests and voices are preserved, and it never creates a pedal or a
 * tie. Expected gates follow PLAYBACK_POLICY_V1.md §4 (unmarked 9/10 of the
 * notated value, slurred full value, the slur's last note unmarked).
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import {
  F08,
  F08_ORACLE,
  RICH_WIRE_FIXTURE,
  bar,
  cloneFixture,
  note,
  rest,
  score,
  staff,
  voice,
} from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { compile, soundOf, spanOf } from './support';

describe('AUDIO-04 ties and legato', () => {
  const f08 = compile(F08);

  it('a tie sounds once: the chain is attacked by its first note and lists the continuation', () => {
    const [first, continuation] = ['f08-rh-n9', 'f08-rh-n10'] as const;
    expect(soundOf(f08, first)).toEqual({
      noteId: first,
      tiedNoteIds: [continuation],
      startTick: 7680,
      // Half + quarter; the last written note starts slur f08-s2, so it is held for its full value.
      durationTicks: 2880,
      midiNote: 67,
      velocity: 80,
    });
    expect(f08.events.some((event) => event.noteId === continuation)).toBe(false);
  });

  it('tied written notes keep their own highlight spans', () => {
    expect([spanOf(f08, 'f08-rh-n9'), spanOf(f08, 'f08-rh-n10')]).toEqual([
      { noteId: 'f08-rh-n9', startTick: 7680, endTick: 9600 },
      { noteId: 'f08-rh-n10', startTick: 9600, endTick: 10560 },
    ]);
  });

  it('a slurred repeated pitch that is not tied is struck again, after the previous sound ends', () => {
    const { noteIds, key } = F08_ORACLE.repeatedPitchSlur;
    const chain = soundOf(f08, 'f08-rh-n9');
    const repeated = soundOf(f08, noteIds[1] ?? '');
    expect(repeated).toMatchObject({ startTick: 10560, midiNote: key, tiedNoteIds: [] });
    expect(chain.startTick + chain.durationTicks).toBeLessThanOrEqual(repeated.startTick);
  });

  it('slurred bar 1 is more connected than the same unmarked notes in bar 2, with the same attacks', () => {
    const { slurredNoteIds, unmarkedNoteIds, keys } = F08_ORACLE.legatoPair;
    const slurred = slurredNoteIds.map((id) => soundOf(f08, id));
    const unmarked = unmarkedNoteIds.map((id) => soundOf(f08, id));
    expect(slurred.map((event) => event.midiNote)).toEqual(keys);
    expect(unmarked.map((event) => event.midiNote)).toEqual(keys);
    expect(slurred.map((event) => event.startTick)).toEqual([0, 960, 1920, 2880]);
    expect(unmarked.map((event) => event.startTick)).toEqual([3840, 4800, 5760, 6720]);
    // Legato: held to the next attack; the slur's last note is released like an unmarked note.
    expect(slurred.map((event) => event.durationTicks)).toEqual([960, 960, 960, 864]);
    expect(unmarked.map((event) => event.durationTicks)).toEqual([864, 864, 864, 864]);
  });

  it('a slur never reaches into another voice, staff or written rest', () => {
    const plan = compile(
      score({
        id: 'sr',
        staves: [
          staff('sr-rh', 'right', [
            bar('sr-m1', 1, [
              voice('sr-v1', [
                note('sr-n1', 'C5', 'quarter'),
                note('sr-n2', 'D5', 'quarter'),
                rest('sr-r1', 'quarter'),
                note('sr-n3', 'E5', 'quarter'),
              ]),
              voice('sr-v2', [note('sr-low', 'G4', 'whole')]),
            ]),
          ]),
          staff('sr-lh', 'left', [
            bar('sr-m1', 1, [voice('sr-lv', [note('sr-bass', 'C3', 'whole')])]),
          ]),
        ],
        slurs: [{ id: 'sr-s1', startNoteId: 'sr-n1', endNoteId: 'sr-n3' }],
      }),
    );
    expect(['sr-n1', 'sr-n2', 'sr-n3'].map((id) => soundOf(plan, id).durationTicks)).toEqual([
      960, 960, 864,
    ]);
    // The slurred D5 stops at its notated end: the written rest stays silent.
    expect(soundOf(plan, 'sr-n2').startTick + soundOf(plan, 'sr-n2').durationTicks).toBe(1920);
    expect([soundOf(plan, 'sr-low').durationTicks, soundOf(plan, 'sr-bass').durationTicks]).toEqual(
      [3456, 3456],
    );
  });

  it('a tied chord member merges with its continuation; the other members stay separate', () => {
    const plan = compile(RICH_WIRE_FIXTURE);
    expect(soundOf(plan, 'rich-rh-c1-d')).toEqual({
      noteId: 'rich-rh-c1-d',
      tiedNoteIds: ['rich-rh-n3'],
      startTick: 960,
      // Half (1920) + the staccato quarter's gate (960 / 2).
      durationTicks: 2400,
      midiNote: 74,
      velocity: 80,
    });
    expect(['rich-rh-c1-g', 'rich-rh-c1-b'].map((id) => soundOf(plan, id).tiedNoteIds)).toEqual([
      [],
      [],
    ]);
    expect(plan.events.some((event) => event.noteId === 'rich-rh-n3')).toBe(false);
    expect(spanOf(plan, 'rich-rh-n3')).toEqual({
      noteId: 'rich-rh-n3',
      startTick: 2880,
      endTick: 3840,
    });
  });

  it('slurs and ties never create sustain pedal', () => {
    const withoutPedal: ScoreSpecInput = cloneFixture(F08);
    delete withoutPedal.pedal;
    expect(compile(withoutPedal).pedal).toEqual([]);
    expect(f08.pedal.map((change) => change.pedalId)).toEqual([
      'f08-p1',
      'f08-p1',
      'f08-p2',
      'f08-p2',
    ]);
  });
});
