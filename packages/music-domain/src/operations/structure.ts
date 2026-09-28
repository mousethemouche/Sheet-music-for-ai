/**
 * Structural operations: insert, replace and delete whole bars across every
 * staff at once, so both hands stay aligned. Bars are renumbered afterwards;
 * content outside the affected bars keeps its IDs and values. Nothing
 * cascades: references into removed content (slurs, dynamics, pedal, labels,
 * annotations, harmony) are left in place and rejected by the final
 * validation unless the same edit repairs or removes them.
 */
import type { DomainErrorDetail, ErrorPath } from '../errors';
import { domainError, errorDetail } from '../errors';
import {
  type DraftMeasure,
  type HandlerResult,
  type ScoreDraft,
  barIds,
  cloneJson,
  invalidOperation,
  targetDetail,
  targetNotFound,
} from './draft';
import type { BarContent, ScoreOperation } from './schema';

type Op<T extends ScoreOperation['type']> = Extract<ScoreOperation, { type: T }>;

/** Measures of each staff for the new bars, or the error that rejects them. */
function buildMeasures(
  draft: ScoreDraft,
  bars: readonly BarContent[],
  path: ErrorPath,
): Map<string, DraftMeasure[]> | ReturnType<typeof invalidOperation> {
  const staffIds = draft.staves.map((staff) => staff.id);
  const byStaff = new Map<string, DraftMeasure[]>(staffIds.map((id) => [id, []]));
  const unknown: DomainErrorDetail[] = [];

  for (const [barIndex, bar] of bars.entries()) {
    const barPath: ErrorPath = [...path, 'bars', barIndex, 'staves'];
    const given = bar.staves.map((content) => content.staffId);
    for (const [position, staffId] of given.entries()) {
      if (!byStaff.has(staffId)) {
        unknown.push(targetDetail(draft, staffId, [...barPath, position, 'staffId'], 'staff'));
      }
    }
    const complete =
      given.length === staffIds.length && staffIds.every((staffId) => given.includes(staffId));
    if (unknown.length === 0 && !complete) {
      return invalidOperation(
        barPath,
        `A new bar gives content for every staff of the score exactly once (${staffIds.map((id) => `"${id}"`).join(', ')}).`,
        [bar.id],
      );
    }
    for (const content of bar.staves) {
      byStaff.get(content.staffId)?.push({
        id: bar.id,
        number: 0,
        ...(bar.kind === undefined ? {} : { kind: bar.kind }),
        ...(bar.timeSignature === undefined ? {} : { timeSignature: cloneJson(bar.timeSignature) }),
        ...(bar.actualDuration === undefined
          ? {}
          : { actualDuration: cloneJson(bar.actualDuration) }),
        voices: cloneJson(content.voices),
      });
    }
  }
  if (unknown.length > 0) {
    return domainError('TARGET_NOT_FOUND', unknown);
  }
  return byStaff;
}

/** Bar numbers are 1-based positions (a pickup is bar 1). */
function renumber(draft: ScoreDraft): void {
  for (const staff of draft.staves) {
    staff.measures.forEach((measure, index) => {
      measure.number = index + 1;
    });
  }
}

/** Positions of the listed bars, or TARGET_NOT_FOUND naming every unknown one. */
function resolveBars(
  draft: ScoreDraft,
  measureIds: readonly string[],
  path: ErrorPath,
): number[] | ReturnType<typeof targetNotFound> {
  const bars = barIds(draft);
  const missing: DomainErrorDetail[] = [];
  const positions: number[] = [];
  measureIds.forEach((measureId, index) => {
    const position = bars.indexOf(measureId);
    if (position < 0) {
      missing.push(targetDetail(draft, measureId, [...path, index], 'bar'));
    } else {
      positions.push(position);
    }
  });
  return missing.length > 0 ? domainError('TARGET_NOT_FOUND', missing) : positions;
}

export function insertMeasures(
  draft: ScoreDraft,
  operation: Op<'insert_measures'>,
  path: ErrorPath,
): HandlerResult {
  const anchor = barIds(draft).indexOf(operation.measureId);
  if (anchor < 0) {
    return targetNotFound(draft, operation.measureId, [...path, 'measureId'], 'bar');
  }
  const measures = buildMeasures(draft, operation.bars, path);
  if (!(measures instanceof Map)) {
    return measures;
  }
  const at = operation.position === 'before' ? anchor : anchor + 1;
  for (const staff of draft.staves) {
    staff.measures.splice(at, 0, ...(measures.get(staff.id) ?? []));
  }
  renumber(draft);
  return undefined;
}

export function replaceMeasures(
  draft: ScoreDraft,
  operation: Op<'replace_measures'>,
  path: ErrorPath,
): HandlerResult {
  const positions = resolveBars(draft, operation.measureIds, [...path, 'measureIds']);
  if (!Array.isArray(positions)) {
    return positions;
  }
  const sorted = [...positions].sort((a, b) => a - b);
  const first = sorted[0] ?? 0;
  if (!sorted.every((position, index) => position === first + index)) {
    return invalidOperation(
      [...path, 'measureIds'],
      'replace_measures replaces one contiguous range of bars; list every bar of the range once.',
      operation.measureIds,
    );
  }
  const measures = buildMeasures(draft, operation.bars, path);
  if (!(measures instanceof Map)) {
    return measures;
  }
  for (const staff of draft.staves) {
    staff.measures.splice(first, sorted.length, ...(measures.get(staff.id) ?? []));
  }
  renumber(draft);
  return undefined;
}

export function deleteMeasures(
  draft: ScoreDraft,
  operation: Op<'delete_measures'>,
  path: ErrorPath,
): HandlerResult {
  const positions = resolveBars(draft, operation.measureIds, [...path, 'measureIds']);
  if (!Array.isArray(positions)) {
    return positions;
  }
  if (positions.length === barIds(draft).length) {
    return domainError('INVALID_OPERATION', [
      errorDetail(
        'OPERATION_INVALID',
        [...path, 'measureIds'],
        'A score keeps at least one bar; delete fewer bars or replace them instead.',
        operation.measureIds,
      ),
    ]);
  }
  const removed = new Set(positions);
  for (const staff of draft.staves) {
    staff.measures = staff.measures.filter((_, index) => !removed.has(index));
  }
  renumber(draft);
  return undefined;
}
