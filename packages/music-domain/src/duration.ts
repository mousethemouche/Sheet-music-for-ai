/**
 * Exact rhythmic values (SCORESPEC_V1_SEMANTICS.md §5). All results are
 * fractions of a whole note.
 */
import { type Fraction, fraction, multiplyFractions, reduce } from './rational';
import type { Duration, DurationValue, Measure, TimeSignature } from './schema';

const VALUE_DENOMINATORS: Readonly<Record<DurationValue, number>> = {
  whole: 1,
  half: 2,
  quarter: 4,
  eighth: 8,
  sixteenth: 16,
  thirtySecond: 32,
};

/** One dot adds half the value (x3/2); two dots add half then a quarter (x7/4). */
const DOT_FACTORS: readonly Fraction[] = [fraction(1), fraction(3, 2), fraction(7, 4)];

/** Notated length before any tuplet ratio: base value times the dot factor. */
export function writtenDuration(duration: Duration): Fraction {
  const base = fraction(1, VALUE_DENOMINATORS[duration.value]);
  const dots = DOT_FACTORS[duration.dots ?? 0] ?? fraction(1);
  return multiplyFractions(base, dots);
}

/** Sounding (metric) length: written length times normal/actual for tuplet members. */
export function durationToFraction(duration: Duration): Fraction {
  const written = writtenDuration(duration);
  const tuplet = duration.tuplet;
  return tuplet === undefined
    ? written
    : multiplyFractions(written, fraction(tuplet.normal, tuplet.actual));
}

/** Nominal length of one bar of a meter: numerator/denominator whole notes (6/8 = 3/4). */
export function meterDuration(timeSignature: TimeSignature): Fraction {
  return fraction(timeSignature.numerator, timeSignature.denominator);
}

/** The meter in force in a bar: its local override, else the score time signature. */
export function effectiveTimeSignature(
  measure: Measure,
  scoreTimeSignature: TimeSignature,
): TimeSignature {
  return measure.timeSignature ?? scoreTimeSignature;
}

/**
 * Actual length of a bar: the declared actualDuration of a pickup/incomplete
 * bar, otherwise the nominal length of its effective meter.
 */
export function barDuration(measure: Measure, scoreTimeSignature: TimeSignature): Fraction {
  const underFilled = measure.kind === 'pickup' || measure.kind === 'incomplete';
  if (underFilled && measure.actualDuration !== undefined) {
    return reduce(measure.actualDuration);
  }
  return meterDuration(effectiveTimeSignature(measure, scoreTimeSignature));
}
