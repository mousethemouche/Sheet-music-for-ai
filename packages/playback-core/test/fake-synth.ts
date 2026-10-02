/**
 * Fake synthesizer driver and fake ticker for the engine tests (AUDIO-01,
 * AUDIO-06, AUDIO-07). The driver records what the controller hands it and
 * models the sound it would make: a note sounds from its note-on to its
 * note-off, silence() releases everything and cancels what was scheduled for
 * later. The audio clock only moves when a test advances it.
 */
import type { PlaybackError, PlaybackTicker, SynthDriver } from '../src';

interface Scheduled {
  readonly kind: 'on' | 'off' | 'pedal' | 'release';
  readonly key: number;
  readonly velocity: number;
  readonly down: boolean;
  readonly time: number;
  readonly order: number;
}

export interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

export function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export class FakeSynthDriver implements SynthDriver {
  /** Audio clock in seconds. */
  time = 0;
  /** 'auto' resolves every prepare() at once; 'manual' queues them in `prepareCalls`. */
  prepareMode: 'auto' | 'manual' = 'auto';
  readonly prepareCalls: Deferred[] = [];
  /** What resume() does: resolve, reject with this error, or stay pending in `pendingResumes`. */
  resumeBehavior: 'resolve' | 'pending' | Error = 'resolve';
  readonly pendingResumes: Deferred[] = [];
  resumeCalls = 0;
  silenceCalls = 0;
  disposed = false;
  private entries: Scheduled[] = [];
  private order = 0;
  private failureListener: ((error: PlaybackError) => void) | undefined;

  prepare(): Promise<void> {
    if (this.prepareMode === 'auto') {
      return Promise.resolve();
    }
    const call = deferred();
    this.prepareCalls.push(call);
    return call.promise;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumeBehavior === 'resolve') {
      return Promise.resolve();
    }
    if (this.resumeBehavior === 'pending') {
      const call = deferred();
      this.pendingResumes.push(call);
      return call.promise;
    }
    return Promise.reject(this.resumeBehavior);
  }

  currentTime(): number {
    return this.time;
  }

  noteOn(key: number, velocity: number, time: number): void {
    this.add({ kind: 'on', key, velocity, down: false, time });
  }

  noteOff(key: number, time: number): void {
    this.add({ kind: 'off', key, velocity: 0, down: false, time });
  }

  sustain(down: boolean, time: number): void {
    this.add({ kind: 'pedal', key: 0, velocity: 0, down, time });
  }

  silence(): void {
    this.silenceCalls += 1;
    // Everything due now or later is cancelled; what already sounded is released.
    this.entries = this.entries.filter((entry) => entry.time < this.time - 1e-9);
    this.add({ kind: 'release', key: 0, velocity: 0, down: false, time: this.time });
  }

  onFailure(listener: (error: PlaybackError) => void): void {
    this.failureListener = listener;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Simulates audio output breaking. */
  breakAudio(error: PlaybackError): void {
    this.failureListener?.(error);
  }

  /** Note-ons that have sounded by `at` (cancelled ones excluded). */
  attacks(at = this.time): { key: number; velocity: number; time: number }[] {
    return this.sorted(at)
      .filter((entry) => entry.kind === 'on')
      .map(({ key, velocity, time }) => ({ key, velocity, time }));
  }

  /** Keys held down and pedal state at `at`. */
  soundAt(at = this.time): { keys: number[]; pedalDown: boolean } {
    const keys = new Set<number>();
    let pedalDown = false;
    for (const entry of this.sorted(at)) {
      if (entry.kind === 'on') {
        keys.add(entry.key);
      } else if (entry.kind === 'off') {
        keys.delete(entry.key);
      } else if (entry.kind === 'pedal') {
        pedalDown = entry.down;
      } else {
        keys.clear();
        pedalDown = false;
      }
    }
    return { keys: [...keys].sort((a, b) => a - b), pedalDown };
  }

  /** Number of actions handed over and not yet due at `at`. */
  pendingAfter(at = this.time): number {
    return this.entries.filter((entry) => entry.time > at).length;
  }

  private sorted(at: number): Scheduled[] {
    return this.entries
      .filter((entry) => entry.time <= at + 1e-9)
      .sort((a, b) => a.time - b.time || a.order - b.order);
  }

  private add(entry: Omit<Scheduled, 'order'>): void {
    this.entries.push({ ...entry, order: this.order++ });
  }
}

export class FakeTicker {
  starts = 0;
  private callback: (() => void) | undefined;

  readonly ticker: PlaybackTicker = (onTick) => {
    this.starts += 1;
    this.callback = onTick;
    return () => {
      if (this.callback === onTick) {
        this.callback = undefined;
      }
    };
  };

  get running(): boolean {
    return this.callback !== undefined;
  }

  tick(): void {
    this.callback?.();
  }
}

/** A fake driver and ticker sharing one clock, advanced in 25 ms ticks like the browser adapter. */
export class FakeAudio {
  readonly driver = new FakeSynthDriver();
  readonly clock = new FakeTicker();
  private milliseconds = 0;

  advance(seconds: number): void {
    const target = this.milliseconds + Math.round(seconds * 1000);
    while (this.milliseconds < target) {
      this.milliseconds = Math.min(target, this.milliseconds + 25);
      this.driver.time = this.milliseconds / 1000;
      this.clock.tick();
    }
  }
}
