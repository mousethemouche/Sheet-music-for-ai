/**
 * Structured domain errors (SCORESPEC_V1_SEMANTICS.md §14, ADR-002 "Validation").
 *
 * Messages, paths and ids never echo free text from the input: paths contain
 * schema keys and array indices (unknown keys are sanitized), and ids have
 * already passed the ID pattern.
 */

export const DOMAIN_ERROR_CODES = [
  'SCORE_VALIDATION_FAILED',
  'MVP_LIMIT_EXCEEDED',
  'INVALID_OPERATION',
  'TARGET_NOT_FOUND',
  'REVISION_CONFLICT',
] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** Detail codes that mean "an MVP maximum was exceeded". */
export const LIMIT_DETAIL_CODES = [
  'TOO_MANY_STAVES',
  'TOO_MANY_MEASURES',
  'TOO_MANY_ANNOTATIONS',
  'TOO_MANY_ITEMS',
  'TEXT_TOO_LONG',
] as const;
export type LimitDetailCode = (typeof LIMIT_DETAIL_CODES)[number];

/** Detail codes produced by ScoreSpec validation (schema and semantic invariants). */
export const VALIDATION_DETAIL_CODES = [
  // Schema
  'UNSUPPORTED_VERSION',
  'INVALID_TYPE',
  'INVALID_VALUE',
  'UNKNOWN_FIELD',
  // Identity and structure
  'DUPLICATE_ID',
  'STAFF_HANDS_INVALID',
  'MEASURE_ALIGNMENT_MISMATCH',
  'MEASURE_NUMBER_INVALID',
  'MEASURE_KIND_INVALID',
  // Rhythm and pitch
  'VOICE_DURATION_MISMATCH',
  'TUPLET_GROUP_INVALID',
  'PITCH_OUT_OF_RANGE',
  'CHORD_DUPLICATE_PITCH',
  'TIE_UNMATCHED',
  // References, spans and attachments
  'REFERENCE_NOT_FOUND',
  'REFERENCE_KIND_MISMATCH',
  'REFERENCE_DUPLICATE',
  'SPAN_ORDER_INVALID',
  'SPAN_CROSS_STAFF',
  'SPAN_OVERLAP',
  'POSITION_OUT_OF_RANGE',
  'ATTACHMENT_CONFLICT',
  'ANNOTATION_COLOR_CONFLICT',
] as const;
export type ValidationDetailCode = (typeof VALIDATION_DETAIL_CODES)[number];

/** Detail codes reserved for the edit pipeline (ADR-002, issue #3). */
export const OPERATION_DETAIL_CODES = ['OPERATION_INVALID', 'REVISION_MISMATCH'] as const;
export type OperationDetailCode = (typeof OPERATION_DETAIL_CODES)[number];

export type DomainErrorDetailCode = LimitDetailCode | ValidationDetailCode | OperationDetailCode;

export type ErrorPath = readonly (string | number)[];

export interface DomainErrorDetail {
  readonly code: DomainErrorDetailCode;
  /** JSON path into the submitted document (keys and array indices). */
  readonly path: ErrorPath;
  readonly message: string;
  /** Stable IDs involved, when the problem concerns identified elements. */
  readonly ids?: readonly string[];
}

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly details: readonly DomainErrorDetail[];
}

export type Result<T, E = DomainError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

const LIMIT_CODE_SET: ReadonlySet<string> = new Set(LIMIT_DETAIL_CODES);

export function isLimitDetailCode(code: DomainErrorDetailCode): code is LimitDetailCode {
  return LIMIT_CODE_SET.has(code);
}

export function domainError(
  code: DomainErrorCode,
  details: readonly DomainErrorDetail[],
): DomainError {
  return Object.freeze({ code, details: Object.freeze([...details]) });
}

export function errorDetail(
  code: DomainErrorDetailCode,
  path: ErrorPath,
  message: string,
  ids?: readonly string[],
): DomainErrorDetail {
  return ids === undefined ? { code, path, message } : { code, path, message, ids };
}
