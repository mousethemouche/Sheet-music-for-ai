/**
 * Key-aware transposition spelling (SCORE_OPERATIONS_V1.md, "Transposition").
 *
 * A shift in semitones is turned into ONE interval (a letter distance plus
 * semitones) chosen from the key signature, and every written pitch moves by
 * that interval: C4-E4-G4 up 2 semitones in C is D4-F#4-A4. The interval is
 * the one whose transposed key signature has the fewest accidentals (ties go
 * to the flat side); octave shifts keep every spelling. A result needing a
 * triple accidental is respelled on the neighbouring letter.
 */
import { writtenPitchToKey } from '../pitch';
import type { Pitch, PitchClass, Step } from '../schema';

const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONES: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTALS: Readonly<Record<number, string>> = {
  [-2]: 'bb',
  [-1]: 'b',
  0: '',
  1: '#',
  2: '##',
};

/** A transposition interval: exact semitones, letter distance mod 7 and fifths on the circle. */
export interface Interval {
  readonly semitones: number;
  /** Letter steps upward, modulo 7 (the octave follows from the semitones). */
  readonly letterShift: number;
  /** Signed number of fifths the interval moves a key signature (M2 = +2, m2 = -5). */
  readonly fifths: number;
}

const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

const stepIndex = (step: Step): number => STEPS.indexOf(step);

/** Letter at position `index` (0 = C .. 6 = B). */
const stepAt = (index: number): Step => STEPS[mod(index, 7)] ?? 'C';

const semitonesOf = (index: number): number => STEP_SEMITONES[mod(index, 7)] ?? 0;

/**
 * The interval used to transpose by `semitones` in a key of `keyFifths`
 * (-7..7). Among the spellings of the shift, it keeps the key signature
 * closest to C (ties: the flat key); octave shifts never respell.
 */
export function chooseInterval(semitones: number, keyFifths: number): Interval {
  if (mod(semitones, 12) === 0) {
    return { semitones, letterShift: 0, fifths: 0 };
  }
  const base = mod(7 * semitones, 12);
  let best = base;
  for (const fifths of [base - 24, base - 12, base + 12]) {
    const candidate = keyFifths + fifths;
    const current = keyFifths + best;
    if (
      Math.abs(candidate) < Math.abs(current) ||
      (Math.abs(candidate) === Math.abs(current) && candidate < current)
    ) {
      best = fifths;
    }
  }
  return { semitones, letterShift: mod(4 * best, 7), fifths: best };
}

/** The written pitch `interval` above (or below) `pitch`; the sounding key moves by exactly `interval.semitones`. */
export function transposePitch(pitch: Pitch, interval: Interval): Pitch {
  const key = writtenPitchToKey(pitch) + interval.semitones;
  let letter = stepIndex(pitch.step) + interval.letterShift;
  letter = mod(letter, 7);
  let octave = Math.round((key - semitonesOf(letter)) / 12) - 1;
  const alterFor = (): number => key - ((octave + 1) * 12 + semitonesOf(letter));
  let alter = alterFor();
  while (alter > 2) {
    letter += 1;
    if (letter === 7) {
      letter = 0;
      octave += 1;
    }
    alter = alterFor();
  }
  while (alter < -2) {
    letter -= 1;
    if (letter < 0) {
      letter = 6;
      octave -= 1;
    }
    alter = alterFor();
  }
  return { step: stepAt(letter), alter, octave };
}

/** Pitch-class version of transposePitch (tonics, chord roots and bass notes). */
export function transposePitchClass(pitchClass: PitchClass, interval: Interval): PitchClass {
  const target = mod(
    semitonesOf(stepIndex(pitchClass.step)) + pitchClass.alter + interval.semitones,
    12,
  );
  let letter = mod(stepIndex(pitchClass.step) + interval.letterShift, 7);
  const alterFor = (): number => mod(target - semitonesOf(letter) + 6, 12) - 6;
  let alter = alterFor();
  while (alter > 2) {
    letter = mod(letter + 1, 7);
    alter = alterFor();
  }
  while (alter < -2) {
    letter = mod(letter - 1, 7);
    alter = alterFor();
  }
  return { step: stepAt(letter), alter };
}

/** Pitch-class name with ASCII accidentals: "C", "F#", "Bb", "Ebb". */
export function formatPitchClass(pitchClass: PitchClass): string {
  return `${pitchClass.step}${ACCIDENTALS[pitchClass.alter] ?? ''}`;
}

/**
 * The chord display text for a transposed chord, or undefined when the text
 * cannot be rewritten safely. Rewritable text is the root name, a suffix with
 * no other note name, and "/bass" exactly when the chord has a bass.
 */
export function transposeChordDisplay(
  display: string,
  before: { readonly root: PitchClass; readonly bass?: PitchClass },
  after: { readonly root: PitchClass; readonly bass?: PitchClass },
): string | undefined {
  const root = formatPitchClass(before.root);
  if (!display.startsWith(root)) {
    return undefined;
  }
  let suffix = display.slice(root.length);
  if (/^[#b♯♭]/u.test(suffix)) {
    return undefined;
  }
  let bass = '';
  if (before.bass !== undefined && after.bass !== undefined) {
    const oldBass = `/${formatPitchClass(before.bass)}`;
    if (!suffix.endsWith(oldBass)) {
      return undefined;
    }
    suffix = suffix.slice(0, suffix.length - oldBass.length);
    bass = `/${formatPitchClass(after.bass)}`;
  }
  if (/[A-G/]/.test(suffix)) {
    return undefined;
  }
  return `${formatPitchClass(after.root)}${suffix}${bass}`;
}
