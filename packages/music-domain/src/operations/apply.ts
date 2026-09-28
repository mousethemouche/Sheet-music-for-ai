/**
 * applyScoreEdit: the pure ADR-002 edit pipeline.
 *
 *   1. validate the command schema          -> INVALID_OPERATION / MVP_LIMIT_EXCEEDED
 *   2. compare expectedRevision             -> REVISION_CONFLICT
 *   3. apply operations in order on a copy  -> TARGET_NOT_FOUND / INVALID_OPERATION
 *   4. validate the whole resulting score   -> SCORE_VALIDATION_FAILED / MVP_LIMIT_EXCEEDED
 *   5. revision + 1, exactly once
 *
 * The edit is atomic: any failure returns an error and nothing else. The input
 * score and command are never mutated; intermediate states may be invalid, only
 * the final document must satisfy every ScoreSpec invariant.
 */
import {
  type DomainError,
  type ErrorPath,
  type Result,
  domainError,
  errorDetail,
  isLimitDetailCode,
} from '../errors';
import type { ScoreSpec } from '../schema';
import { schemaIssueDetails } from '../schema-issues';
import { validateScoreSpec } from '../validate';
import { type HandlerResult, type ScoreDraft, toDraft } from './draft';
import {
  setKeySignature,
  setPlaybackFeel,
  setTags,
  setTempo,
  setTimeSignature,
  setTitle,
  setTonalContext,
} from './global';
import {
  addAnnotation,
  addSlur,
  removeAnnotation,
  removeChordSymbol,
  removeDynamic,
  removeFingering,
  removeHarmonicAnalysis,
  removePedal,
  removeScaleDegree,
  removeSlur,
  setArticulations,
  setChordSymbol,
  setDynamic,
  setFingering,
  setHarmonicAnalysis,
  setPedal,
  setScaleDegree,
  updateAnnotation,
} from './layers';
import { type ScoreOperation, scoreEditSchema } from './schema';
import { deleteMeasures, insertMeasures, replaceMeasures } from './structure';
import { transpose } from './transpose';

/**
 * Applies an edit command (`{ expectedRevision, operations }`, untrusted) to a
 * validated score. On success returns the new canonical, deeply frozen score
 * at revision `score.revision + 1`.
 */
export function applyScoreEdit(score: ScoreSpec, command: unknown): Result<ScoreSpec> {
  const parsed = scoreEditSchema.safeParse(command);
  if (!parsed.success) {
    const details = schemaIssueDetails(parsed.error.issues);
    const onlyLimits = details.every((detail) => isLimitDetailCode(detail.code));
    return failure(domainError(onlyLimits ? 'MVP_LIMIT_EXCEEDED' : 'INVALID_OPERATION', details));
  }
  const { expectedRevision, operations } = parsed.data;
  if (expectedRevision !== score.revision) {
    return failure(
      domainError('REVISION_CONFLICT', [
        errorDetail(
          'REVISION_MISMATCH',
          ['expectedRevision'],
          `The score is at revision ${score.revision} but the edit expected revision ${expectedRevision}; reload the score and rebuild the edit.`,
          [score.id],
        ),
      ]),
    );
  }
  const draft = toDraft(score);
  for (const [index, operation] of operations.entries()) {
    const error = applyOperation(draft, operation, ['operations', index]);
    if (error !== undefined) {
      return failure(error);
    }
  }
  draft.revision = score.revision + 1;
  return validateScoreSpec(draft);
}

function failure(error: DomainError): Result<never> {
  return { ok: false, error };
}

function applyOperation(
  draft: ScoreDraft,
  operation: ScoreOperation,
  path: ErrorPath,
): HandlerResult {
  switch (operation.type) {
    case 'set_tempo':
      return setTempo(draft, operation);
    case 'set_time_signature':
      return setTimeSignature(draft, operation);
    case 'set_key_signature':
      return setKeySignature(draft, operation);
    case 'set_tonal_context':
      return setTonalContext(draft, operation);
    case 'set_playback_feel':
      return setPlaybackFeel(draft, operation);
    case 'set_title':
      return setTitle(draft, operation);
    case 'set_tags':
      return setTags(draft, operation);
    case 'insert_measures':
      return insertMeasures(draft, operation, path);
    case 'replace_measures':
      return replaceMeasures(draft, operation, path);
    case 'delete_measures':
      return deleteMeasures(draft, operation, path);
    case 'transpose':
      return transpose(draft, operation, path);
    case 'set_chord_symbol':
      return setChordSymbol(draft, operation, path);
    case 'remove_chord_symbol':
      return removeChordSymbol(draft, operation, path);
    case 'set_harmonic_analysis':
      return setHarmonicAnalysis(draft, operation, path);
    case 'remove_harmonic_analysis':
      return removeHarmonicAnalysis(draft, operation, path);
    case 'set_fingering':
      return setFingering(draft, operation, path);
    case 'remove_fingering':
      return removeFingering(draft, operation, path);
    case 'set_articulations':
      return setArticulations(draft, operation, path);
    case 'add_slur':
      return addSlur(draft, operation);
    case 'remove_slur':
      return removeSlur(draft, operation, path);
    case 'set_dynamic':
      return setDynamic(draft, operation);
    case 'remove_dynamic':
      return removeDynamic(draft, operation, path);
    case 'set_pedal':
      return setPedal(draft, operation);
    case 'remove_pedal':
      return removePedal(draft, operation, path);
    case 'set_scale_degree':
      return setScaleDegree(draft, operation);
    case 'remove_scale_degree':
      return removeScaleDegree(draft, operation, path);
    case 'add_annotation':
      return addAnnotation(draft, operation);
    case 'update_annotation':
      return updateAnnotation(draft, operation, path);
    case 'remove_annotation':
      return removeAnnotation(draft, operation, path);
  }
}
