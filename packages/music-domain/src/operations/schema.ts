/**
 * ScoreOperations v1 command schema (ADR-002, SCORE_OPERATIONS_V1.md).
 *
 * A closed, discriminated set of typed operations. Payloads reuse the
 * ScoreSpec v1 schemas (the same IDs, ranges, texts and limits), so a value an
 * operation writes is checked exactly like the same value in a document. Every
 * object is strict: path-based or JSON-Patch-like shapes (`op`, `path`,
 * `value`) and any unknown operation type are rejected.
 */
import { z } from 'zod';
import { MVP_LIMITS } from '../limits';
import {
  annotationColorSchema,
  annotationSchema,
  articulationSchema,
  chordSymbolSchema,
  dynamicEventSchema,
  fingeringSchema,
  fractionSchema,
  harmonicAnalysisSchema,
  idSchema,
  keySignatureSchema,
  listSchema,
  measureKindSchema,
  pedalEventSchema,
  playbackFeelSchema,
  scaleDegreeLabelSchema,
  slurSchema,
  tempoSchema,
  textSchema,
  timeSignatureSchema,
  tonalContextSchema,
  voiceSchema,
  whenFieldsValid,
} from '../schema';

/** Bounds of the edit command itself (the resulting score is bounded by MVP_LIMITS). */
export const OPERATION_LIMITS = {
  /** Operations in one edit command. */
  operationsPerEdit: 64,
  /** Largest shift accepted by `transpose`: the span of the 88-key piano (A0 to C8). */
  maxTransposeSemitones: 87,
} as const;

/** A non-empty list of distinct stable IDs. */
function idList(max: number) {
  return listSchema(idSchema, 1, max).refine((ids) => new Set(ids).size === ids.length, {
    error: 'IDs must not repeat in this list.',
    ...whenFieldsValid,
  });
}

// ---------------------------------------------------------------------------
// Global score operations
// ---------------------------------------------------------------------------

export const setTempoOperationSchema = z.strictObject({
  type: z.literal('set_tempo'),
  bpm: tempoSchema.shape.bpm,
});

/** Score-level meter only; local bar meters and notes are never rewritten. */
export const setTimeSignatureOperationSchema = z.strictObject({
  type: z.literal('set_time_signature'),
  numerator: timeSignatureSchema.shape.numerator,
  denominator: timeSignatureSchema.shape.denominator,
});

/** `null` removes the key signature. Stored pitches are never respelled. */
export const setKeySignatureOperationSchema = z.strictObject({
  type: z.literal('set_key_signature'),
  keySignature: keySignatureSchema.nullable(),
});

/** `null` removes the tonal context. */
export const setTonalContextOperationSchema = z.strictObject({
  type: z.literal('set_tonal_context'),
  tonalContext: tonalContextSchema.nullable(),
});

/** `null` removes the feel (straight). Written durations are never rewritten. */
export const setPlaybackFeelOperationSchema = z.strictObject({
  type: z.literal('set_playback_feel'),
  playbackFeel: playbackFeelSchema.nullable(),
});

/** `null` removes the title. */
export const setTitleOperationSchema = z.strictObject({
  type: z.literal('set_title'),
  title: textSchema(MVP_LIMITS.titleLength).nullable(),
});

/** Replaces the whole tag list; `[]` removes it. */
export const setTagsOperationSchema = z.strictObject({
  type: z.literal('set_tags'),
  tags: listSchema(textSchema(MVP_LIMITS.tagLength), 0, MVP_LIMITS.tags),
});

// ---------------------------------------------------------------------------
// Structural operations
// ---------------------------------------------------------------------------

/** One staff's content for a new bar. */
export const barStaffContentSchema = z.strictObject({
  staffId: idSchema,
  voices: listSchema(voiceSchema, 1, MVP_LIMITS.voicesPerMeasure),
});

/**
 * One complete new bar for every staff of the score: the bar-level fields are
 * given once (so both hands stay aligned by construction) and `number` is not
 * given (bars are renumbered after every structural operation).
 */
export const barContentSchema = z.strictObject({
  id: idSchema,
  kind: measureKindSchema.exactOptional(),
  timeSignature: timeSignatureSchema.exactOptional(),
  actualDuration: fractionSchema.exactOptional(),
  staves: listSchema(barStaffContentSchema, 1, MVP_LIMITS.staves, 'staves'),
});

const newBars = listSchema(barContentSchema, 1, MVP_LIMITS.measures, 'measures');

export const insertMeasuresOperationSchema = z.strictObject({
  type: z.literal('insert_measures'),
  position: z.enum(['before', 'after']),
  measureId: idSchema,
  bars: newBars,
});

/** Replaces a contiguous range of bars (any order in the list) by 1..32 new bars. */
export const replaceMeasuresOperationSchema = z.strictObject({
  type: z.literal('replace_measures'),
  measureIds: idList(MVP_LIMITS.measures),
  bars: newBars,
});

export const deleteMeasuresOperationSchema = z.strictObject({
  type: z.literal('delete_measures'),
  measureIds: idList(MVP_LIMITS.measures),
});

// ---------------------------------------------------------------------------
// Musical transformation
// ---------------------------------------------------------------------------

/** Selection of staff x bar cells; an absent list means "all" (`{}` is the whole score). */
export const transposeTargetSchema = z.strictObject({
  measureIds: idList(MVP_LIMITS.measures).exactOptional(),
  staffIds: idList(MVP_LIMITS.staves).exactOptional(),
});

export const transposeOperationSchema = z.strictObject({
  type: z.literal('transpose'),
  semitones: z
    .int()
    .min(-OPERATION_LIMITS.maxTransposeSemitones)
    .max(OPERATION_LIMITS.maxTransposeSemitones),
  target: transposeTargetSchema,
});

// ---------------------------------------------------------------------------
// Harmony and pedagogical operations
// ---------------------------------------------------------------------------

/**
 * Harmony parts are set on the harmony event `harmonyId`. When it exists, the
 * given part replaces the stored one and a given `measureId`/`offset` moves
 * it; when it does not exist, it is created and `measureId` is required.
 */
const harmonyTarget = {
  harmonyId: idSchema,
  measureId: idSchema.exactOptional(),
  offset: fractionSchema.exactOptional(),
};

export const setChordSymbolOperationSchema = z.strictObject({
  type: z.literal('set_chord_symbol'),
  ...harmonyTarget,
  chord: chordSymbolSchema,
});

export const removeChordSymbolOperationSchema = z.strictObject({
  type: z.literal('remove_chord_symbol'),
  harmonyId: idSchema,
});

export const setHarmonicAnalysisOperationSchema = z.strictObject({
  type: z.literal('set_harmonic_analysis'),
  ...harmonyTarget,
  analysis: harmonicAnalysisSchema,
});

export const removeHarmonicAnalysisOperationSchema = z.strictObject({
  type: z.literal('remove_harmonic_analysis'),
  harmonyId: idSchema,
});

/** `noteId` is a NoteEvent or a single chord member. */
export const setFingeringOperationSchema = z.strictObject({
  type: z.literal('set_fingering'),
  noteId: idSchema,
  fingering: fingeringSchema,
});

export const removeFingeringOperationSchema = z.strictObject({
  type: z.literal('remove_fingering'),
  noteId: idSchema,
});

/** Replaces the note's whole articulation set; `[]` removes it. */
export const setArticulationsOperationSchema = z.strictObject({
  type: z.literal('set_articulations'),
  noteId: idSchema,
  articulations: listSchema(articulationSchema, 0, 4).refine(
    (values) => new Set(values).size === values.length,
    { error: 'Articulations must not repeat.', ...whenFieldsValid },
  ),
});

export const addSlurOperationSchema = z.strictObject({
  type: z.literal('add_slur'),
  slur: slurSchema,
});

export const removeSlurOperationSchema = z.strictObject({
  type: z.literal('remove_slur'),
  slurId: idSchema,
});

/** Creates the dynamic `dynamic.id`, or replaces it completely when it exists. */
export const setDynamicOperationSchema = z.strictObject({
  type: z.literal('set_dynamic'),
  dynamic: dynamicEventSchema,
});

export const removeDynamicOperationSchema = z.strictObject({
  type: z.literal('remove_dynamic'),
  dynamicId: idSchema,
});

/** Creates the pedal span `pedal.id`, or replaces it completely when it exists. */
export const setPedalOperationSchema = z.strictObject({
  type: z.literal('set_pedal'),
  pedal: pedalEventSchema,
});

export const removePedalOperationSchema = z.strictObject({
  type: z.literal('remove_pedal'),
  pedalId: idSchema,
});

/** Creates the label `scaleDegree.id`, or replaces it completely when it exists. */
export const setScaleDegreeOperationSchema = z.strictObject({
  type: z.literal('set_scale_degree'),
  scaleDegree: scaleDegreeLabelSchema,
});

export const removeScaleDegreeOperationSchema = z.strictObject({
  type: z.literal('remove_scale_degree'),
  scaleDegreeId: idSchema,
});

export const addAnnotationOperationSchema = z.strictObject({
  type: z.literal('add_annotation'),
  annotation: annotationSchema,
});

/** Replaces the given fields of an existing annotation (at least one). */
export const updateAnnotationOperationSchema = z
  .strictObject({
    type: z.literal('update_annotation'),
    annotationId: idSchema,
    color: annotationColorSchema.exactOptional(),
    noteIds: listSchema(idSchema, 1, MVP_LIMITS.notesPerAnnotation).exactOptional(),
    text: textSchema(MVP_LIMITS.annotationTextLength).exactOptional(),
  })
  .refine(
    (operation) =>
      operation.color !== undefined ||
      operation.noteIds !== undefined ||
      operation.text !== undefined,
    { error: 'update_annotation needs color, noteIds or text.', ...whenFieldsValid },
  );

export const removeAnnotationOperationSchema = z.strictObject({
  type: z.literal('remove_annotation'),
  annotationId: idSchema,
});

// ---------------------------------------------------------------------------
// Union and command envelope
// ---------------------------------------------------------------------------

export const scoreOperationSchema = z.discriminatedUnion('type', [
  setTempoOperationSchema,
  setTimeSignatureOperationSchema,
  setKeySignatureOperationSchema,
  setTonalContextOperationSchema,
  setPlaybackFeelOperationSchema,
  setTitleOperationSchema,
  setTagsOperationSchema,
  insertMeasuresOperationSchema,
  replaceMeasuresOperationSchema,
  deleteMeasuresOperationSchema,
  transposeOperationSchema,
  setChordSymbolOperationSchema,
  removeChordSymbolOperationSchema,
  setHarmonicAnalysisOperationSchema,
  removeHarmonicAnalysisOperationSchema,
  setFingeringOperationSchema,
  removeFingeringOperationSchema,
  setArticulationsOperationSchema,
  addSlurOperationSchema,
  removeSlurOperationSchema,
  setDynamicOperationSchema,
  removeDynamicOperationSchema,
  setPedalOperationSchema,
  removePedalOperationSchema,
  setScaleDegreeOperationSchema,
  removeScaleDegreeOperationSchema,
  addAnnotationOperationSchema,
  updateAnnotationOperationSchema,
  removeAnnotationOperationSchema,
]);

/**
 * The domain part of ADR-002's EditScoreCommand. `scoreId` is resolved by the
 * application layer (#13) before the domain applies the edit.
 */
export const scoreEditSchema = z.strictObject({
  expectedRevision: z.int().min(0),
  operations: listSchema(scoreOperationSchema, 1, OPERATION_LIMITS.operationsPerEdit),
});

/** Validated (canonical) operation, as handlers receive it. */
export type ScoreOperation = z.output<typeof scoreOperationSchema>;
/** What a producer (AI, MCP, REST) submits. */
export type ScoreOperationInput = z.input<typeof scoreOperationSchema>;
export type ScoreOperationType = ScoreOperation['type'];
export type ScoreEdit = z.output<typeof scoreEditSchema>;
export type ScoreEditInput = z.input<typeof scoreEditSchema>;
export type BarContent = z.output<typeof barContentSchema>;
export type TransposeTarget = z.output<typeof transposeTargetSchema>;

/** Every operation type of v1, in ADR-002 order. */
export const SCORE_OPERATION_TYPES: readonly ScoreOperationType[] =
  scoreOperationSchema.options.map((option) => option.shape.type.value);
