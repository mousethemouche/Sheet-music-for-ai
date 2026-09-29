/**
 * Neutral tick-based playback plan (ADR-004, RENDER_PLAYBACK_PORTS.md §3).
 * The compiler that builds it and the active-note query are implemented in
 * this package by #6; their types are fixed here.
 *
 * Every tick in a plan is a performance tick: an integer >= 0, swing applied
 * (P-02), within [0, totalTicks].
 */
import type { ScoreSpec } from '@sheet-music/music-domain';

/** Ticks per quarter note. */
export const PPQ = 960;

/** Ticks per whole note, the ScoreSpec time unit (a quarter is 1/4). */
export const TICKS_PER_WHOLE_NOTE = 4 * PPQ;

/** One sounding note: one key press, from attack to note-off. */
export interface PlaybackEvent {
  /** Written note that attacks: a NoteEvent ID or a chord member ID (the first note of a tie chain). */
  readonly noteId: string;
  /** Tied continuation notes merged into this sound, in order; empty when untied. */
  readonly tiedNoteIds: readonly string[];
  readonly startTick: number;
  /** Until note-off, after the articulation/phrasing gate; >= 1. Never extended by the sustain pedal. */
  readonly durationTicks: number;
  /** Piano key, 21 (A0) to 108 (C8). */
  readonly midiNote: number;
  /** 1 to 127, final: dynamic level, hairpin and articulation applied. */
  readonly velocity: number;
}

/** Sustain pedal (MIDI CC64) change, derived from a ScoreSpec pedal span. */
export interface SustainPedalEvent {
  /** Source ScoreSpec pedal span. */
  readonly pedalId: string;
  readonly tick: number;
  readonly type: 'down' | 'up';
}

/** When a written note is highlighted: its notated span on the performed timeline, [startTick, endTick). */
export interface HighlightSpan {
  readonly noteId: string;
  readonly startTick: number;
  readonly endTick: number;
}

export interface PlaybackPlan {
  /** Source score identity: lets the UI check the plan matches the rendered revision. */
  readonly scoreId: string;
  readonly revision: number;
  readonly ppq: typeof PPQ;
  /** Quarter notes per minute, copied from `score.tempo.bpm` (before the local tempo multiplier). */
  readonly bpm: number;
  /** Length of the whole score: its bars' actual durations in ticks. */
  readonly totalTicks: number;
  /** Version of #6's documented gate/velocity/precedence constants (P-02). */
  readonly expressionPolicyVersion: number;
  /** Sorted by startTick; ties in #6's documented deterministic order. */
  readonly events: readonly PlaybackEvent[];
  /** Sorted by tick; at one tick `up` comes before `down` (pedal change). Every `down` has a later `up`. */
  readonly pedal: readonly SustainPedalEvent[];
  /** One span per written note (tied continuations included, rests excluded), sorted by startTick. */
  readonly highlights: readonly HighlightSpan[];
}

/**
 * Compiles a canonical ScoreSpec (validateScoreSpec output). Pure, total and
 * deterministic: the same score always gives a deep-equal plan. #6 exports it
 * as `compilePlaybackPlan`.
 */
export type PlaybackCompiler = (score: ScoreSpec) => PlaybackPlan;

/**
 * IDs of the written notes whose highlight span contains `tick`
 * (startTick <= tick < endTick), in `plan.highlights` order. `tick` may be
 * fractional; outside [0, totalTicks) the result is empty. #6 exports it as
 * `activeNoteIds`.
 */
export type ActiveNoteIdsQuery = (plan: PlaybackPlan, tick: number) => readonly string[];
