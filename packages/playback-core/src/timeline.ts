/**
 * Performed timeline: exact whole-note positions to integer performance ticks
 * (PLAYBACK_POLICY_V1.md §2 and §3).
 *
 * - Rounding: an absolute position p (whole notes) becomes round(p x 3840),
 *   halves rounded up. Durations are always differences of two rounded
 *   positions, never rounded on their own, so nothing drifts.
 * - Swing (P-02) warps positions inside each complete swing pair of a bar; bar
 *   lines and pair boundaries are fixed points, so written rhythm and hand
 *   alignment are preserved. A tuplet group is warped as a block: its
 *   endpoints follow the swing grid and its members stay evenly spaced
 *   between them (never swung a second time).
 */
import {
  type BarInfo,
  type Fraction,
  type IndexedEvent,
  type PlaybackFeel,
  type ScoreIndex,
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  meterDuration,
  multiplyFractions,
  subtractFractions,
} from '@sheet-music/music-domain';
import { TICKS_PER_WHOLE_NOTE } from './plan';

/** Swing requested without a ratio (P-02). */
const DEFAULT_SWING_RATIO = { long: 2, short: 1 } as const;

/** Floor of a / b for integers, b > 0. */
function floorDivide(a: number, b: number): number {
  return (a - (((a % b) + b) % b)) / b;
}

/** round(position x 3840), halves up. Positions are >= 0. */
export function wholeNotesToTicks(position: Fraction): number {
  const { numerator, denominator } = position;
  return floorDivide(2 * numerator * TICKS_PER_WHOLE_NOTE + denominator, 2 * denominator);
}

interface SwingGrid {
  /** The swung subdivision (1/8 or 1/16); a pair is two of them. */
  readonly unit: Fraction;
  readonly pair: Fraction;
  /** 2 x long / (long + short): how much the first half of a pair is stretched. */
  readonly longScale: Fraction;
  /** 2 x short / (long + short): how much the second half is compressed. */
  readonly shortScale: Fraction;
}

function swingGrid(feel: PlaybackFeel | undefined): SwingGrid | undefined {
  if (feel === undefined || feel.type === 'straight') {
    return undefined;
  }
  const { long, short } = feel.ratio ?? DEFAULT_SWING_RATIO;
  if (long === short) {
    return undefined;
  }
  const unit = fraction(1, feel.subdivision === 'sixteenth' ? 16 : 8);
  return {
    unit,
    pair: multiplyFractions(unit, fraction(2)),
    longScale: fraction(2 * long, long + short),
    shortScale: fraction(2 * short, long + short),
  };
}

function barAt(bars: readonly BarInfo[], position: Fraction): BarInfo | undefined {
  return bars.find(
    (bar) =>
      compareFractions(bar.start, position) <= 0 &&
      compareFractions(position, addFractions(bar.start, bar.duration)) < 0,
  );
}

/**
 * Swung position of `position`. The pair grid starts at the bar line, except
 * in a pickup, where it is aligned as if the bar were complete (the pickup is
 * the end of a notional full bar). Pairs cut by a bar line stay straight.
 */
function swing(position: Fraction, bars: readonly BarInfo[], grid: SwingGrid): Fraction {
  const bar = barAt(bars, position);
  if (bar === undefined) {
    return position;
  }
  const barEnd = addFractions(bar.start, bar.duration);
  const origin =
    bar.kind === 'pickup'
      ? subtractFractions(
          bar.start,
          subtractFractions(meterDuration(bar.timeSignature), bar.duration),
        )
      : bar.start;
  const pairs = divideFractions(subtractFractions(position, origin), grid.pair);
  const pairIndex = floorDivide(pairs.numerator, pairs.denominator);
  const pairStart = addFractions(origin, multiplyFractions(grid.pair, fraction(pairIndex)));
  const pairEnd = addFractions(pairStart, grid.pair);
  if (compareFractions(pairStart, bar.start) < 0 || compareFractions(pairEnd, barEnd) > 0) {
    return position;
  }
  const offset = subtractFractions(position, pairStart);
  if (compareFractions(offset, grid.unit) <= 0) {
    return addFractions(pairStart, multiplyFractions(offset, grid.longScale));
  }
  return addFractions(
    addFractions(pairStart, multiplyFractions(grid.unit, grid.longScale)),
    multiplyFractions(subtractFractions(offset, grid.unit), grid.shortScale),
  );
}

export interface TickSpan {
  readonly startTick: number;
  readonly endTick: number;
}

export interface PerformedTimeline {
  readonly totalTicks: number;
  /** Performed [start, end) of an event (its notes share it), swing applied. */
  eventSpan(event: IndexedEvent): TickSpan;
}

export function performedTimeline(
  index: ScoreIndex,
  feel: PlaybackFeel | undefined,
): PerformedTimeline {
  const grid = swingGrid(feel);
  const perform = (position: Fraction): Fraction =>
    grid === undefined ? position : swing(position, index.bars, grid);

  const groups = new Map<string, { start: Fraction; end: Fraction }>();
  for (const group of index.tupletGroups) {
    const first = group.members[0];
    const last = group.members.at(-1);
    if (first !== undefined && last !== undefined) {
      groups.set(group.id, {
        start: first.location.onset,
        end: addFractions(last.location.onset, last.location.duration),
      });
    }
  }

  const spans = new Map<string, TickSpan>();
  const eventSpan = (event: IndexedEvent): TickSpan => {
    const cached = spans.get(event.id);
    if (cached !== undefined) {
      return cached;
    }
    const { onset, duration } = event.location;
    const end = addFractions(onset, duration);
    const tuplet = event.event.duration.tuplet;
    const group = tuplet === undefined ? undefined : groups.get(tuplet.groupId);
    let place = perform;
    if (grid !== undefined && group !== undefined) {
      const start = perform(group.start);
      const scale = divideFractions(
        subtractFractions(perform(group.end), start),
        subtractFractions(group.end, group.start),
      );
      place = (position) =>
        addFractions(start, multiplyFractions(subtractFractions(position, group.start), scale));
    }
    const span = {
      startTick: wholeNotesToTicks(place(onset)),
      endTick: wholeNotesToTicks(place(end)),
    };
    spans.set(event.id, span);
    return span;
  };

  return { totalTicks: wholeNotesToTicks(index.totalDuration), eventSpan };
}
