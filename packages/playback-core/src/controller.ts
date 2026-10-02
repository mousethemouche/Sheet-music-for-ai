/**
 * Playback engine controller (issue #6, PLAYBACK_POLICY_V1.md §6): the
 * PlaybackEngine semantics of RENDER_PLAYBACK_PORTS.md §4 (state machine,
 * load tokens, errors, position) over a narrow SynthDriver. An adapter
 * package supplies only the driver and a ticker, so every engine rule is
 * shared and unit-testable with a fake driver and a fake clock.
 *
 * Scheduling: while playing, each tick of the ticker hands the driver every
 * note-on, note-off and pedal change due within LOOK_AHEAD_SECONDS of the
 * audio clock, timestamped on that clock. Each action is handed over at most
 * once per pass, and handed times never go back. With loop on, the next
 * pass's first actions are handed over before the pass ends, from the exact
 * end time, so passes join without a gap. stop, pause, seek, load and an
 * audio failure call driver.silence(), which also cancels whatever was handed
 * over but has not sounded yet; the end of a pass calls it only when
 * something is still pending; destroy disposes the driver.
 */
import {
  type LoadOutcome,
  type PlaybackEngine,
  type PlaybackSnapshot,
  TEMPO_MULTIPLIER_RANGE,
} from './engine';
import { PlaybackError } from './errors';
import { type PlaybackPlan, PPQ } from './plan';

/**
 * What the controller needs from a synthesizer. Times are seconds on the
 * driver's audio clock; a time already past means "now".
 */
export interface SynthDriver {
  /**
   * Makes the synthesizer ready to sound: fetches and decodes the assets on
   * the first call, resolves at once once ready, retries after a failure.
   * Rejects with a PlaybackError (ASSET_LOAD_FAILED or PLAYBACK_FAILED).
   */
  prepare(): Promise<void>;
  /** Starts or resumes audio output. Called synchronously inside play() (the user gesture). */
  resume(): Promise<void>;
  /** The audio clock, in seconds. It only advances while output runs. */
  currentTime(): number;
  noteOn(key: number, velocity: number, time: number): void;
  noteOff(key: number, time: number): void;
  sustain(down: boolean, time: number): void;
  /**
   * Releases every note and the pedal now, and cancels everything handed over
   * for the current time or later, so a resumed run may hand it over again.
   */
  silence(): void;
  /** Sets the listener called when audio output breaks. */
  onFailure(listener: (error: PlaybackError) => void): void;
  /** Releases every audio resource. Final. */
  dispose(): void;
}

/** Calls `onTick` repeatedly (the browser adapter: every 25 ms) until the returned function is called. */
export type PlaybackTicker = (onTick: () => void) => () => void;

/** How far ahead of the audio clock actions are handed to the driver. */
const LOOK_AHEAD_SECONDS = 0.1;

/** Order of actions sharing a tick: note-offs, pedal up, pedal down, note-ons. */
const NOTE_OFF = 0;
const PEDAL_UP = 1;
const PEDAL_DOWN = 2;
const NOTE_ON = 3;
type ActionKind = typeof NOTE_OFF | typeof PEDAL_UP | typeof PEDAL_DOWN | typeof NOTE_ON;

interface Action {
  readonly tick: number;
  readonly kind: ActionKind;
  readonly key: number;
  readonly velocity: number;
}

function toActions(plan: PlaybackPlan): Action[] {
  const actions: Action[] = [];
  for (const event of plan.events) {
    const { startTick, midiNote: key, velocity } = event;
    actions.push({ tick: startTick, kind: NOTE_ON, key, velocity });
    actions.push({ tick: startTick + event.durationTicks, kind: NOTE_OFF, key, velocity: 0 });
  }
  for (const change of plan.pedal) {
    const kind = change.type === 'down' ? PEDAL_DOWN : PEDAL_UP;
    actions.push({ tick: change.tick, kind, key: 0, velocity: 0 });
  }
  return actions.sort((a, b) => a.tick - b.tick || a.kind - b.kind);
}

const isTick = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** Cheap structural check of RENDER_PLAYBACK_PORTS.md §3.2/§3.3; returns the first problem. */
function planProblem(plan: PlaybackPlan): string | undefined {
  if (plan.ppq !== PPQ) {
    return 'ppq must be 960';
  }
  if (!Number.isFinite(plan.bpm) || plan.bpm <= 0) {
    return 'bpm must be a positive number';
  }
  if (!isTick(plan.totalTicks) || plan.totalTicks === 0) {
    return 'totalTicks must be a positive integer';
  }
  let previousStart = 0;
  const keyFreeAt = new Map<number, number>();
  for (const event of plan.events) {
    const end = event.startTick + event.durationTicks;
    if (!isTick(event.startTick) || event.startTick < previousStart) {
      return 'events must have integer start ticks in ascending order';
    }
    if (!isTick(event.durationTicks) || event.durationTicks < 1 || end > plan.totalTicks) {
      return 'event durations must be >= 1 and end by totalTicks';
    }
    if (!Number.isInteger(event.midiNote) || event.midiNote < 21 || event.midiNote > 108) {
      return 'midiNote must be a piano key (21..108)';
    }
    if (!Number.isInteger(event.velocity) || event.velocity < 1 || event.velocity > 127) {
      return 'velocity must be 1..127';
    }
    if ((keyFreeAt.get(event.midiNote) ?? 0) > event.startTick) {
      return 'a key must not overlap itself';
    }
    keyFreeAt.set(event.midiNote, end);
    previousStart = event.startTick;
  }
  let previousTick = 0;
  for (const change of plan.pedal) {
    if (!isTick(change.tick) || change.tick < previousTick || change.tick > plan.totalTicks) {
      return 'pedal changes must be integer ticks in ascending order within the plan';
    }
    previousTick = change.tick;
  }
  return undefined;
}

const asPlaybackError = (cause: unknown): PlaybackError =>
  cause instanceof PlaybackError
    ? cause
    : new PlaybackError('PLAYBACK_FAILED', 'The synthesizer failed.', { cause });

/**
 * One uninterrupted stretch of playing. Its run ticks keep counting across
 * loop passes: run tick `anchorTick` sounds at audio time `anchorTime`.
 */
interface Run {
  readonly plan: PlaybackPlan;
  readonly actions: readonly Action[];
  anchorTick: number;
  anchorTime: number;
  ticksPerSecond: number;
  /** Run tick where the pass being played starts. */
  passStart: number;
  /** Run tick where the pass being handed over starts: `passStart`, or the next pass near a loop wrap. */
  scheduleStart: number;
  /** Index, in `actions`, of that pass's next action to hand to the driver. */
  next: number;
  /** Latest time handed to the driver. */
  lastScheduledTime: number;
  stopTicker: () => void;
}

type SnapshotChanges = { -readonly [K in keyof PlaybackSnapshot]?: PlaybackSnapshot[K] };

export function createPlaybackController(
  driver: SynthDriver,
  ticker: PlaybackTicker,
): PlaybackEngine {
  let snapshot: PlaybackSnapshot = Object.freeze({
    state: 'idle',
    loadId: 0,
    plan: null,
    tempoMultiplier: 1,
    loop: false,
    error: null,
  });
  const listeners = new Set<{ readonly notify: () => void }>();
  const positionListeners = new Set<{ readonly notify: (tick: number) => void }>();
  /** Actions of the committed plan. */
  let actions: readonly Action[] = [];
  /** Position while not playing. */
  let position = 0;
  let lastEmitted: number | undefined;
  let run: Run | undefined;
  let pendingPlay: Promise<void> | undefined;
  let playRequest = 0;

  function update(changes: SnapshotChanges): void {
    const next = { ...snapshot, ...changes };
    const keys = Object.keys(changes) as (keyof PlaybackSnapshot)[];
    if (keys.every((key) => next[key] === snapshot[key])) {
      return;
    }
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) {
      listener.notify();
    }
  }

  function emitPosition(tick: number): void {
    lastEmitted = tick;
    for (const listener of [...positionListeners]) {
      listener.notify(tick);
    }
  }

  const ticksPerSecond = (plan: PlaybackPlan, multiplier: number): number =>
    (PPQ * plan.bpm * multiplier) / 60;
  const tickAt = (current: Run, time: number): number =>
    current.anchorTick + (time - current.anchorTime) * current.ticksPerSecond;
  const timeAt = (current: Run, tick: number): number =>
    current.anchorTime + (tick - current.anchorTick) / current.ticksPerSecond;

  /** Hands the driver every action due within the look-ahead, crossing into the next pass when looping. */
  function schedule(current: Run, now: number): void {
    const total = current.plan.totalTicks;
    const horizon = tickAt(current, now + LOOK_AHEAD_SECONDS);
    for (;;) {
      const action = current.actions[current.next];
      if (action === undefined) {
        // Loop on: the next pass starts exactly where this one ends. Only one
        // pass ahead, and only while that boundary is still to come (after a
        // stalled timer the wrap restarts from the current time instead).
        const nextStart = current.scheduleStart + total;
        const first = current.actions[0];
        if (
          !snapshot.loop ||
          first === undefined ||
          current.scheduleStart !== current.passStart ||
          timeAt(current, nextStart) < now ||
          nextStart + first.tick > horizon
        ) {
          return;
        }
        current.scheduleStart = nextStart;
        current.next = 0;
        continue;
      }
      const tick = current.scheduleStart + action.tick;
      if (tick > horizon) {
        return;
      }
      current.next += 1;
      // Handed times never go back: after a tempo rise an action timed at the
      // new rate could fall before one handed at the old rate (a note-off
      // before its own note-on would leave the key held).
      const time = Math.max(timeAt(current, tick), current.lastScheduledTime);
      current.lastScheduledTime = time;
      if (action.kind === NOTE_ON) {
        driver.noteOn(action.key, action.velocity, time);
      } else if (action.kind === NOTE_OFF) {
        driver.noteOff(action.key, time);
      } else {
        driver.sustain(action.kind === PEDAL_DOWN, time);
      }
    }
  }

  /**
   * Starts sounding at `fromTick`: actions from that tick on are handed over,
   * notes attacked earlier are not struck again, and the pedal takes its state
   * at that tick.
   */
  function startRun(plan: PlaybackPlan, fromTick: number): void {
    const now = driver.currentTime();
    const current: Run = {
      plan,
      actions,
      anchorTick: fromTick,
      anchorTime: now,
      ticksPerSecond: ticksPerSecond(plan, snapshot.tempoMultiplier),
      passStart: 0,
      scheduleStart: 0,
      next: actions.findIndex((action) => action.tick >= fromTick),
      lastScheduledTime: now,
      stopTicker: () => undefined,
    };
    if (current.next === -1) {
      current.next = actions.length;
    }
    run = current;
    const pedalDown = plan.pedal.findLast((change) => change.tick < fromTick)?.type === 'down';
    if (pedalDown) {
      driver.sustain(true, now);
    }
    schedule(current, now);
    current.stopTicker = ticker(() => sync(current));
  }

  function endRun(silence: boolean): void {
    if (run === undefined) {
      return;
    }
    run.stopTicker();
    run = undefined;
    if (silence) {
      driver.silence();
    }
  }

  /** Position in the pass being played. */
  const positionAt = (current: Run, time: number): number =>
    tickAt(current, time) - current.passStart;

  /** Brings a run up to the audio clock: hands over due actions, reports the position, ends the pass. */
  function sync(current: Run): void {
    if (run !== current) {
      return;
    }
    const now = driver.currentTime();
    schedule(current, now);
    const total = current.plan.totalTicks;
    let wrapped = false;
    if (positionAt(current, now) >= total && current.scheduleStart > current.passStart) {
      // Loop wrap: the plan's own note-offs and pedal-up ended the pass, and
      // the next pass was handed over from its exact start.
      current.passStart = current.scheduleStart;
      wrapped = true;
    }
    const tick = positionAt(current, now);
    if (tick < total) {
      if (wrapped || tick !== lastEmitted) {
        emitPosition(tick);
      }
      return;
    }
    // End of the pass with nothing handed over for a next one (loop off, or a
    // stalled timer): silence only what a tempo change left pending.
    endRun(current.lastScheduledTime > now);
    if (snapshot.loop) {
      startRun(current.plan, 0);
    } else {
      position = 0;
      update({ state: 'ready' });
    }
    emitPosition(0);
  }

  function cancelPendingPlay(): void {
    playRequest += 1;
    pendingPlay = undefined;
  }

  const canPlay = (): boolean => snapshot.state === 'ready' || snapshot.state === 'paused';

  driver.onFailure((error) => {
    if (run === undefined) {
      return;
    }
    endRun(true);
    actions = [];
    position = 0;
    update({ state: 'error', plan: null, error });
  });

  return {
    load(plan) {
      if (snapshot.state === 'destroyed') {
        return Promise.resolve({ status: 'superseded', loadId: snapshot.loadId });
      }
      const problem = planProblem(plan);
      if (problem !== undefined) {
        return Promise.reject(new PlaybackError('INVALID_ARGUMENT', `Malformed plan: ${problem}.`));
      }
      cancelPendingPlay();
      endRun(true);
      actions = [];
      position = 0;
      const loadId = snapshot.loadId + 1;
      update({ state: 'loading', loadId, plan: null, error: null });
      const superseded = (): LoadOutcome => ({ status: 'superseded', loadId });
      const isLatest = (): boolean => snapshot.loadId === loadId && snapshot.state === 'loading';
      let prepared: Promise<void>;
      try {
        prepared = driver.prepare();
      } catch (cause) {
        prepared = Promise.reject(asPlaybackError(cause));
      }
      return prepared.then(
        (): LoadOutcome => {
          if (!isLatest()) {
            return superseded();
          }
          actions = toActions(plan);
          update({ state: 'ready', plan });
          emitPosition(0);
          return { status: 'loaded', loadId };
        },
        (cause: unknown): LoadOutcome => {
          if (!isLatest()) {
            return superseded();
          }
          const error = asPlaybackError(cause);
          update({ state: 'error', error });
          throw error;
        },
      );
    },

    play() {
      if (!canPlay()) {
        return Promise.resolve();
      }
      if (pendingPlay !== undefined) {
        return pendingPlay;
      }
      const request = ++playRequest;
      let resumed: Promise<void>;
      try {
        resumed = driver.resume();
      } catch (cause) {
        resumed = Promise.reject(asPlaybackError(cause));
      }
      const played = resumed.then(
        () => {
          if (request !== playRequest) {
            return;
          }
          pendingPlay = undefined;
          if (canPlay() && snapshot.plan !== null) {
            startRun(snapshot.plan, position);
            update({ state: 'playing' });
          }
        },
        (cause: unknown) => {
          if (request !== playRequest) {
            return;
          }
          pendingPlay = undefined;
          throw new PlaybackError('PLAYBACK_FAILED', 'Audio output could not start.', { cause });
        },
      );
      pendingPlay = played;
      return played;
    },

    pause() {
      cancelPendingPlay();
      if (run !== undefined) {
        sync(run);
      }
      if (run === undefined) {
        return;
      }
      position = positionAt(run, driver.currentTime());
      endRun(true);
      update({ state: 'paused' });
      emitPosition(position);
    },

    stop() {
      cancelPendingPlay();
      if (snapshot.state !== 'playing' && snapshot.state !== 'paused') {
        return;
      }
      endRun(true);
      position = 0;
      update({ state: 'ready' });
      emitPosition(0);
    },

    seek(tick) {
      const { plan, state } = snapshot;
      if (plan === null || (state !== 'ready' && state !== 'paused' && state !== 'playing')) {
        return;
      }
      if (!Number.isFinite(tick) || tick < 0 || tick >= plan.totalTicks) {
        throw new PlaybackError(
          'INVALID_ARGUMENT',
          `Seek tick must be in [0, ${plan.totalTicks}).`,
        );
      }
      position = tick;
      if (run !== undefined) {
        endRun(true);
        startRun(plan, tick);
      } else {
        update({ state: 'paused' });
      }
      emitPosition(tick);
    },

    setTempoMultiplier(multiplier) {
      if (snapshot.state === 'destroyed') {
        return;
      }
      const { min, max } = TEMPO_MULTIPLIER_RANGE;
      if (!Number.isFinite(multiplier) || multiplier < min || multiplier > max) {
        throw new PlaybackError(
          'INVALID_ARGUMENT',
          `Tempo multiplier must be a number from ${min} to ${max}.`,
        );
      }
      if (multiplier === snapshot.tempoMultiplier) {
        return;
      }
      if (run !== undefined) {
        // Re-anchor at the current position: the position never jumps. Actions
        // already handed to the driver (within the look-ahead) keep their times.
        const now = driver.currentTime();
        run.anchorTick = tickAt(run, now);
        run.anchorTime = now;
        run.ticksPerSecond = ticksPerSecond(run.plan, multiplier);
      }
      update({ tempoMultiplier: multiplier });
    },

    setLoop(enabled) {
      if (snapshot.state === 'destroyed') {
        return;
      }
      update({ loop: enabled });
      if (!enabled && run !== undefined && run.scheduleStart > run.passStart) {
        // The next pass had started to be handed over: take it back, and play
        // on to the end from here (what sounds now is released).
        const current = run;
        const from = Math.min(positionAt(current, driver.currentTime()), current.plan.totalTicks);
        endRun(true);
        startRun(current.plan, from);
      }
    },

    getSnapshot: () => snapshot,

    subscribe(notify) {
      const entry = { notify };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },

    subscribePosition(notify) {
      const entry = { notify };
      positionListeners.add(entry);
      return (): void => {
        positionListeners.delete(entry);
      };
    },

    destroy() {
      if (snapshot.state === 'destroyed') {
        return;
      }
      listeners.clear();
      positionListeners.clear();
      cancelPendingPlay();
      endRun(false);
      actions = [];
      snapshot = Object.freeze({ ...snapshot, state: 'destroyed', plan: null, error: null });
      driver.dispose();
    },
  };
}
