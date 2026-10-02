/**
 * Terse builders for ScoreSpec v1 fixtures. They only assemble plain JSON
 * objects with explicit IDs; they compute nothing musical, so fixture
 * expectations (oracles) stay independent from music-domain code.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';

export type StaffInput = ScoreSpecInput['staves'][number];
export type MeasureInput = StaffInput['measures'][number];
export type VoiceInput = MeasureInput['voices'][number];
export type EventInput = VoiceInput['events'][number];
export type NoteInput = Extract<EventInput, { type: 'note' }>;
export type ChordInput = Extract<EventInput, { type: 'chord' }>;
export type RestInput = Extract<EventInput, { type: 'rest' }>;
export type ChordNoteInput = ChordInput['notes'][number];
export type DurationInput = EventInput['duration'];
export type DurationValueInput = DurationInput['value'];
export type PitchInput = NoteInput['pitch'];
export type AnnotationInput = ScoreSpecInput['annotations'][number];

type NoteExtras = Omit<NoteInput, 'id' | 'type' | 'pitch' | 'duration'>;
type ChordNoteExtras = Omit<ChordNoteInput, 'id' | 'pitch'>;
type MeasureExtras = Omit<MeasureInput, 'id' | 'number' | 'voices'>;

const ALTERS: Readonly<Record<string, PitchInput['alter']>> = {
  '': 0,
  '#': 1,
  '##': 2,
  b: -1,
  bb: -2,
};

/** Parses scientific pitch notation with ASCII accidentals: "C4", "F#4", "Gb4", "Bbb3", "C##5". */
export function pitch(spelled: string): PitchInput {
  const match = /^([A-G])(bb|b|##|#)?([0-8])$/.exec(spelled);
  if (match === null) {
    throw new Error(`Unparseable pitch "${spelled}"`);
  }
  const [, step, accidental = '', octave] = match;
  return {
    step: step as PitchInput['step'],
    alter: ALTERS[accidental] ?? 0,
    octave: Number(octave),
  };
}

export function dur(value: DurationValueInput, dots?: 0 | 1 | 2): DurationInput {
  return dots === undefined ? { value } : { value, dots };
}

/** A member of the tuplet group `groupId` with ratio actual:normal (default triplet 3:2). */
export function tup(
  value: DurationValueInput,
  groupId: string,
  actual = 3,
  normal = 2,
): DurationInput {
  return { value, tuplet: { groupId, actual, normal } };
}

const asDuration = (duration: DurationInput | DurationValueInput): DurationInput =>
  typeof duration === 'string' ? { value: duration } : duration;

export function note(
  id: string,
  spelled: string,
  duration: DurationInput | DurationValueInput,
  extras: NoteExtras = {},
): NoteInput {
  return { id, type: 'note', pitch: pitch(spelled), duration: asDuration(duration), ...extras };
}

export function rest(id: string, duration: DurationInput | DurationValueInput): RestInput {
  return { id, type: 'rest', duration: asDuration(duration) };
}

export function member(id: string, spelled: string, extras: ChordNoteExtras = {}): ChordNoteInput {
  return { id, pitch: pitch(spelled), ...extras };
}

export function chord(
  id: string,
  notes: ChordNoteInput[],
  duration: DurationInput | DurationValueInput,
): ChordInput {
  return { id, type: 'chord', duration: asDuration(duration), notes };
}

export function voice(id: string, events: EventInput[]): VoiceInput {
  return { id, events };
}

export function bar(
  id: string,
  number: number,
  voices: VoiceInput[],
  extras: MeasureExtras = {},
): MeasureInput {
  return { id, number, ...extras, voices };
}

export function staff(
  id: string,
  hand: StaffInput['hand'],
  measures: MeasureInput[],
  clef?: StaffInput['clef'],
): StaffInput {
  return clef === undefined ? { id, hand, measures } : { id, hand, clef, measures };
}

type ScoreFields = Omit<
  ScoreSpecInput,
  'version' | 'revision' | 'metadata' | 'tempo' | 'timeSignature' | 'annotations'
> &
  Partial<
    Pick<ScoreSpecInput, 'revision' | 'metadata' | 'tempo' | 'timeSignature' | 'annotations'>
  >;

/** A v1 score with defaults: revision 1, no metadata, quarter = 120, 4/4, no annotations. */
export function score(fields: ScoreFields): ScoreSpecInput {
  return {
    version: 1,
    revision: 1,
    metadata: {},
    tempo: { bpm: 120 },
    timeSignature: { numerator: 4, denominator: 4 },
    annotations: [],
    ...fields,
  };
}

/** A fresh, mutable deep copy of JSON fixture data (fixtures are frozen; derive variants from a copy). */
export function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Freezes a fixture in place so a test cannot mutate shared data; derive variants with cloneFixture. */
export function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      frozen(child);
    }
  }
  return value;
}
