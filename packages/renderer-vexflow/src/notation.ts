/**
 * Pure notation decisions of the VexFlow adapter: how a canonical ScoreSpec
 * value is spelled for VexFlow and which symbols are shown. No DOM and no
 * VexFlow objects here, so the mapping rules are testable on their own.
 */
import {
  type Articulation,
  type ChordSymbol,
  type DurationValue,
  type Fraction,
  type Pitch,
  type PitchClass,
  type ScaleDegreeLabel,
  type Step,
  type TimeSignature,
  compareFractions,
} from '@sheet-music/music-domain';

/** VexFlow duration codes of the ScoreSpec note values. */
export const VEXFLOW_DURATIONS: Readonly<Record<DurationValue, string>> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  sixteenth: '16',
  thirtySecond: '32',
};

/** VexFlow articulation codes (see VexFlow `Tables.articulationCodes`). */
export const VEXFLOW_ARTICULATIONS: Readonly<Record<Articulation, string>> = {
  accent: 'a>',
  staccato: 'a.',
  tenuto: 'a-',
  marcato: 'a^',
};

/** VexFlow accidental codes, by absolute alteration; 0 is a natural sign. */
const ACCIDENTAL_CODES: Readonly<Record<number, string>> = {
  [-2]: 'bb',
  [-1]: 'b',
  0: 'n',
  1: '#',
  2: '##',
};

/** ASCII alteration prefix/suffix used in keys and labels. */
const ALTER_TEXT: Readonly<Record<number, string>> = {
  [-2]: 'bb',
  [-1]: 'b',
  0: '',
  1: '#',
  2: '##',
};

const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** VexFlow key-signature specs, indexed by fifths + 7. */
const KEY_SPECS = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
] as const;

/**
 * VexFlow key of a written pitch, keeping its spelling: F#4 is "f#/4" (F
 * line), Gb4 is "gb/4" (G line). The key only places the notehead; which
 * accidental is drawn is decided by `displayedAccidentals`.
 */
export function vexflowKey(pitch: Pitch): string {
  return `${pitch.step.toLowerCase()}${ALTER_TEXT[pitch.alter] ?? ''}/${pitch.octave}`;
}

export function keySignatureSpec(fifths: number): string {
  const spec = KEY_SPECS[fifths + 7];
  if (spec === undefined) {
    throw new RangeError(`Key signature fifths out of range: ${fifths}`);
  }
  return spec;
}

/** The alteration a key signature gives to a step (-1, 0 or +1). */
export function keySignatureAlter(fifths: number, step: Step): number {
  if (fifths > 0) {
    return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  }
  if (fifths < 0) {
    return FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0;
  }
  return 0;
}

export function meterText(meter: TimeSignature): string {
  return `${meter.numerator}/${meter.denominator}`;
}

/** One written note as it takes part in accidental display. */
export interface SpelledNote {
  readonly id: string;
  readonly pitch: Pitch;
  /** Continuation of a tie: never shows an accidental and leaves the bar state alone. */
  readonly tieEnd: boolean;
}

/** The notes of one event of one staff, with its position in the bar. */
export interface SpelledEvent {
  readonly offset: Fraction;
  readonly voiceIndex: number;
  readonly notes: readonly SpelledNote[];
}

/**
 * Accidentals to draw in one bar of one staff. Standard practice: the key
 * signature sets the alteration of every step; an accidental is drawn when a
 * note's written alteration differs from what is in force on its staff
 * position (step and octave), and then stays in force until the bar line.
 * Pitches are absolute spellings, so a key-signature alteration is never
 * applied twice: F#4 under one sharp shows nothing, F4 there shows a natural.
 *
 * Returns note ID -> VexFlow accidental code; notes without one are absent.
 */
export function displayedAccidentals(
  events: readonly SpelledEvent[],
  fifths: number,
): Map<string, string> {
  const ordered = [...events].sort(
    (a, b) => compareFractions(a.offset, b.offset) || a.voiceIndex - b.voiceIndex,
  );
  const inForce = new Map<string, number>();
  const shown = new Map<string, string>();
  for (const event of ordered) {
    for (const note of event.notes) {
      if (note.tieEnd) {
        continue;
      }
      const { step, octave, alter } = note.pitch;
      const position = `${step}${octave}`;
      const current = inForce.get(position) ?? keySignatureAlter(fifths, step);
      if (alter !== current) {
        const code = ACCIDENTAL_CODES[alter];
        if (code === undefined) {
          throw new RangeError(`Unsupported alteration: ${alter}`);
        }
        shown.set(note.id, code);
        inForce.set(position, alter);
      }
    }
  }
  return shown;
}

/** One event of a voice, as seen by beaming. */
export interface BeamCandidate {
  readonly id: string;
  /** Whole notes from the start of the bar. */
  readonly offset: Fraction;
  readonly value: DurationValue;
  readonly rest: boolean;
  readonly tupletGroupId: string | undefined;
}

const BEAMABLE: ReadonlySet<DurationValue> = new Set(['eighth', 'sixteenth', 'thirtySecond']);

/**
 * The beat a beam may not cross: a dotted quarter in compound meters (6/8,
 * 9/8, 12/8), otherwise a quarter (an eighth for x/16 and x/32).
 */
function beamWindow(meter: TimeSignature): Fraction {
  const compound = meter.numerator % 3 === 0 && meter.numerator > 3;
  if (meter.denominator >= 16) {
    return compound && meter.denominator === 16
      ? { numerator: 3, denominator: 16 }
      : { numerator: 1, denominator: 8 };
  }
  if (meter.denominator === 8 && compound) {
    return { numerator: 3, denominator: 8 };
  }
  return { numerator: 1, denominator: 4 };
}

/**
 * Event IDs to join with one beam each, for one voice of one bar (events in
 * order). Consecutive eighths or shorter notes are beamed within a beat; the
 * members of a tuplet group are beamed together whatever the beat. Rests and
 * longer values break beams; a group needs at least two notes.
 */
export function beamGroups(
  events: readonly BeamCandidate[],
  meter: TimeSignature,
): readonly (readonly string[])[] {
  const window = beamWindow(meter);
  const groups: string[][] = [];
  let current: string[] = [];
  let currentKey: string | undefined;
  const flush = (): void => {
    if (current.length >= 2) {
      groups.push(current);
    }
    current = [];
    currentKey = undefined;
  };
  for (const event of events) {
    if (event.rest || !BEAMABLE.has(event.value)) {
      flush();
      continue;
    }
    const beat = Math.floor(
      (event.offset.numerator * window.denominator) / (event.offset.denominator * window.numerator),
    );
    const key =
      event.tupletGroupId === undefined ? `beat:${beat}` : `tuplet:${event.tupletGroupId}`;
    if (key !== currentKey) {
      flush();
    }
    current.push(event.id);
    currentKey = key;
  }
  flush();
  return groups;
}

function pitchClassText(pitchClass: PitchClass): string {
  return `${pitchClass.step}${ALTER_TEXT[pitchClass.alter] ?? ''}`;
}

const QUALITY_TEXT: Readonly<Record<NonNullable<ChordSymbol['quality']>, string>> = {
  major: '',
  minor: 'm',
  dominant: '',
  diminished: 'dim',
  'half-diminished': 'm7b5',
  augmented: '+',
};

/**
 * The text of a chord symbol: its `display` when given, otherwise built from
 * the structured fields (root, quality, extension, alterations, slash bass),
 * e.g. "Gmaj7", "Am7", "D7(b9)", "G/B".
 */
export function chordSymbolText(chord: ChordSymbol): string {
  if (chord.display !== undefined) {
    return chord.display;
  }
  const quality = chord.quality ?? 'major';
  let body = QUALITY_TEXT[quality];
  if (quality === 'half-diminished') {
    body = chord.extension === undefined || chord.extension === 7 ? body : `m${chord.extension}b5`;
  } else if (chord.extension !== undefined) {
    const majorSeventh = quality === 'major' && chord.extension !== 6;
    body += `${majorSeventh ? 'maj' : ''}${chord.extension}`;
  } else if (quality === 'dominant') {
    body += '7';
  }
  const alterations =
    chord.alterations !== undefined && chord.alterations.length > 0
      ? `(${chord.alterations.join(',')})`
      : '';
  const bass = chord.bass === undefined ? '' : `/${pitchClassText(chord.bass)}`;
  return `${pitchClassText(chord.root)}${body}${alterations}${bass}`;
}

/** The text of a melodic scale-degree label: its `display`, else e.g. "3", "#4", "b7". */
export function scaleDegreeText(label: ScaleDegreeLabel): string {
  return label.display ?? `${ALTER_TEXT[label.alter ?? 0] ?? ''}${label.degree}`;
}
