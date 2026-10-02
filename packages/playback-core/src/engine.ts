/**
 * Playback engine port (ADR-004, RENDER_PLAYBACK_PORTS.md §4). An adapter
 * package (playback-spessasynth, #6) implements it; score-ui (#7) consumes it
 * through a PlaybackEngineFactory that the app injects with its assets. No
 * synthesizer or Web Audio type appears here.
 *
 * Positions are performance ticks of the loaded plan (PPQ 960); they may be
 * fractional. Commands called in a state where they do not apply are no-ops
 * (see the state table in §4.2).
 */
import type { PlaybackError } from './errors';
import type { PlaybackPlan } from './plan';

/**
 * - idle: no plan (initial state);
 * - loading: the latest load() is in progress; no plan;
 * - ready: plan loaded, silent, at tick 0 (after load, stop or the end of a non-looping pass);
 * - playing: sounding from the current position;
 * - paused: plan loaded, silent, at a retained position (after pause or seek);
 * - error: the latest load failed or playback broke; no plan; load() recovers;
 * - destroyed: final.
 */
export type PlaybackState =
  'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error' | 'destroyed';

/** Accepted local tempo multipliers (inclusive). Local UI state: never a new score or revision. */
export const TEMPO_MULTIPLIER_RANGE = { min: 0.25, max: 2 } as const;

/** Immutable; getSnapshot() returns the same object until something in it changes. */
export interface PlaybackSnapshot {
  readonly state: PlaybackState;
  /** Token of the latest load() call (0 before any); increases by one per accepted call. */
  readonly loadId: number;
  /** The plan loaded by call `loadId`, once committed; null in idle, loading, error and destroyed. */
  readonly plan: PlaybackPlan | null;
  /** Kept across loads. Default 1. */
  readonly tempoMultiplier: number;
  /** Whole-plan loop, kept across loads. Default false. */
  readonly loop: boolean;
  /** Why the engine is in `error`; null in every other state. */
  readonly error: PlaybackError | null;
}

/**
 * Outcome of one load() call, identified by its token. `superseded`: a later
 * load() or destroy() made this call obsolete; it changed nothing.
 */
export interface LoadOutcome {
  readonly status: 'loaded' | 'superseded';
  readonly loadId: number;
}

/** Idempotent. */
export type Unsubscribe = () => void;

export interface PlaybackEngine {
  /**
   * Silences everything at once (notes and pedal), drops the current plan,
   * takes the next load token and enters `loading`. Resolves `loaded` (state
   * `ready`, tick 0, never playing, even with loop on) when the engine can
   * play without further fetching; resolves `superseded` if a later load() or
   * destroy() came first. The latest call rejects with ASSET_LOAD_FAILED or
   * PLAYBACK_FAILED and enters `error`. A malformed plan rejects with
   * INVALID_ARGUMENT before anything changes.
   */
  load(plan: PlaybackPlan): Promise<LoadOutcome>;
  /**
   * From ready or paused: starts sounding from the current position. Call it
   * directly from the user gesture handler; the adapter resumes audio before
   * its first await. Rejects with PLAYBACK_FAILED if audio cannot start,
   * leaving the state unchanged. A play() still pending when load, stop,
   * pause or destroy is called resolves without playing.
   */
  play(): Promise<void>;
  /** From playing: silences notes and pedal, keeps the position, enters `paused`. */
  pause(): void;
  /** From playing or paused: silences notes and pedal, returns to tick 0, enters `ready`. */
  stop(): void;
  /**
   * With a plan: moves to `tick` (0 <= tick < totalTicks, else INVALID_ARGUMENT
   * is thrown and nothing changes). Sounding notes and pedal are released;
   * notes attacked before `tick` are not re-struck; the pedal takes its state
   * at `tick`. Playing stays playing; ready and paused become paused.
   */
  seek(tick: number): void;
  /**
   * Applies immediately without moving the position. Throws INVALID_ARGUMENT
   * (nothing changes) outside TEMPO_MULTIPLIER_RANGE or when not finite.
   */
  setTempoMultiplier(multiplier: number): void;
  /** At the end of a pass: on, releases everything and continues from tick 0; off, stops (ready). */
  setLoop(enabled: boolean): void;
  getSnapshot(): PlaybackSnapshot;
  /** Called after every snapshot change, possibly synchronously inside the command that caused it. */
  subscribe(listener: () => void): Unsubscribe;
  /**
   * Called with the position while playing (at most once per display frame)
   * and once after every discrete move (load, stop, seek, pause, loop wrap,
   * end). Once load, stop, pause, seek or destroy returns, no position of the
   * previous run is delivered.
   */
  subscribePosition(listener: (tick: number) => void): Unsubscribe;
  /**
   * Final and idempotent: silences, supersedes pending loads, cancels pending
   * play, releases audio resources and drops listeners without notifying them.
   * Later commands are no-ops; a later load() resolves `superseded`.
   */
  destroy(): void;
}

/** A SoundFont: an absolute URL, or bytes the engine never transfers or mutates. */
export type SoundFontSource = { readonly url: string } | { readonly bytes: ArrayBuffer };

/**
 * Assets an adapter loads. URLs are absolute: the app resolves them against
 * its configured asset base URL. The adapter fetches nothing else (the MCP
 * View runs in a sandboxed iframe with a CSP).
 */
export interface PlaybackAssetConfig {
  readonly soundFont: SoundFontSource;
  /** Audio worklet (processor) module of the synthesizer. */
  readonly workletModuleUrl: string;
}

/** Implemented by an adapter package, for example `createSpessaSynthEngine`. */
export type CreatePlaybackEngine = (assets: PlaybackAssetConfig) => PlaybackEngine;

/** Injected by the app with its assets bound: returns a fresh engine in `idle` (one per mount). */
export type PlaybackEngineFactory = () => PlaybackEngine;
