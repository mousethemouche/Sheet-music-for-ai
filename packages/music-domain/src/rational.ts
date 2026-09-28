/**
 * Exact rational arithmetic for musical time.
 *
 * Musical positions and durations are fractions of a WHOLE note (a quarter is
 * 1/4, an eighth-note triplet member is 1/12). Rhythm is never computed with
 * floating-point numbers. Every function returns a new, frozen, reduced
 * fraction with a positive denominator.
 */
export interface Fraction {
  readonly numerator: number;
  readonly denominator: number;
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Builds a reduced fraction. Throws RangeError on a zero denominator or unsafe integers. */
export function fraction(numerator: number, denominator = 1): Fraction {
  assertSafeInteger(numerator, 'numerator');
  assertSafeInteger(denominator, 'denominator');
  if (denominator === 0) {
    throw new RangeError('denominator must not be zero');
  }
  if (numerator === 0) {
    return Object.freeze({ numerator: 0, denominator: 1 });
  }
  const sign = denominator < 0 ? -1 : 1;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return Object.freeze({
    numerator: (sign * numerator) / divisor,
    denominator: Math.abs(denominator) / divisor,
  });
}

export const ZERO: Fraction = fraction(0);

/** Normalizes any fraction-shaped value (for example a non-reduced ScoreSpec field). */
export function reduce(value: Fraction): Fraction {
  return fraction(value.numerator, value.denominator);
}

/**
 * Both numerators scaled to the least common denominator of `a` and `b`.
 * Working over the LCM instead of the product keeps intermediate values as
 * small as the operands allow: musical positions share power-of-two and
 * tuplet factors, so their cross products would leave the safe-integer range
 * long before their sums do.
 */
function overCommonDenominator(
  a: Fraction,
  b: Fraction,
): { left: number; right: number; denominator: number } {
  const divisor = greatestCommonDivisor(a.denominator, b.denominator);
  const scaleA = b.denominator / divisor;
  const scaleB = a.denominator / divisor;
  return {
    left: a.numerator * scaleA,
    right: b.numerator * scaleB,
    denominator: a.denominator * scaleA,
  };
}

export function addFractions(a: Fraction, b: Fraction): Fraction {
  const { left, right, denominator } = overCommonDenominator(a, b);
  return fraction(left + right, denominator);
}

export function subtractFractions(a: Fraction, b: Fraction): Fraction {
  const { left, right, denominator } = overCommonDenominator(a, b);
  return fraction(left - right, denominator);
}

export function multiplyFractions(a: Fraction, b: Fraction): Fraction {
  return fraction(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function divideFractions(a: Fraction, b: Fraction): Fraction {
  return fraction(a.numerator * b.denominator, a.denominator * b.numerator);
}

export function sumFractions(values: Iterable<Fraction>): Fraction {
  let total = ZERO;
  for (const value of values) {
    total = addFractions(total, value);
  }
  return total;
}

/** Returns -1, 0 or 1. */
export function compareFractions(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const { left, right } = overCommonDenominator(a, b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function fractionsEqual(a: Fraction, b: Fraction): boolean {
  return compareFractions(a, b) === 0;
}

/** "n/d" in lowest terms, for messages and map keys. */
export function formatFraction(value: Fraction): string {
  const reduced = reduce(value);
  return `${reduced.numerator}/${reduced.denominator}`;
}
