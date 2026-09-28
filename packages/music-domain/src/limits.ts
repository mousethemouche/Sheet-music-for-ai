/**
 * MVP v1 limits (docs/architecture/SCORESPEC_V1_SEMANTICS.md §13).
 *
 * The product heuristics of PRD §6-7 (32 bars, 4 annotations, ~80 characters)
 * and the other bounds on collections and free text live in this one table so
 * they can be tuned without touching the validators. Exceeding a maximum is
 * reported as MVP_LIMIT_EXCEEDED; going below a minimum is an ordinary
 * SCORE_VALIDATION_FAILED.
 */
export const MVP_LIMITS = {
  /** Piano grand staff at most. */
  staves: 2,
  /** Bars per score; two aligned hands of 32 bars count as 32. */
  measures: 32,
  voicesPerMeasure: 4,
  eventsPerVoice: 64,
  notesPerChord: 10,
  annotations: 4,
  /** Unicode code points, not UTF-16 units. */
  annotationTextLength: 80,
  notesPerAnnotation: 32,
  titleLength: 120,
  tags: 16,
  tagLength: 40,
  harmonyEvents: 256,
  slurs: 128,
  dynamics: 256,
  pedalSpans: 64,
  scaleDegrees: 512,
  chordAlterations: 4,
  chordAlterationLength: 8,
  romanNumeralLength: 16,
  /** Chord display, harmonic function and swing display text. */
  labelLength: 32,
  scaleDegreeDisplayLength: 8,
} as const;

export type MvpLimits = typeof MVP_LIMITS;
