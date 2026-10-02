/**
 * PlaybackEngine fake that follows RENDER_PLAYBACK_PORTS.md §4: the state
 * table, load tokens with superseded outcomes, immutable identity-stable
 * snapshots and position notifications. Time is driven by the test
 * (`advance`), which is the fake clock; nothing uses real timers.
 */
import {
  type LoadOutcome,
  type PlaybackEngine,
  type PlaybackErrorCode,
  type PlaybackPlan,
  type PlaybackSnapshot,
  PPQ,
  PlaybackError,
  TEMPO_MULTIPLIER_RANGE,
} from '@sheet-music/playback-core';

interface PendingLoad {
  readonly loadId: number;
  readonly plan: PlaybackPlan;
  readonly resolve: (outcome: LoadOutcome) => void;
  readonly reject: (error: PlaybackError) => void;
}

export class FakePlaybackEngine implements PlaybackEngine {
  /** `manual`: loads stay pending until completeLoad()/failLoad(). */
  loadMode: 'auto' | 'manual' = 'auto';
  /** When set, auto loads fail with this code. */
  loadFailure: PlaybackErrorCode | null = null;
  /** When set, play() rejects with it and changes nothing. */
  playError: PlaybackError | null = null;
  /** When true, setTempoMultiplier() throws INVALID_ARGUMENT even for an in-range value. */
  rejectTempo = false;

  /** Plans of the accepted load() calls, in order. */
  readonly loads: PlaybackPlan[] = [];
  /** Multipliers passed to setTempoMultiplier() before destroy(), accepted or rejected, in order. */
  readonly tempoRequests: number[] = [];
  playCalls = 0;
  position = 0;
  destroyed = false;
  /** Commands received after destroy(): a correct player sends none. */
  readonly callsAfterDestroy: string[] = [];

  private snapshot: PlaybackSnapshot = {
    state: 'idle',
    loadId: 0,
    plan: null,
    tempoMultiplier: 1,
    loop: false,
    error: null,
  };
  private pending: PendingLoad | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly positionListeners = new Set<(tick: number) => void>();

  get listenerCount(): number {
    return this.listeners.size + this.positionListeners.size;
  }

  /** Notes sounding now: the plan's events under the position while playing. */
  get sounding(): readonly string[] {
    const { state, plan } = this.snapshot;
    if (state !== 'playing' || plan === null) {
      return [];
    }
    return plan.events
      .filter((e) => e.startTick <= this.position && this.position < e.startTick + e.durationTicks)
      .map((e) => e.noteId);
  }

  /** Sustain pedal state now: down only while playing inside a pedal span. */
  get pedalDown(): boolean {
    const { state, plan } = this.snapshot;
    if (state !== 'playing' || plan === null) {
      return false;
    }
    let down = false;
    for (const change of plan.pedal) {
      if (change.tick <= this.position) {
        down = change.type === 'down';
      }
    }
    return down;
  }

  load(plan: PlaybackPlan): Promise<LoadOutcome> {
    if (this.destroyed) {
      this.callsAfterDestroy.push('load');
      return Promise.resolve({ status: 'superseded', loadId: this.snapshot.loadId });
    }
    if (plan.ppq !== PPQ) {
      return Promise.reject(new PlaybackError('INVALID_ARGUMENT', 'fake: malformed plan'));
    }
    this.pending?.resolve({ status: 'superseded', loadId: this.pending.loadId });
    this.pending = null;
    this.loads.push(plan);
    const loadId = this.snapshot.loadId + 1;
    this.position = 0;
    this.update({ state: 'loading', loadId, plan: null, error: null });
    return new Promise<LoadOutcome>((resolve, reject) => {
      this.pending = { loadId, plan, resolve, reject };
      if (this.loadMode === 'auto') {
        queueMicrotask(() => {
          if (this.pending?.loadId !== loadId) {
            return;
          }
          if (this.loadFailure === null) {
            this.completeLoad();
          } else {
            this.failLoad(this.loadFailure);
          }
        });
      }
    });
  }

  completeLoad(): void {
    const pending = this.takePending();
    this.update({ state: 'ready', plan: pending.plan });
    this.emitPosition(0);
    pending.resolve({ status: 'loaded', loadId: pending.loadId });
  }

  failLoad(code: PlaybackErrorCode): void {
    const pending = this.takePending();
    const error = new PlaybackError(code, 'fake: load failed');
    this.update({ state: 'error', plan: null, error });
    pending.reject(error);
  }

  play(): Promise<void> {
    if (this.destroyed) {
      this.callsAfterDestroy.push('play');
      return Promise.resolve();
    }
    this.playCalls += 1;
    const { state } = this.snapshot;
    if (state !== 'ready' && state !== 'paused') {
      return Promise.resolve();
    }
    if (this.playError !== null) {
      return Promise.reject(this.playError);
    }
    this.update({ state: 'playing' });
    this.emitPosition(this.position);
    return Promise.resolve();
  }

  pause(): void {
    if (this.guard('pause') && this.snapshot.state === 'playing') {
      this.update({ state: 'paused' });
      this.emitPosition(this.position);
    }
  }

  stop(): void {
    if (
      this.guard('stop') &&
      (this.snapshot.state === 'playing' || this.snapshot.state === 'paused')
    ) {
      this.position = 0;
      this.update({ state: 'ready' });
      this.emitPosition(0);
    }
  }

  seek(tick: number): void {
    const { state, plan } = this.snapshot;
    if (!this.guard('seek') || plan === null) {
      return;
    }
    if (!(tick >= 0 && tick < plan.totalTicks)) {
      throw new PlaybackError('INVALID_ARGUMENT', 'fake: seek out of range');
    }
    this.position = tick;
    this.update({ state: state === 'playing' ? 'playing' : 'paused' });
    this.emitPosition(tick);
  }

  setTempoMultiplier(multiplier: number): void {
    if (!this.guard('setTempoMultiplier')) {
      return;
    }
    this.tempoRequests.push(multiplier);
    if (
      this.rejectTempo ||
      !Number.isFinite(multiplier) ||
      multiplier < TEMPO_MULTIPLIER_RANGE.min ||
      multiplier > TEMPO_MULTIPLIER_RANGE.max
    ) {
      throw new PlaybackError('INVALID_ARGUMENT', 'fake: tempo out of range');
    }
    this.update({ tempoMultiplier: multiplier });
  }

  setLoop(enabled: boolean): void {
    if (this.guard('setLoop')) {
      this.update({ loop: enabled });
    }
  }

  getSnapshot(): PlaybackSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.guard('subscribe');
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribePosition(listener: (tick: number) => void): () => void {
    this.guard('subscribePosition');
    this.positionListeners.add(listener);
    return () => {
      this.positionListeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.pending?.resolve({ status: 'superseded', loadId: this.pending.loadId });
    this.pending = null;
    this.listeners.clear();
    this.positionListeners.clear();
    this.snapshot = { ...this.snapshot, state: 'destroyed', plan: null, error: null };
  }

  /** Fake clock: moves a playing engine forward, wrapping or ending at the end of the pass. */
  advance(ticks: number): void {
    const { state, plan, loop } = this.snapshot;
    if (state !== 'playing' || plan === null) {
      throw new Error(`fake: cannot advance in state ${state}`);
    }
    const next = this.position + ticks;
    if (next < plan.totalTicks) {
      this.position = next;
    } else if (loop) {
      this.position = next % plan.totalTicks;
    } else {
      this.position = 0;
      this.update({ state: 'ready' });
    }
    this.emitPosition(this.position);
  }

  /** The audio output dies while playing. */
  breakAudio(): void {
    this.update({
      state: 'error',
      plan: null,
      error: new PlaybackError('PLAYBACK_FAILED', 'fake: audio broke'),
    });
  }

  private takePending(): PendingLoad {
    const pending = this.pending;
    if (pending === null) {
      throw new Error('fake: no pending load');
    }
    this.pending = null;
    return pending;
  }

  private guard(command: string): boolean {
    if (this.destroyed) {
      this.callsAfterDestroy.push(command);
    }
    return !this.destroyed;
  }

  private update(changes: Partial<PlaybackSnapshot>): void {
    const next = { ...this.snapshot, ...changes };
    const keys = Object.keys(next) as (keyof PlaybackSnapshot)[];
    if (keys.every((key) => next[key] === this.snapshot[key])) {
      return;
    }
    this.snapshot = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  private emitPosition(tick: number): void {
    for (const listener of [...this.positionListeners]) {
      listener(tick);
    }
  }
}
