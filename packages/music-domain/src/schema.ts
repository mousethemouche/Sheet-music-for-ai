/**
 * ScoreSpec v1 runtime schema (ADR-001, SCORESPEC_V1_SEMANTICS.md).
 *
 * This schema checks shape, scalar ranges and MVP limits. Cross-element rules
 * (alignment, rhythm, references, spans, P-03) are checked afterwards by
 * validateScoreSpec. Every object is strict: unknown keys (layout coordinates,
 * renderer or audio-engine objects, seconds) are rejected. Optional fields are
 * exact: a present key must hold a value, never `undefined`.
 */
import { z } from 'zod';
import { canonicalizeColor } from './color';
import type { DeepReadonly } from './deep-freeze';
import { MVP_LIMITS } from './limits';

/** Marker carried in zod messages for maxima that are MVP limits (mapped to limit detail codes). */
export const LIMIT_MARKER = 'mvp-limit';
export type LimitKind = 'staves' | 'measures' | 'annotations' | 'items' | 'text';

const limitMarker = (kind: LimitKind, max: number): string => `${LIMIT_MARKER}:${kind}:${max}`;

/** Stable IDs: 1-64 characters, safe to echo in error messages. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

const id = z.string().regex(ID_PATTERN, {
  error:
    'IDs are 1-64 characters (letters, digits, "_", ".", ":" or "-") and start with a letter or digit.',
});

/** Run a cross-field refinement only when the fields themselves are valid (no duplicate noise). */
const whenFieldsValid = {
  when: (payload: { readonly issues: readonly unknown[] }): boolean => payload.issues.length === 0,
};

/** Blank text: empty, or only whitespace and invisible format characters (Unicode Cf, such as U+200B). */
const BLANK_TEXT = /^[\s\p{Cf}]*$/u;

function text(max: number) {
  return z
    .string()
    .refine((value) => !BLANK_TEXT.test(value), { error: 'Must not be empty or blank.' })
    .refine((value) => [...value].length <= max, { error: limitMarker('text', max) });
}

function list<T extends z.ZodType>(item: T, min: number, max: number, kind: LimitKind = 'items') {
  return z
    .array(item)
    .min(min)
    .max(max, { error: limitMarker(kind, max) });
}

// ---------------------------------------------------------------------------
// Time, pitch and duration
// ---------------------------------------------------------------------------

/** Exact rational number of WHOLE notes (1/4 = one quarter note). */
export const fractionSchema = z.strictObject({
  numerator: z.int().min(0).max(1_000_000),
  denominator: z.int().min(1).max(1_000_000),
});

export const timeSignatureSchema = z.strictObject({
  numerator: z.int().min(1).max(32),
  denominator: z.literal([1, 2, 4, 8, 16, 32]),
});

/** Beats per minute, where the beat is always the QUARTER note. */
export const tempoSchema = z.strictObject({
  bpm: z.number().min(20).max(400),
});

export const keySignatureSchema = z.strictObject({
  fifths: z.int().min(-7).max(7),
});

export const stepSchema = z.enum(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
export const alterSchema = z.int().min(-2).max(2);

export const pitchClassSchema = z.strictObject({ step: stepSchema, alter: alterSchema });

/** Written (spelled) pitch; octave 4 contains middle C. Range A0-C8 is checked semantically. */
export const pitchSchema = z.strictObject({
  step: stepSchema,
  alter: alterSchema,
  octave: z.int().min(0).max(8),
});

export const modeSchema = z.enum([
  'major',
  'minor',
  'ionian',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'aeolian',
  'locrian',
]);

export const tonalContextSchema = z.strictObject({ tonic: pitchClassSchema, mode: modeSchema });

export const durationValueSchema = z.enum([
  'whole',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
  'thirtySecond',
]);

/** Membership in one tuplet group: every member carries the same groupId and ratio. */
export const tupletSchema = z
  .strictObject({
    groupId: id,
    actual: z.int().min(2).max(12),
    normal: z.int().min(1).max(12),
  })
  .refine((tuplet) => tuplet.actual !== tuplet.normal, {
    error: 'A tuplet ratio needs actual different from normal.',
    ...whenFieldsValid,
  });

export const durationSchema = z.strictObject({
  value: durationValueSchema,
  dots: z.literal([0, 1, 2]).exactOptional(),
  tuplet: tupletSchema.exactOptional(),
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const fingeringSchema = z.literal([1, 2, 3, 4, 5]);

export const articulationSchema = z.enum(['accent', 'staccato', 'tenuto', 'marcato']);

const articulations = list(articulationSchema, 0, 4).refine(
  (values) => new Set(values).size === values.length,
  { error: 'Articulations must not repeat.', ...whenFieldsValid },
);

/** Tie endpoints of one written note; pairing rules live in SCORESPEC_V1_SEMANTICS.md §7. */
export const tieSchema = z
  .strictObject({
    start: z.boolean().exactOptional(),
    end: z.boolean().exactOptional(),
  })
  .refine((tie) => tie.start === true || tie.end === true, {
    error: 'A tie needs start or end set to true.',
    ...whenFieldsValid,
  });

export const noteEventSchema = z.strictObject({
  id,
  type: z.literal('note'),
  pitch: pitchSchema,
  duration: durationSchema,
  fingering: fingeringSchema.exactOptional(),
  articulations: articulations.exactOptional(),
  tie: tieSchema.exactOptional(),
});

export const chordNoteSchema = z.strictObject({
  id,
  pitch: pitchSchema,
  fingering: fingeringSchema.exactOptional(),
  articulations: articulations.exactOptional(),
  tie: tieSchema.exactOptional(),
});

export const chordEventSchema = z.strictObject({
  id,
  type: z.literal('chord'),
  duration: durationSchema,
  notes: list(chordNoteSchema, 2, MVP_LIMITS.notesPerChord),
});

export const restEventSchema = z.strictObject({
  id,
  type: z.literal('rest'),
  duration: durationSchema,
});

export const musicalEventSchema = z.discriminatedUnion('type', [
  noteEventSchema,
  chordEventSchema,
  restEventSchema,
]);

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export const voiceSchema = z.strictObject({
  id,
  events: list(musicalEventSchema, 1, MVP_LIMITS.eventsPerVoice),
});

export const measureKindSchema = z.enum(['full', 'pickup', 'incomplete']);

export const measureSchema = z.strictObject({
  /** Bar ID, shared by the aligned measure of every staff. */
  id,
  /** 1-based ordinal of the bar in the score (a pickup is bar 1). */
  number: z.int().min(1),
  kind: measureKindSchema.exactOptional(),
  /** Local meter of this bar only; absent means the score time signature. */
  timeSignature: timeSignatureSchema.exactOptional(),
  /** Required for pickup/incomplete bars, forbidden otherwise. */
  actualDuration: fractionSchema.exactOptional(),
  voices: list(voiceSchema, 1, MVP_LIMITS.voicesPerMeasure),
});

export const handSchema = z.enum(['right', 'left']);
export const clefSchema = z.enum(['treble', 'bass']);

const DEFAULT_CLEF = { right: 'treble', left: 'bass' } as const;

/** A staff whose clef, when omitted, defaults from its hand (ADR-001 invariant 4). */
export const staffSchema = z
  .strictObject({
    id,
    hand: handSchema,
    clef: clefSchema.exactOptional(),
    measures: list(measureSchema, 1, MVP_LIMITS.measures, 'measures'),
  })
  .transform((staff) => ({ ...staff, clef: staff.clef ?? DEFAULT_CLEF[staff.hand] }));

// ---------------------------------------------------------------------------
// Performance feel
// ---------------------------------------------------------------------------

export const swingRatioSchema = z
  .strictObject({
    long: z.int().min(1).max(16),
    short: z.int().min(1).max(16),
  })
  .refine((ratio) => ratio.long >= ratio.short, {
    error: 'A swing ratio needs long greater than or equal to short.',
    ...whenFieldsValid,
  });

export const playbackFeelSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('straight') }),
  z.strictObject({
    type: z.literal('swing'),
    /** Absent means eighth (P-02). */
    subdivision: z.enum(['eighth', 'sixteenth']).exactOptional(),
    /** Absent means 2:1 (P-02). */
    ratio: swingRatioSchema.exactOptional(),
    displayText: text(MVP_LIMITS.labelLength).exactOptional(),
  }),
]);

// ---------------------------------------------------------------------------
// Harmony, expression and teaching layers
// ---------------------------------------------------------------------------

export const chordQualitySchema = z.enum([
  'major',
  'minor',
  'dominant',
  'diminished',
  'half-diminished',
  'augmented',
]);

export const chordSymbolSchema = z.strictObject({
  root: pitchClassSchema,
  quality: chordQualitySchema.exactOptional(),
  extension: z.literal([6, 7, 9, 11, 13]).exactOptional(),
  alterations: list(
    text(MVP_LIMITS.chordAlterationLength),
    0,
    MVP_LIMITS.chordAlterations,
  ).exactOptional(),
  bass: pitchClassSchema.exactOptional(),
  display: text(MVP_LIMITS.labelLength).exactOptional(),
});

export const harmonicAnalysisSchema = z.strictObject({
  romanNumeral: text(MVP_LIMITS.romanNumeralLength),
  function: text(MVP_LIMITS.labelLength).exactOptional(),
});

export const harmonyEventSchema = z
  .strictObject({
    id,
    measureId: id,
    /** Position from the start of the bar, in whole notes; absent means 0. */
    offset: fractionSchema.exactOptional(),
    chord: chordSymbolSchema.exactOptional(),
    analysis: harmonicAnalysisSchema.exactOptional(),
  })
  .refine((harmony) => harmony.chord !== undefined || harmony.analysis !== undefined, {
    error: 'A harmony event needs a chord symbol, an analysis, or both.',
  });

export const slurSchema = z.strictObject({
  id,
  startNoteId: id,
  endNoteId: id,
});

export const dynamicMarkSchema = z.enum(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']);

export const dynamicEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id,
    type: z.literal('mark'),
    eventId: id,
    marking: dynamicMarkSchema,
  }),
  z.strictObject({
    id,
    type: z.literal('hairpin'),
    direction: z.enum(['crescendo', 'diminuendo']),
    startEventId: id,
    endEventId: id,
  }),
]);

export const pedalEventSchema = z.strictObject({
  id,
  type: z.literal('sustain'),
  startEventId: id,
  endEventId: id,
});

export const scaleDegreeLabelSchema = z.strictObject({
  id,
  noteId: id,
  degree: z.int().min(1).max(7),
  alter: alterSchema.exactOptional(),
  display: text(MVP_LIMITS.scaleDegreeDisplayLength).exactOptional(),
});

/** Canonicalizes accepted colors to lowercase "#rrggbb". */
export const annotationColorSchema = z.string().transform((value, context) => {
  const canonical = canonicalizeColor(value);
  if (canonical === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Colors are "#rgb", "#rrggbb" or a CSS color name.',
    });
    return z.NEVER;
  }
  return canonical;
});

export const annotationSchema = z.strictObject({
  id,
  color: annotationColorSchema,
  noteIds: list(id, 1, MVP_LIMITS.notesPerAnnotation),
  text: text(MVP_LIMITS.annotationTextLength),
});

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export const scoreSpecSchema = z.strictObject({
  version: z.literal(1),
  id,
  revision: z.int().min(0),
  metadata: z.strictObject({
    title: text(MVP_LIMITS.titleLength).exactOptional(),
    tags: list(text(MVP_LIMITS.tagLength), 0, MVP_LIMITS.tags).exactOptional(),
  }),
  tempo: tempoSchema,
  timeSignature: timeSignatureSchema,
  keySignature: keySignatureSchema.exactOptional(),
  tonalContext: tonalContextSchema.exactOptional(),
  playbackFeel: playbackFeelSchema.exactOptional(),
  staves: list(staffSchema, 1, MVP_LIMITS.staves, 'staves'),
  harmony: list(harmonyEventSchema, 0, MVP_LIMITS.harmonyEvents).exactOptional(),
  slurs: list(slurSchema, 0, MVP_LIMITS.slurs).exactOptional(),
  dynamics: list(dynamicEventSchema, 0, MVP_LIMITS.dynamics).exactOptional(),
  pedal: list(pedalEventSchema, 0, MVP_LIMITS.pedalSpans).exactOptional(),
  scaleDegrees: list(scaleDegreeLabelSchema, 0, MVP_LIMITS.scaleDegrees).exactOptional(),
  annotations: list(annotationSchema, 0, MVP_LIMITS.annotations, 'annotations'),
});

/**
 * Building blocks shared with the ScoreOperations schemas (./operations), so
 * operation payloads use exactly the same ID, text and limit rules.
 */
export { id as idSchema, list as listSchema, text as textSchema, whenFieldsValid };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What a producer (AI, fixture, stored JSON) submits: clef optional, colors in any accepted form. */
export type ScoreSpecInput = z.input<typeof scoreSpecSchema>;

/** Canonical, validated and deeply read-only ScoreSpec v1 (output of validateScoreSpec). */
export type ScoreSpec = DeepReadonly<z.output<typeof scoreSpecSchema>>;

export type Staff = ScoreSpec['staves'][number];
export type Measure = Staff['measures'][number];
export type Voice = Measure['voices'][number];
export type MusicalEvent = Voice['events'][number];
export type NoteEvent = Extract<MusicalEvent, { readonly type: 'note' }>;
export type ChordEvent = Extract<MusicalEvent, { readonly type: 'chord' }>;
export type RestEvent = Extract<MusicalEvent, { readonly type: 'rest' }>;
export type ChordNote = ChordEvent['notes'][number];
export type Duration = MusicalEvent['duration'];
export type DurationValue = Duration['value'];
export type Tuplet = NonNullable<Duration['tuplet']>;
export type Pitch = NoteEvent['pitch'];
export type PitchClass = DeepReadonly<z.output<typeof pitchClassSchema>>;
export type Step = Pitch['step'];
export type Tie = NonNullable<NoteEvent['tie']>;
export type Articulation = z.output<typeof articulationSchema>;
export type Fingering = z.output<typeof fingeringSchema>;
export type Hand = Staff['hand'];
export type Clef = Staff['clef'];
export type MeasureKind = z.output<typeof measureKindSchema>;
export type TimeSignature = ScoreSpec['timeSignature'];
export type Tempo = ScoreSpec['tempo'];
export type KeySignature = NonNullable<ScoreSpec['keySignature']>;
export type TonalContext = NonNullable<ScoreSpec['tonalContext']>;
export type PlaybackFeel = NonNullable<ScoreSpec['playbackFeel']>;
export type HarmonyEvent = NonNullable<ScoreSpec['harmony']>[number];
export type ChordSymbol = NonNullable<HarmonyEvent['chord']>;
export type HarmonicAnalysis = NonNullable<HarmonyEvent['analysis']>;
export type Slur = NonNullable<ScoreSpec['slurs']>[number];
export type DynamicEvent = NonNullable<ScoreSpec['dynamics']>[number];
export type DynamicMark = z.output<typeof dynamicMarkSchema>;
export type PedalEvent = NonNullable<ScoreSpec['pedal']>[number];
export type ScaleDegreeLabel = NonNullable<ScoreSpec['scaleDegrees']>[number];
export type Annotation = ScoreSpec['annotations'][number];
