/**
 * Written-pitch helpers (SCORESPEC_V1_SEMANTICS.md §6).
 *
 * A written pitch is a spelling: F#4 and Gb4 are different written pitches
 * even though they sound the same key.
 */
import type { Pitch, Step } from './schema';

const STEP_SEMITONES: Readonly<Record<Step, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const ACCIDENTALS: Readonly<Record<number, string>> = {
  [-2]: 'bb',
  [-1]: 'b',
  0: '',
  1: '#',
  2: '##',
};

/** Lowest and highest key of an 88-key piano (A0 and C8), as MIDI key numbers. */
export const PIANO_KEY_RANGE = { lowest: 21, highest: 108 } as const;

/** Piano key (MIDI number, middle C4 = 60) that a written pitch denotes. */
export function writtenPitchToKey(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + STEP_SEMITONES[pitch.step] + pitch.alter;
}

export function isOnPianoKeyboard(pitch: Pitch): boolean {
  const key = writtenPitchToKey(pitch);
  return key >= PIANO_KEY_RANGE.lowest && key <= PIANO_KEY_RANGE.highest;
}

/** Same spelling: step, alteration and octave all equal (F#4 is not Gb4). */
export function writtenPitchesEqual(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

/** Scientific pitch notation with ASCII accidentals, e.g. "F#4", "Gb4", "Bbb3". */
export function formatWrittenPitch(pitch: Pitch): string {
  return `${pitch.step}${ACCIDENTALS[pitch.alter] ?? '?'}${pitch.octave}`;
}
