/**
 * AUDIO-07 (issue #6): asynchronous resources (RENDER_PLAYBACK_PORTS.md §4.3,
 * §4.4). Load tokens keep a late, older load from replacing a newer plan; a
 * failed asset or worklet load is recoverable; a malformed plan is rejected
 * without a token; unsubscribe and destroy release what the engine owns.
 */
import { F01, F02 } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  type PlaybackEngine,
  type PlaybackErrorCode,
  type PlaybackPlan,
  PlaybackError,
  createPlaybackController,
} from '../src';
import { FakeAudio } from './fake-synth';
import { compile } from './support';

function manualEngine() {
  const audio = new FakeAudio();
  audio.driver.prepareMode = 'manual';
  const engine = createPlaybackController(audio.driver, audio.clock.ticker);
  const prepare = (call: number) => {
    const deferred = audio.driver.prepareCalls[call];
    if (deferred === undefined) {
      throw new Error(`prepare() call ${call} was not made`);
    }
    return deferred;
  };
  return { audio, engine, prepare };
}

const planA = compile(F01);
const planB = compile(F02);

describe('AUDIO-07 asynchronous resources', () => {
  it('a newer load wins even when the older one finishes later', async () => {
    const { engine, prepare } = manualEngine();
    const older = engine.load(planA);
    const newer = engine.load(planB);
    prepare(1).resolve();
    await expect(newer).resolves.toEqual({ status: 'loaded', loadId: 2 });
    prepare(0).resolve();
    await expect(older).resolves.toEqual({ status: 'superseded', loadId: 1 });
    expect(engine.getSnapshot()).toMatchObject({ state: 'ready', loadId: 2, plan: planB });
  });

  it('an older load finishing first never commits its plan', async () => {
    const { engine, prepare } = manualEngine();
    const older = engine.load(planA);
    const newer = engine.load(planB);
    prepare(0).resolve();
    await expect(older).resolves.toEqual({ status: 'superseded', loadId: 1 });
    expect(engine.getSnapshot()).toMatchObject({ state: 'loading', loadId: 2, plan: null });
    prepare(1).resolve();
    await expect(newer).resolves.toEqual({ status: 'loaded', loadId: 2 });
    expect(engine.getSnapshot().plan).toBe(planB);
  });

  it('a late failure of an older load changes nothing', async () => {
    const { engine, prepare } = manualEngine();
    const older = engine.load(planA);
    const newer = engine.load(planB);
    prepare(1).resolve();
    await newer;
    prepare(0).reject(new PlaybackError('ASSET_LOAD_FAILED', 'late'));
    await expect(older).resolves.toEqual({ status: 'superseded', loadId: 1 });
    expect(engine.getSnapshot()).toMatchObject({ state: 'ready', plan: planB, error: null });
  });

  it.each<{ name: string; failure: unknown; code: PlaybackErrorCode }>([
    {
      name: 'SoundFont fetch or decode',
      failure: new PlaybackError('ASSET_LOAD_FAILED', 'sf'),
      code: 'ASSET_LOAD_FAILED',
    },
    {
      name: 'worklet start',
      failure: new PlaybackError('PLAYBACK_FAILED', 'worklet'),
      code: 'PLAYBACK_FAILED',
    },
    { name: 'unexpected driver error', failure: new Error('boom'), code: 'PLAYBACK_FAILED' },
  ])('a failed $name enters error and the next load recovers', async ({ failure, code }) => {
    const { engine, prepare } = manualEngine();
    const failing = engine.load(planA);
    prepare(0).reject(failure);
    await expect(failing).rejects.toMatchObject({ name: 'PlaybackError', code });
    expect(engine.getSnapshot()).toMatchObject({ state: 'error', plan: null, error: { code } });
    const retry = engine.load(planA);
    expect(engine.getSnapshot()).toMatchObject({ state: 'loading', error: null });
    prepare(1).resolve();
    await expect(retry).resolves.toEqual({ status: 'loaded', loadId: 2 });
    expect(engine.getSnapshot()).toMatchObject({ state: 'ready', plan: planA, error: null });
  });

  const malformed: { name: string; plan: PlaybackPlan }[] = [
    { name: 'ppq 480', plan: { ...planA, ppq: 480 as 960 } },
    {
      name: 'velocity 0',
      plan: { ...planA, events: planA.events.map((e) => ({ ...e, velocity: 0 })) },
    },
    {
      name: 'key outside the piano',
      plan: { ...planA, events: planA.events.map((e) => ({ ...e, midiNote: 20 })) },
    },
    { name: 'event past the end', plan: { ...planA, totalTicks: 3000 } },
    { name: 'unsorted events', plan: { ...planA, events: planA.events.toReversed() } },
    {
      name: 'a key overlapping itself',
      plan: {
        ...planA,
        events: planA.events.map((e) => ({ ...e, midiNote: 60, durationTicks: 1500 })),
      },
    },
  ];

  it.each(malformed)(
    'a malformed plan ($name) rejects INVALID_ARGUMENT without a token',
    async ({ plan }) => {
      const { engine, audio } = manualEngine();
      audio.driver.prepareMode = 'auto';
      await engine.load(planA);
      const before = engine.getSnapshot();
      await expect(engine.load(plan)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(engine.getSnapshot()).toBe(before);
    },
  );

  it('the snapshot keeps its identity until something in it changes', async () => {
    const { engine, audio } = manualEngine();
    audio.driver.prepareMode = 'auto';
    await engine.load(planA);
    const first = engine.getSnapshot();
    engine.setLoop(false);
    engine.setTempoMultiplier(1);
    engine.pause();
    expect(engine.getSnapshot()).toBe(first);
    engine.setLoop(true);
    expect(engine.getSnapshot()).not.toBe(first);
    expect(engine.getSnapshot()).toMatchObject({ loop: true, loadId: 1 });
  });

  it('unsubscribing (twice) stops notifications; other listeners keep theirs', async () => {
    const { engine, audio } = manualEngine();
    audio.driver.prepareMode = 'auto';
    const removed: number[] = [];
    const kept: number[] = [];
    const unsubscribe = engine.subscribe(() => removed.push(1));
    engine.subscribe(() => kept.push(1));
    const unsubscribePosition = engine.subscribePosition((tick) => removed.push(tick));
    unsubscribe();
    unsubscribe();
    unsubscribePosition();
    unsubscribePosition();
    await engine.load(planA);
    expect(removed).toEqual([]);
    expect(kept.length).toBeGreaterThan(0);
  });

  it('destroy supersedes a pending load, drops listeners silently and disposes the driver', async () => {
    const { engine, audio, prepare } = manualEngine();
    const notified: string[] = [];
    engine.subscribe(() => notified.push(engine.getSnapshot().state));
    const pending = engine.load(planA);
    engine.destroy();
    prepare(0).resolve();
    await expect(pending).resolves.toEqual({ status: 'superseded', loadId: 1 });
    expect(notified).toEqual(['loading']);
    expect(audio.driver.disposed).toBe(true);
    expect(engine.getSnapshot()).toMatchObject({ state: 'destroyed', plan: null });
  });

  it.each<{ name: string; interrupt: (engine: PlaybackEngine) => unknown }>([
    { name: 'stop', interrupt: (engine) => engine.stop() },
    { name: 'pause', interrupt: (engine) => engine.pause() },
    { name: 'load', interrupt: (engine) => engine.load(planB) },
    { name: 'destroy', interrupt: (engine) => engine.destroy() },
  ])(
    'a play() still pending when $name is called resolves without playing',
    async ({ interrupt }) => {
      const { engine, audio } = manualEngine();
      audio.driver.prepareMode = 'auto';
      await engine.load(planA);
      audio.driver.resumeBehavior = 'pending';
      const play = engine.play();
      interrupt(engine);
      audio.driver.pendingResumes[0]?.resolve();
      await expect(play).resolves.toBeUndefined();
      audio.advance(1);
      expect(engine.getSnapshot().state).not.toBe('playing');
      expect(audio.driver.attacks()).toEqual([]);
      expect(audio.clock.running).toBe(false);
    },
  );
});
