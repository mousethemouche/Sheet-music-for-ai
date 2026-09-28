/**
 * The mutable working copy an edit is applied to, and small helpers shared by
 * the operation handlers. A draft is a private JSON copy of the current score:
 * handlers may change it freely, and it may be temporarily invalid between two
 * operations (only the final state is validated).
 */
import type { z } from 'zod';
import {
  type DomainError,
  type DomainErrorDetail,
  type ErrorPath,
  domainError,
  errorDetail,
} from '../errors';
import type { ScoreSpec, scoreSpecSchema } from '../schema';
import { buildScoreIndex } from '../score-index';

export type ScoreDraft = z.output<typeof scoreSpecSchema>;
export type DraftStaff = ScoreDraft['staves'][number];
export type DraftMeasure = DraftStaff['measures'][number];
export type DraftEvent = DraftMeasure['voices'][number]['events'][number];
export type DraftNoteEvent = Extract<DraftEvent, { type: 'note' }>;
export type DraftChordNote = Extract<DraftEvent, { type: 'chord' }>['notes'][number];
/** A single written note: a NoteEvent or one chord member. */
export type DraftNote = DraftNoteEvent | DraftChordNote;

/** Outcome of one handler: nothing (applied) or the error that rejects the whole edit. */
export type HandlerResult = DomainError | undefined;

/** A deep, unshared copy of JSON data. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A mutable private copy of a validated score. */
export function toDraft(score: ScoreSpec): ScoreDraft {
  return cloneJson(score) as ScoreDraft;
}

/** Bars of the score, in order (every staff shares them). */
export function barIds(draft: ScoreDraft): string[] {
  return (draft.staves[0]?.measures ?? []).map((measure) => measure.id);
}

/** Every written note of the draft with the staff and bar it sits in. */
export function* notesOf(
  draft: ScoreDraft,
): Generator<{ note: DraftNote; staffId: string; measureId: string }> {
  for (const staff of draft.staves) {
    for (const measure of staff.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (event.type === 'note') {
            yield { note: event, staffId: staff.id, measureId: measure.id };
          } else if (event.type === 'chord') {
            for (const member of event.notes) {
              yield { note: member, staffId: staff.id, measureId: measure.id };
            }
          }
        }
      }
    }
  }
}

export function findNote(draft: ScoreDraft, noteId: string): DraftNote | undefined {
  for (const { note } of notesOf(draft)) {
    if (note.id === noteId) {
      return note;
    }
  }
  return undefined;
}

/** Removes an optional list key when an operation leaves it empty (one form for "none"). */
export function dropIfEmpty<K extends 'harmony' | 'slurs' | 'dynamics' | 'pedal' | 'scaleDegrees'>(
  draft: ScoreDraft,
  key: K,
): void {
  if (draft[key]?.length === 0) {
    delete draft[key];
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const quote = (id: string): string => `"${id}"`;

/**
 * TARGET_NOT_FOUND for the entity an operation modifies. The detail is
 * REFERENCE_KIND_MISMATCH when the ID exists but names another kind of
 * element, REFERENCE_NOT_FOUND otherwise.
 */
export function targetNotFound(
  draft: ScoreDraft,
  id: string,
  path: ErrorPath,
  expected: string,
): DomainError {
  return domainError('TARGET_NOT_FOUND', [targetDetail(draft, id, path, expected)]);
}

export function targetDetail(
  draft: ScoreDraft,
  id: string,
  path: ErrorPath,
  expected: string,
): DomainErrorDetail {
  if (buildScoreIndex(draft).get(id) === undefined) {
    return errorDetail('REFERENCE_NOT_FOUND', path, `No ${expected} has the ID ${quote(id)}.`, [
      id,
    ]);
  }
  const described =
    expected === 'note'
      ? 'a note or a chord member'
      : `${/^[aeiou]/.test(expected) ? 'an' : 'a'} ${expected}`;
  return errorDetail(
    'REFERENCE_KIND_MISMATCH',
    path,
    `${quote(id)} exists but is not ${described}.`,
    [id],
  );
}

/** INVALID_OPERATION: the operation is well-formed but cannot apply to the current state. */
export function invalidOperation(
  path: ErrorPath,
  message: string,
  ids?: readonly string[],
): DomainError {
  return domainError('INVALID_OPERATION', [errorDetail('OPERATION_INVALID', path, message, ids)]);
}
