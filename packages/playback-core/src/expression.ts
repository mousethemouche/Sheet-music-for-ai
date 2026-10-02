/**
 * Expression policy v1 (P-02, PLAYBACK_POLICY_V1.md §4): deterministic
 * engineering constants for velocity and gate. They are a documented,
 * versioned rendering choice, not universal musical rules; any change to a
 * constant or rule increments EXPRESSION_POLICY_VERSION.
 */
import {
  type Articulation,
  type DynamicMark,
  type Fraction,
  type NoteTarget,
  type ScoreIndex,
  type ScoreSpec,
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  multiplyFractions,
  subtractFractions,
} from '@sheet-music/music-domain';

export const EXPRESSION_POLICY_VERSION = 1;

/** MIDI velocity of each dynamic level: one level is 16 (fff capped at 127). */
const DYNAMIC_VELOCITY: Readonly<Record<DynamicMark, number>> = {
  ppp: 16,
  pp: 32,
  p: 48,
  mp: 64,
  mf: 80,
  f: 96,
  ff: 112,
  fff: 127,
};
/** Level before the first mark of a staff. */
const DEFAULT_VELOCITY = DYNAMIC_VELOCITY.mf;
/** A hairpin with no target mark moves one level. */
const HAIRPIN_STEP = 16;
const ACCENT_BOOST = 16;
const MARCATO_BOOST = 24;

/** Sounding share of the notated span (numerator/denominator). */
type Gate = readonly [number, number];
const GATE_DEFAULT: Gate = [9, 10];
const GATE_FULL: Gate = [1, 1];
const GATE_STACCATO: Gate = [1, 2];
const GATE_PORTATO: Gate = [3, 4];

const clampVelocity = (value: number): number => Math.min(127, Math.max(1, value));

/** round(value), halves up; value >= 0. */
function roundFraction(value: Fraction): number {
  return Math.floor((2 * value.numerator + value.denominator) / (2 * value.denominator));
}

/** Articulations of a written note (NoteEvent or chord member). */
export function articulationsOf(index: ScoreIndex, note: NoteTarget): readonly Articulation[] {
  const event = index.event(note.eventId)?.event;
  if (event?.type === 'note') {
    return event.articulations ?? [];
  }
  if (event?.type === 'chord') {
    return event.notes.find((member) => member.id === note.id)?.articulations ?? [];
  }
  return [];
}

/**
 * Written notes inside a phrasing slur, which sound connected to the next
 * note: the notes of the slur's staff and voice lane whose onset is at or
 * after the start note and strictly before the end note. The end note itself
 * is released normally.
 */
export function slurredNoteIds(spec: ScoreSpec, index: ScoreIndex): ReadonlySet<string> {
  const lanes = new Map<string, NoteTarget[]>();
  for (const note of index.noteTargets) {
    const key = `${note.location.staffIndex}:${note.location.voiceIndex}`;
    lanes.set(key, [...(lanes.get(key) ?? []), note]);
  }
  const slurred = new Set<string>();
  for (const slur of spec.slurs ?? []) {
    const start = index.noteTarget(slur.startNoteId);
    const end = index.noteTarget(slur.endNoteId);
    if (start === undefined || end === undefined) {
      continue;
    }
    const lane = lanes.get(`${start.location.staffIndex}:${start.location.voiceIndex}`) ?? [];
    for (const note of lane) {
      if (
        compareFractions(note.location.onset, start.location.onset) >= 0 &&
        compareFractions(note.location.onset, end.location.onset) < 0
      ) {
        slurred.add(note.id);
      }
    }
  }
  return slurred;
}

/**
 * Gate of the note that ends a sound (a single note or the last note of a tie
 * chain). The note's own articulation wins over the slur: staccato 1/2,
 * staccato under a slur or with tenuto (portato) 3/4, tenuto or slurred full
 * value, otherwise 9/10. A gate never extends a note past its notated end.
 */
export function gatedTicks(
  notatedTicks: number,
  articulations: readonly Articulation[],
  slurred: boolean,
): number {
  const staccato = articulations.includes('staccato');
  const tenuto = articulations.includes('tenuto');
  const [numerator, denominator] = staccato
    ? tenuto || slurred
      ? GATE_PORTATO
      : GATE_STACCATO
    : tenuto || slurred
      ? GATE_FULL
      : GATE_DEFAULT;
  return Math.max(1, roundFraction(fraction(notatedTicks * numerator, denominator)));
}

/** Velocity boost of the attacking note: marcato +24, else accent +16 (not added together). */
export function articulationBoost(articulations: readonly Articulation[]): number {
  if (articulations.includes('marcato')) {
    return MARCATO_BOOST;
  }
  return articulations.includes('accent') ? ACCENT_BOOST : 0;
}

interface Mark {
  readonly onset: Fraction;
  readonly level: number;
}

interface Ramp {
  readonly start: Fraction;
  readonly end: Fraction;
  readonly from: number;
  readonly to: number;
}

interface StaffDynamics {
  readonly marks: Mark[];
  readonly hairpins: { start: Fraction; end: Fraction; direction: 'crescendo' | 'diminuendo' }[];
  readonly ramps: Ramp[];
}

const last = <T>(items: readonly T[], matches: (item: T) => boolean): T | undefined =>
  items.findLast(matches);

function levelAt(staff: StaffDynamics, onset: Fraction): Fraction {
  const mark = last(staff.marks, (item) => compareFractions(item.onset, onset) <= 0);
  const ramp = last(staff.ramps, (item) => compareFractions(item.start, onset) <= 0);
  if (ramp !== undefined && (mark === undefined || compareFractions(ramp.start, mark.onset) >= 0)) {
    if (compareFractions(onset, ramp.end) >= 0) {
      return fraction(ramp.to);
    }
    const progress = divideFractions(
      subtractFractions(onset, ramp.start),
      subtractFractions(ramp.end, ramp.start),
    );
    return addFractions(
      fraction(ramp.from),
      multiplyFractions(fraction(ramp.to - ramp.from), progress),
    );
  }
  return fraction(mark?.level ?? DEFAULT_VELOCITY);
}

/**
 * Dynamic level of each staff over time. A mark sets the level of its staff
 * from its onset. A hairpin ramps linearly (in written time) from the level at
 * its start to the first mark after its start and within its span when that
 * mark goes in its direction (the ramp then ends at the mark), otherwise one
 * level (16) up or down over its whole span; the reached level holds until the
 * next mark.
 */
export function staffDynamics(
  spec: ScoreSpec,
  index: ScoreIndex,
): (staffIndex: number, onset: Fraction) => number {
  const staves = spec.staves.map<StaffDynamics>(() => ({ marks: [], hairpins: [], ramps: [] }));
  for (const dynamic of spec.dynamics ?? []) {
    if (dynamic.type === 'mark') {
      const location = index.event(dynamic.eventId)?.location;
      if (location !== undefined) {
        staves[location.staffIndex]?.marks.push({
          onset: location.onset,
          level: DYNAMIC_VELOCITY[dynamic.marking],
        });
      }
    } else {
      const start = index.event(dynamic.startEventId)?.location;
      const end = index.event(dynamic.endEventId)?.location;
      if (start !== undefined && end !== undefined) {
        staves[start.staffIndex]?.hairpins.push({
          start: start.onset,
          end: addFractions(end.onset, end.duration),
          direction: dynamic.direction,
        });
      }
    }
  }
  for (const staff of staves) {
    // Stable sorts: equal onsets keep document order (the later mark wins).
    staff.marks.sort((a, b) => compareFractions(a.onset, b.onset));
    staff.hairpins.sort((a, b) => compareFractions(a.start, b.start));
    for (const hairpin of staff.hairpins) {
      const from = roundFraction(levelAt(staff, hairpin.start));
      const sign = hairpin.direction === 'crescendo' ? 1 : -1;
      const target = staff.marks.find(
        (mark) =>
          compareFractions(mark.onset, hairpin.start) > 0 &&
          compareFractions(mark.onset, hairpin.end) <= 0,
      );
      const reachesTarget = target !== undefined && Math.sign(target.level - from) === sign;
      staff.ramps.push(
        reachesTarget
          ? { start: hairpin.start, end: target.onset, from, to: target.level }
          : {
              start: hairpin.start,
              end: hairpin.end,
              from,
              to: clampVelocity(from + sign * HAIRPIN_STEP),
            },
      );
    }
  }
  return (staffIndex, onset) => {
    const staff = staves[staffIndex];
    return staff === undefined ? DEFAULT_VELOCITY : roundFraction(levelAt(staff, onset));
  };
}

/** Final velocity of a sound: dynamic level at its attack plus the attack's articulation boost. */
export function velocityOf(dynamicLevel: number, articulations: readonly Articulation[]): number {
  return clampVelocity(dynamicLevel + articulationBoost(articulations));
}
