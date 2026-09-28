/**
 * Application errors (APPLICATION_LAYER.md §6): the domain codes plus
 * INVALID_INPUT, UNAUTHENTICATED, NOT_FOUND, ALREADY_SAVED,
 * DEPENDENCY_UNAVAILABLE and INTERNAL. Expected failures are returned as
 * `Result` values; the transports add a correlation ID and serialize
 * `{ code, message, details }` as the error envelope of music-contracts.
 */
import { type ErrorCode, type ErrorDetail, inputIssueDetails } from '@sheet-music/music-contracts';
import {
  type DomainError,
  type ErrorPath,
  type Result,
  errorDetail,
} from '@sheet-music/music-domain';
import type { z } from 'zod';

export interface ApplicationError {
  readonly code: ErrorCode;
  /** Safe, actionable message; never quotes free text from the request. */
  readonly message: string;
  readonly details: readonly ErrorDetail[];
  /**
   * The underlying infrastructure error of DEPENDENCY_UNAVAILABLE / INTERNAL,
   * for server-side logs only. Non-enumerable, so it is never serialized.
   */
  readonly cause?: unknown;
}

export type AppResult<T> = Result<T, ApplicationError>;

const MESSAGES: Readonly<Record<ErrorCode, string>> = {
  SCORE_VALIDATION_FAILED: 'The score breaks ScoreSpec v1 rules; see details. Nothing was stored.',
  MVP_LIMIT_EXCEEDED:
    'The score exceeds an MVP v1 limit; see details. Split longer music into several scores. Nothing was stored.',
  INVALID_OPERATION: 'The edit command is invalid; see details. Nothing was changed.',
  TARGET_NOT_FOUND:
    'An operation targets an element that does not exist at this point of the edit; see details. Nothing was changed.',
  REVISION_CONFLICT:
    'The score is not at the expected revision. Nothing was changed: reload the score and rebuild the request from its current revision.',
  INVALID_INPUT: 'The request is malformed; see details.',
  UNAUTHENTICATED: 'Authentication is required.',
  NOT_FOUND:
    'No score with this ID exists in your drafts or library. Unsaved drafts expire after a period without edits; create the score again if it is still needed.',
  ALREADY_SAVED: 'This score is already in your library.',
  DEPENDENCY_UNAVAILABLE:
    'The score store is temporarily unavailable. Retry later, and reload the score before retrying an edit or a save.',
  INTERNAL: 'An internal error occurred.',
};

export function applicationError(
  code: ErrorCode,
  details: readonly ErrorDetail[] = [],
  message: string = MESSAGES[code],
  cause?: unknown,
): ApplicationError {
  const error = { code, message, details: Object.freeze([...details]) };
  if (cause !== undefined) {
    Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  }
  return Object.freeze(error);
}

export function ok<T>(value: T): AppResult<T> {
  return { ok: true, value };
}

export function fail(error: ApplicationError): AppResult<never> {
  return { ok: false, error };
}

/** A domain error with its code and details unchanged; paths optionally prefixed to point into the request. */
export function fromDomainError(error: DomainError, pathPrefix: ErrorPath = []): ApplicationError {
  return applicationError(
    error.code,
    error.details.map((detail) => ({ ...detail, path: [...pathPrefix, ...detail.path] })),
  );
}

export function invalidInput(error: z.ZodError): ApplicationError {
  return applicationError('INVALID_INPUT', inputIssueDetails(error));
}

export const unauthenticated = (): ApplicationError => applicationError('UNAUTHENTICATED');

export const notFound = (): ApplicationError => applicationError('NOT_FOUND');

/** The stored score is not at the revision the request expected. */
export function revisionMismatch(
  scoreId: string,
  currentRevision: number,
  expectedRevision: number,
): ApplicationError {
  return applicationError('REVISION_CONFLICT', [
    errorDetail(
      'REVISION_MISMATCH',
      ['expectedRevision'],
      `The score is at revision ${currentRevision} but the request expected revision ${expectedRevision}; reload the score.`,
      [scoreId],
    ),
  ]);
}

/** A compare-and-swap write lost a race: the score changed (edit, save or expiry) after it was read. */
export function concurrentChange(scoreId: string): ApplicationError {
  return applicationError('REVISION_CONFLICT', [
    errorDetail(
      'REVISION_MISMATCH',
      ['expectedRevision'],
      'The score changed while this request was being applied; reload the score and retry.',
      [scoreId],
    ),
  ]);
}

export function alreadySaved(revision: number): ApplicationError {
  return applicationError(
    'ALREADY_SAVED',
    [],
    `This score is already in your library, at revision ${revision}. Edits apply to the saved score directly; its title and tags cannot be changed by saving again.`,
  );
}
