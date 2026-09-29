/**
 * AUDIO-01 (issue #6): pitch and time. Written pitch -> piano key, quarter
 * notes at PPQ 960, tempo in quarters per minute, simultaneous hands, voices
 * and chord members, rests that advance time without an attack, and labels
 * or key signatures that never add a note or an accidental.
 */
import {
  F01,
  F01_ORACLE,
  F02,
  F02_ORACLE,
  F03,
  F05,
  F05_ORACLE,
  F07,
  bar,
  note,
  rest,
  score,
  staff,
  voice,
} from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { createPlaybackController } from '../src';
import { FakeAudio } from './fake-synth';
import { compile, soundOf, spanOf } from './support';

describe('AUDIO-01 pitch and time', () => {
  it('F01 sounds MIDI 60/62/64/65 at ticks 0/960/1920/2880 in a 3840-tick bar at PPQ 960', () => {
    const plan = compile(F01);
    expect(plan.ppq).toBe(960);
    expect(plan.totalTicks).toBe(F01_ORACLE.totalTicks);
    expect(plan.events.map((event) => event.noteId)).toEqual(F01_ORACLE.noteIds);
    expect(plan.events.map((event) => event.midiNote)).toEqual(F01_ORACLE.keys);
    expect(plan.events.map((event) => event.startTick)).toEqual(F01_ORACLE.startTicks);
  });

  it('at quarter = 120 bpm a quarter lasts 0.5 s: D4 is attacked 0.5 s after Play', async () => {
    const plan = compile(F01);
    expect(plan.bpm).toBe(F01_ORACLE.bpm);
    const audio = new FakeAudio();
    const engine = createPlaybackController(audio.driver, audio.clock.ticker);
    await engine.load(plan);
    await engine.play();
    audio.advance(F01_ORACLE.quarterSeconds);
    expect(audio.driver.attacks().map(({ key, time }) => ({ key, time }))).toEqual([
      { key: 60, time: 0 },
      { key: 62, time: 0.5 },
    ]);
  });

  it('F02 plays both hands and every chord member at the same time', () => {
    const plan = compile(F02);
    expect(plan.totalTicks).toBe(F02_ORACLE.totalTicks);
    for (const [id, tick] of Object.entries(F02_ORACLE.eventStartTicks)) {
      if (id !== F02_ORACLE.chordId) {
        expect(soundOf(plan, id).startTick, id).toBe(tick);
      }
    }
    const chord = F02_ORACLE.chordMemberIds.map((id) => soundOf(plan, id));
    expect(chord.map((event) => event.midiNote)).toEqual(F02_ORACLE.chordMemberKeys);
    expect(chord.map((event) => event.startTick)).toEqual([0, 0, 0]);
    expect(chord.map((event) => spanOf(plan, event.noteId).endTick)).toEqual([
      F02_ORACLE.chordDurationTicks,
      F02_ORACLE.chordDurationTicks,
      F02_ORACLE.chordDurationTicks,
    ]);
    expect(soundOf(plan, 'f02-lh-n1')).toMatchObject({ startTick: 0, midiNote: 48 });
  });

  it('F07 rests advance time without an attack or a highlight', () => {
    const plan = compile(F07);
    const ids = [...plan.events.map((e) => e.noteId), ...plan.highlights.map((h) => h.noteId)];
    expect(ids).not.toContain('f07-lh-r1');
    // The left hand rests through the quarter pickup, then enters with the right hand's bar 2.
    expect(soundOf(plan, 'f07-lh-n1').startTick).toBe(960);
    expect(soundOf(plan, 'f07-rh-n2').startTick).toBe(960);
    expect(plan.events.filter((event) => event.startTick === 0).map((e) => e.noteId)).toEqual([
      'f07-rh-n1',
    ]);
  });

  it('F05 F#4 and Gb4 both sound key 66, as two separate notes', () => {
    const plan = compile(F05);
    expect(plan.events.map((event) => [event.noteId, event.midiNote])).toEqual([
      [F05_ORACLE.sharpNoteId, F05_ORACLE.key],
      [F05_ORACLE.flatNoteId, F05_ORACLE.key],
    ]);
  });

  it('a key signature never adds an accidental: in G major a written F4 is 65, F#4 is 66', () => {
    const plan = compile(
      score({
        id: 'key-sig',
        keySignature: { fifths: 1 },
        staves: [
          staff('ks-rh', 'right', [
            bar('ks-m1', 1, [
              voice('ks-v1', [note('ks-f', 'F4', 'half'), note('ks-fs', 'F#4', 'half')]),
            ]),
          ]),
        ],
      }),
    );
    expect(plan.events.map((event) => event.midiNote)).toEqual([65, 66]);
  });

  it('F03 chord symbols, Roman numerals and scale degrees add no sound', () => {
    const plan = compile(F03);
    // 5 right-hand notes + 3 four-note left-hand chords, and nothing else.
    expect(plan.events).toHaveLength(17);
    expect(plan.highlights).toHaveLength(17);
    expect(soundOf(plan, 'f03-lh-c1-d').midiNote).toBe(50);
  });

  it('a unison between two voices sounds once while both written notes stay highlighted', () => {
    const plan = compile(
      score({
        id: 'unison',
        staves: [
          staff('u-rh', 'right', [
            bar('u-m1', 1, [
              voice('u-v1', [note('u-top', 'C5', 'half'), note('u-top2', 'D5', 'half')]),
              voice('u-v2', [
                note('u-low', 'C5', 'quarter'),
                rest('u-r', 'quarter'),
                note('u-low2', 'G4', 'half'),
              ]),
            ]),
          ]),
        ],
      }),
    );
    expect(plan.events.filter((event) => event.midiNote === 72)).toEqual([
      {
        noteId: 'u-top',
        tiedNoteIds: [],
        startTick: 0,
        durationTicks: 1728,
        midiNote: 72,
        velocity: 80,
      },
    ]);
    expect([spanOf(plan, 'u-top'), spanOf(plan, 'u-low')]).toEqual([
      { noteId: 'u-top', startTick: 0, endTick: 1920 },
      { noteId: 'u-low', startTick: 0, endTick: 960 },
    ]);
  });
});
