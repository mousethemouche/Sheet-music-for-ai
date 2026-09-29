/**
 * AUDIO-06 (issue #6): engine state over a fake driver and a fake clock
 * (RENDER_PLAYBACK_PORTS.md §4.2). F01 at 120 bpm plays 1920 ticks per second
 * (a quarter every 0.5 s); F08 at 96 bpm plays 1536 ticks per second. Also
 * the source-note query at half-open boundaries, chords, rests and ties.
 */
import {
  F01,
  F02,
  F06,
  F07,
  F08,
  bar,
  note,
  rest,
  score,
  staff,
  voice,
} from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { type PlaybackPlan, PlaybackError, activeNoteIds, createPlaybackController } from '../src';
import { FakeAudio } from './fake-synth';
import { compile } from './support';

async function loaded(input = F01) {
  const audio = new FakeAudio();
  const engine = createPlaybackController(audio.driver, audio.clock.ticker);
  const plan = compile(input);
  await engine.load(plan);
  const positions: number[] = [];
  engine.subscribePosition((tick) => positions.push(tick));
  return { audio, engine, plan, positions, keys: () => audio.driver.attacks().map((a) => a.key) };
}

const lastOf = (values: readonly number[]): number | undefined => values.at(-1);

function expectInvalidArgument(action: () => void): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PlaybackError);
  expect((thrown as PlaybackError).code).toBe('INVALID_ARGUMENT');
}

describe('AUDIO-06 engine state', () => {
  it('load commits the plan: ready at tick 0, nothing sounding', async () => {
    const { engine, plan, positions, audio } = await loaded();
    expect(engine.getSnapshot()).toMatchObject({ state: 'ready', loadId: 1, plan, error: null });
    expect(positions).toEqual([]);
    expect(audio.driver.attacks()).toEqual([]);
  });

  it('play sounds from tick 0 and the position follows the audio clock', async () => {
    const { engine, audio, positions, keys } = await loaded();
    await engine.play();
    expect(engine.getSnapshot().state).toBe('playing');
    audio.advance(0.25);
    expect(lastOf(positions)).toBe(480);
    audio.advance(0.75);
    expect(lastOf(positions)).toBe(1920);
    expect(keys()).toEqual([60, 62, 64]);
  });

  it('pause keeps the position and silences; play resumes there without re-striking', async () => {
    const { engine, audio, positions, keys } = await loaded();
    await engine.play();
    audio.advance(0.6);
    engine.pause();
    expect(engine.getSnapshot().state).toBe('paused');
    expect(lastOf(positions)).toBe(1152);
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
    audio.advance(1);
    expect(keys()).toEqual([60, 62]);

    await engine.play();
    audio.advance(0.5);
    // E4 (tick 1920) sounds 768 ticks = 0.4 s after resuming at tick 1152; D4 is not struck again.
    expect(audio.driver.attacks().map(({ key, time }) => [key, Math.round(time * 1000)])).toEqual([
      [60, 0],
      [62, 500],
      [64, 2000],
    ]);
  });

  it('stop releases notes and pedal at once and returns to ready at tick 0', async () => {
    const { engine, audio, positions } = await loaded(F08);
    await engine.play();
    audio.advance(5.2); // inside pedal f08-p1 (tick 7680 = 5 s), G4 and G2 sounding
    expect(audio.driver.soundAt()).toEqual({ keys: [43, 67], pedalDown: true });
    engine.stop();
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
    expect(engine.getSnapshot().state).toBe('ready');
    expect(lastOf(positions)).toBe(0);
    audio.advance(1);
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
  });

  it('seek while playing releases, does not re-strike and takes the pedal state at the target', async () => {
    const { engine, audio, positions } = await loaded(F08);
    await engine.play();
    audio.advance(1);
    const before = audio.driver.attacks().length;
    engine.seek(8000); // inside tie chain f08-rh-n9 and pedal f08-p1
    expect(engine.getSnapshot().state).toBe('playing');
    expect(lastOf(positions)).toBe(8000);
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: true });
    audio.advance(2); // up to tick 11072: only f08-rh-n11 (G4 at 10560) is a new attack
    expect(
      audio.driver
        .attacks()
        .slice(before)
        .map((attack) => attack.key),
    ).toEqual([67]);
  });

  it('seek from ready moves to paused at the tick; play starts exactly there', async () => {
    const { engine, positions, keys } = await loaded();
    engine.seek(1920);
    expect(engine.getSnapshot().state).toBe('paused');
    expect(lastOf(positions)).toBe(1920);
    await engine.play();
    expect(keys()).toEqual([64]);
  });

  it.each([
    { name: 'first tick', tick: 0, valid: true },
    { name: 'last tick', tick: 3839, valid: true },
    { name: 'fractional tick', tick: 959.5, valid: true },
    { name: 'end of the plan', tick: 3840, valid: false },
    { name: 'negative', tick: -1, valid: false },
    { name: 'NaN', tick: Number.NaN, valid: false },
    { name: 'infinity', tick: Number.POSITIVE_INFINITY, valid: false },
  ])('seek endpoint: $name ($tick) valid=$valid', async ({ tick, valid }) => {
    const { engine } = await loaded();
    const before = engine.getSnapshot();
    if (valid) {
      engine.seek(tick);
      expect(engine.getSnapshot().state).toBe('paused');
    } else {
      expectInvalidArgument(() => engine.seek(tick));
      expect(engine.getSnapshot()).toBe(before);
    }
  });

  it.each([
    { multiplier: 0.25, valid: true },
    { multiplier: 2, valid: true },
    { multiplier: 0.2, valid: false },
    { multiplier: 2.5, valid: false },
    { multiplier: Number.NaN, valid: false },
    { multiplier: Number.POSITIVE_INFINITY, valid: false },
  ])('tempo multiplier $multiplier valid=$valid', async ({ multiplier, valid }) => {
    const { engine } = await loaded();
    const before = engine.getSnapshot();
    if (valid) {
      engine.setTempoMultiplier(multiplier);
      expect(engine.getSnapshot().tempoMultiplier).toBe(multiplier);
    } else {
      expectInvalidArgument(() => engine.setTempoMultiplier(multiplier));
      expect(engine.getSnapshot()).toBe(before);
    }
  });

  it('a tempo change while playing applies at once without moving the position', async () => {
    const { engine, audio, positions } = await loaded();
    await engine.play();
    audio.advance(0.25);
    expect(lastOf(positions)).toBe(480);
    engine.setTempoMultiplier(2);
    audio.advance(0.25);
    expect(lastOf(positions)).toBe(1440);
    engine.setTempoMultiplier(0.25);
    audio.advance(1);
    expect(lastOf(positions)).toBe(1920);
    expect(engine.getSnapshot()).toMatchObject({ state: 'playing', tempoMultiplier: 0.25 });
  });

  it('a tempo rise inside the look-ahead of a short note never leaves its key held', async () => {
    // One 60-tick note at tick 190 at 120 bpm: its note-on (0.099 s) is handed
    // over at once; doubling the tempo would time its note-off at 0.065 s.
    const plan: PlaybackPlan = {
      scoreId: 'short',
      revision: 1,
      ppq: 960,
      bpm: 120,
      totalTicks: 3840,
      expressionPolicyVersion: 1,
      events: [
        {
          noteId: 'n',
          tiedNoteIds: [],
          startTick: 190,
          durationTicks: 60,
          midiNote: 60,
          velocity: 80,
        },
      ],
      pedal: [],
      highlights: [{ noteId: 'n', startTick: 190, endTick: 250 }],
    };
    const audio = new FakeAudio();
    const engine = createPlaybackController(audio.driver, audio.clock.ticker);
    await engine.load(plan);
    await engine.play();
    engine.setTempoMultiplier(2);
    audio.advance(0.5);
    expect(audio.driver.attacks().map((attack) => attack.key)).toEqual([60]);
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
    audio.advance(2);
    expect(engine.getSnapshot().state).toBe('ready');
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
  });

  it('F06: switching from 1x to 2x at any ticker step leaves nothing held after the pass', async () => {
    const plan = compile(F06);
    // 1x: 1920 ticks per second; the pass lasts totalTicks / 1920 s.
    const steps = Math.floor((plan.totalTicks / 1920) * 40);
    const held: number[] = [];
    for (let step = 0; step < steps; step += 1) {
      const audio = new FakeAudio();
      const engine = createPlaybackController(audio.driver, audio.clock.ticker);
      await engine.load(plan);
      await engine.play();
      audio.advance(step * 0.025);
      engine.setTempoMultiplier(2);
      audio.advance(plan.totalTicks / 1920);
      if (engine.getSnapshot().state !== 'ready' || audio.driver.soundAt().keys.length > 0) {
        held.push(step);
      }
    }
    expect(held).toEqual([]);
  });

  it('end of a pass with loop off: ready at tick 0, nothing sounding, no more attacks', async () => {
    const { engine, audio, positions, keys } = await loaded();
    await engine.play();
    audio.advance(2.1);
    expect(engine.getSnapshot().state).toBe('ready');
    expect(lastOf(positions)).toBe(0);
    expect(audio.clock.running).toBe(false);
    audio.advance(2);
    expect(keys()).toEqual([60, 62, 64, 65]);
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
  });

  it('loop on: wraps to tick 0 with everything released and attacks each note once per pass', async () => {
    const { engine, audio, positions, keys } = await loaded(F08);
    engine.setLoop(true);
    await engine.play();
    audio.advance(9.975); // the pass lasts 15360 / 1536 = 10 s
    expect(lastOf(positions)).toBeLessThan(15360);
    audio.advance(0.025);
    expect(lastOf(positions)).toBe(0);
    expect(engine.getSnapshot().state).toBe('playing');
    // At the wrap every note and the pedal of the first pass are released:
    // only the first notes of the second pass (C4 and C3) sound.
    expect(audio.driver.soundAt(10)).toEqual({ keys: [48, 60], pedalDown: false });
    const firstPass = audio.driver.attacks(9.99).map((attack) => attack.key);
    expect(firstPass).toHaveLength(compile(F08).events.length);
    audio.advance(9.9);
    expect(keys()).toEqual([...firstPass, ...firstPass]);
  });

  it('loop on: the next pass starts exactly one pass length later, whatever the ticker phase', async () => {
    // At 0.9x a 3840-tick pass lasts 3840 / (1920 x 0.9) = 2.2222 s: not a multiple of 25 ms.
    const { engine, audio } = await loaded();
    engine.setLoop(true);
    engine.setTempoMultiplier(0.9);
    await engine.play();
    audio.advance(4.4); // two passes (4.444 s), none of the third
    const times = audio.driver.attacks().map((attack) => attack.time);
    expect(times).toHaveLength(8);
    const pass = 3840 / (1920 * 0.9);
    times.slice(0, 4).forEach((time, index) => {
      expect(times[index + 4]).toBeCloseTo(time + pass, 9);
    });
  });

  it('loop turned off after the next pass was handed over: it never sounds', async () => {
    const { engine, audio, keys } = await loaded();
    engine.setLoop(true);
    await engine.play();
    audio.advance(1.95); // the next pass's first note (at 2 s) is inside the look-ahead
    engine.setLoop(false);
    audio.advance(1);
    expect(keys()).toEqual([60, 62, 64, 65]);
    expect(engine.getSnapshot().state).toBe('ready');
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
  });

  it('never schedules an event twice across repeated pause and resume', async () => {
    const { engine, audio, keys } = await loaded();
    // 19 x 0.1 s of playing, then the last 0.1 s of the 2 s bar.
    for (let step = 0; step < 19; step += 1) {
      await engine.play();
      audio.advance(0.1);
      engine.pause();
      audio.advance(0.05);
    }
    await engine.play();
    audio.advance(0.5);
    expect(keys()).toEqual([60, 62, 64, 65]);
  });

  it('load while playing silences at once and ends ready at tick 0, never playing, even with loop on', async () => {
    const { engine, audio } = await loaded(F08);
    engine.setLoop(true);
    await engine.play();
    audio.advance(5.2);
    const next = engine.load(compile(F01));
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
    expect(engine.getSnapshot()).toMatchObject({ state: 'loading', plan: null, loop: true });
    await expect(next).resolves.toEqual({ status: 'loaded', loadId: 2 });
    audio.advance(1);
    expect(engine.getSnapshot().state).toBe('ready');
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
  });

  it('a failed play() rejects with PLAYBACK_FAILED and leaves the state unchanged', async () => {
    const { engine, audio } = await loaded();
    audio.driver.resumeBehavior = new Error('NotAllowedError');
    await expect(engine.play()).rejects.toMatchObject({ code: 'PLAYBACK_FAILED' });
    expect(engine.getSnapshot().state).toBe('ready');
    audio.driver.resumeBehavior = 'resolve';
    await engine.play();
    expect(engine.getSnapshot().state).toBe('playing');
  });

  it('audio breaking while playing enters error, silent and without plan; load recovers', async () => {
    const { engine, audio, plan } = await loaded();
    await engine.play();
    audio.advance(0.1);
    const error = new PlaybackError('PLAYBACK_FAILED', 'device lost');
    audio.driver.breakAudio(error);
    expect(engine.getSnapshot()).toMatchObject({ state: 'error', plan: null, error });
    expect(audio.driver.soundAt()).toEqual({ keys: [], pedalDown: false });
    await engine.load(plan);
    expect(engine.getSnapshot()).toMatchObject({ state: 'ready', error: null });
  });

  it('destroy stops everything; later commands are no-ops and load resolves superseded', async () => {
    const { engine, audio, positions } = await loaded();
    const notified: string[] = [];
    engine.subscribe(() => notified.push(engine.getSnapshot().state));
    await engine.play();
    audio.advance(0.3);
    const emitted = positions.length;
    engine.destroy();
    expect(engine.getSnapshot().state).toBe('destroyed');
    expect(audio.driver.disposed).toBe(true);
    expect(audio.clock.running).toBe(false);
    expect(notified).toEqual(['playing']);
    await engine.play();
    engine.seek(10);
    engine.setTempoMultiplier(5);
    engine.destroy();
    await expect(engine.load(compile(F01))).resolves.toEqual({ status: 'superseded', loadId: 1 });
    audio.advance(1);
    expect(positions).toHaveLength(emitted);
  });
});

describe('AUDIO-06 active source notes (half-open spans)', () => {
  const f01 = compile(F01);
  const f02 = compile(F02);
  const f07 = compile(F07);
  const f08 = compile(F08);
  const withRest = compile(
    score({
      id: 'rs',
      staves: [
        staff('rs-rh', 'right', [
          bar('rs-m1', 1, [
            voice('rs-v1', [
              note('rs-n1', 'C4', 'quarter'),
              rest('rs-r1', 'quarter'),
              note('rs-n2', 'D4', 'half'),
            ]),
          ]),
        ]),
      ],
    }),
  );

  it.each([
    { name: 'first tick', plan: f01, tick: 0, ids: ['f01-n1'] },
    { name: 'just before a boundary', plan: f01, tick: 959, ids: ['f01-n1'] },
    { name: 'fractional tick', plan: f01, tick: 959.5, ids: ['f01-n1'] },
    { name: 'at the boundary: only the next note', plan: f01, tick: 960, ids: ['f01-n2'] },
    { name: 'last tick', plan: f01, tick: 3839, ids: ['f01-n4'] },
    { name: 'end of the plan', plan: f01, tick: 3840, ids: [] },
    { name: 'before the start', plan: f01, tick: -1, ids: [] },
    { name: 'NaN', plan: f01, tick: Number.NaN, ids: [] },
    {
      name: 'chord and the other hand',
      plan: f02,
      tick: 0,
      ids: ['f02-c1-c', 'f02-c1-e', 'f02-c1-g', 'f02-lh-n1'],
    },
    { name: 'rest in the other hand', plan: f07, tick: 0, ids: ['f07-rh-n1'] },
    { name: 'rest everywhere', plan: withRest, tick: 960, ids: [] },
    { name: 'tie start', plan: f08, tick: 9599, ids: ['f08-rh-n9', 'f08-lh-n3'] },
    {
      name: 'tied continuation from its own start',
      plan: f08,
      tick: 9600,
      ids: ['f08-lh-n3', 'f08-rh-n10'],
    },
  ])('$name: tick $tick -> $ids', ({ plan, tick, ids }) => {
    expect(activeNoteIds(plan, tick)).toEqual(ids);
  });
});
