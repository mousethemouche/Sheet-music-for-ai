/**
 * validateScoreSpec: the single entry point that turns untrusted input into a
 * canonical ScoreSpec v1 or a structured DomainError (ADR-001 invariants 1-21
 * and P-03; rules in SCORESPEC_V1_SEMANTICS.md).
 *
 * Pipeline: strict schema parse (shape, scalars, MVP limits) -> deep freeze ->
 * stable-ID index -> semantic invariants. Semantic checks run only on a
 * shape-valid document; every violation found is reported, not only the first.
 */
import { deepFreeze } from './deep-freeze';
import {
  barDuration,
  durationToFraction,
  effectiveTimeSignature,
  meterDuration,
  writtenDuration,
} from './duration';
import {
  type DomainErrorDetail,
  type ErrorPath,
  type Result,
  domainError,
  errorDetail,
  isLimitDetailCode,
} from './errors';
import { formatWrittenPitch, isOnPianoKeyboard, writtenPitchesEqual } from './pitch';
import {
  type Fraction,
  ZERO,
  addFractions,
  compareFractions,
  divideFractions,
  formatFraction,
  fraction,
  fractionsEqual,
  reduce,
  sumFractions,
} from './rational';
import {
  type Measure,
  type ScoreSpec,
  type TimeSignature,
  type Tuplet,
  scoreSpecSchema,
} from './schema';
import { schemaIssueDetails } from './schema-issues';
import {
  type EventLocation,
  type IndexedEvent,
  type NoteTarget,
  type ScoreIndex,
  type TupletGroup,
  buildScoreIndex,
} from './score-index';

/**
 * Validates untrusted input. Never mutates `input`. On success returns a new,
 * deeply frozen, canonical ScoreSpec (clef filled from hand when omitted,
 * annotation colors as lowercase "#rrggbb"); everything else is preserved.
 */
export function validateScoreSpec(input: unknown): Result<ScoreSpec> {
  const parsed = scoreSpecSchema.safeParse(input);
  if (!parsed.success) {
    return rejected(schemaIssueDetails(parsed.error.issues));
  }
  const spec: ScoreSpec = deepFreeze(parsed.data);
  const details = checkInvariants(spec, buildScoreIndex(spec));
  return details.length === 0 ? { ok: true, value: spec } : rejected(details);
}

/** MVP_LIMIT_EXCEEDED only when every problem is an exceeded limit; otherwise SCORE_VALIDATION_FAILED. */
function rejected(details: readonly DomainErrorDetail[]): Result<never> {
  const onlyLimits = details.every((detail) => isLimitDetailCode(detail.code));
  return {
    ok: false,
    error: domainError(onlyLimits ? 'MVP_LIMIT_EXCEEDED' : 'SCORE_VALIDATION_FAILED', details),
  };
}

function checkInvariants(spec: ScoreSpec, index: ScoreIndex): DomainErrorDetail[] {
  const structure = checkMeasureStructure(spec);
  return [
    ...checkDuplicateIds(index),
    ...checkStaffHands(spec),
    ...structure.details,
    ...checkVoiceDurations(spec, structure.barsWithInvalidKind),
    ...checkTupletGroups(index),
    ...checkPitches(index),
    ...checkTies(index),
    ...checkHarmony(spec, index),
    ...checkSlurs(spec, index),
    ...checkDynamics(spec, index),
    ...checkPedal(spec, index),
    ...checkScaleDegrees(spec, index),
    ...checkAnnotations(spec, index),
  ];
}

const quote = (id: string): string => `"${id}"`;
const sortedIds = (ids: Iterable<string>): string[] => [...ids].sort();

// ---------------------------------------------------------------------------
// Identity and structure
// ---------------------------------------------------------------------------

function checkDuplicateIds(index: ScoreIndex): DomainErrorDetail[] {
  return index.duplicateIds.map((duplicate) =>
    errorDetail(
      'DUPLICATE_ID',
      duplicate.path,
      `The ID ${quote(duplicate.id)} is already used by another element; IDs are unique within a score (a bar ID is shared only by the same bar of each staff).`,
      [duplicate.id],
    ),
  );
}

function checkStaffHands(spec: ScoreSpec): DomainErrorDetail[] {
  const [first, second] = spec.staves;
  if (first === undefined || second === undefined) {
    return [];
  }
  if (first.hand === 'right' && second.hand === 'left') {
    return [];
  }
  return [
    errorDetail(
      'STAFF_HANDS_INVALID',
      ['staves'],
      'Two staves must be the right hand followed by the left hand.',
      [first.id, second.id],
    ),
  ];
}

function sameTimeSignature(a: TimeSignature | undefined, b: TimeSignature | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function sameOptionalFraction(a: Fraction | undefined, b: Fraction | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return fractionsEqual(a, b);
}

function measureKindProblem(
  measure: Measure,
  position: number,
  scoreTimeSignature: TimeSignature,
): string | undefined {
  const kind = measure.kind ?? 'full';
  if (kind === 'full') {
    return measure.actualDuration === undefined
      ? undefined
      : 'Only pickup or incomplete bars declare actualDuration.';
  }
  if (kind === 'pickup' && position !== 0) {
    return 'Only the first bar can be a pickup; mark a later short bar as incomplete.';
  }
  if (kind === 'incomplete' && position === 0) {
    return 'A short first bar is a pickup, not an incomplete bar.';
  }
  if (measure.actualDuration === undefined) {
    return `A ${kind} bar must declare its actualDuration.`;
  }
  const nominal = meterDuration(effectiveTimeSignature(measure, scoreTimeSignature));
  const actual = reduce(measure.actualDuration);
  if (actual.numerator === 0 || compareFractions(actual, nominal) >= 0) {
    return `actualDuration must be greater than 0 and shorter than the ${formatFraction(nominal)} whole-note bar.`;
  }
  return undefined;
}

function checkMeasureStructure(spec: ScoreSpec): {
  details: DomainErrorDetail[];
  barsWithInvalidKind: ReadonlySet<string>;
} {
  const details: DomainErrorDetail[] = [];
  const barsWithInvalidKind = new Set<string>();

  spec.staves.forEach((staff, staffIndex) => {
    staff.measures.forEach((measure, position) => {
      const path: ErrorPath = ['staves', staffIndex, 'measures', position];
      if (measure.number !== position + 1) {
        details.push(
          errorDetail(
            'MEASURE_NUMBER_INVALID',
            [...path, 'number'],
            `Bar numbers are 1-based and consecutive: this bar must be number ${position + 1}.`,
            [measure.id],
          ),
        );
      }
      const problem = measureKindProblem(measure, position, spec.timeSignature);
      if (problem !== undefined) {
        barsWithInvalidKind.add(`${staffIndex}:${position}`);
        details.push(errorDetail('MEASURE_KIND_INVALID', path, problem, [measure.id]));
      }
    });
  });

  const [reference, ...others] = spec.staves;
  if (reference === undefined) {
    return { details, barsWithInvalidKind };
  }
  others.forEach((staff, offset) => {
    const staffIndex = offset + 1;
    if (staff.measures.length !== reference.measures.length) {
      details.push(
        errorDetail(
          'MEASURE_ALIGNMENT_MISMATCH',
          ['staves', staffIndex, 'measures'],
          `This staff has ${staff.measures.length} bars but staff ${quote(reference.id)} has ${reference.measures.length}; every staff has the same bars.`,
          [reference.id, staff.id],
        ),
      );
    }
    const shared = Math.min(staff.measures.length, reference.measures.length);
    for (let position = 0; position < shared; position += 1) {
      const measure = staff.measures[position];
      const expected = reference.measures[position];
      if (measure === undefined || expected === undefined) {
        continue;
      }
      const differences = [
        measure.id !== expected.id ? 'id' : undefined,
        (measure.kind ?? 'full') !== (expected.kind ?? 'full') ? 'kind' : undefined,
        sameTimeSignature(measure.timeSignature, expected.timeSignature)
          ? undefined
          : 'timeSignature',
        sameOptionalFraction(measure.actualDuration, expected.actualDuration)
          ? undefined
          : 'actualDuration',
      ].filter((difference) => difference !== undefined);
      if (differences.length > 0) {
        details.push(
          errorDetail(
            'MEASURE_ALIGNMENT_MISMATCH',
            ['staves', staffIndex, 'measures', position],
            `Bar ${position + 1} differs from the same bar of staff ${quote(reference.id)} in: ${differences.join(', ')}.`,
            [...new Set([expected.id, measure.id])],
          ),
        );
      }
    }
  });
  return { details, barsWithInvalidKind };
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

function checkVoiceDurations(
  spec: ScoreSpec,
  barsWithInvalidKind: ReadonlySet<string>,
): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  spec.staves.forEach((staff, staffIndex) => {
    staff.measures.forEach((measure, position) => {
      if (barsWithInvalidKind.has(`${staffIndex}:${position}`)) {
        return;
      }
      const required = barDuration(measure, spec.timeSignature);
      measure.voices.forEach((voice, voiceIndex) => {
        const actual = sumFractions(
          voice.events.map((event) => durationToFraction(event.duration)),
        );
        const order = compareFractions(actual, required);
        if (order !== 0) {
          details.push(
            errorDetail(
              'VOICE_DURATION_MISMATCH',
              ['staves', staffIndex, 'measures', position, 'voices', voiceIndex],
              `The voice lasts ${formatFraction(actual)} whole notes but bar ${position + 1} lasts ${formatFraction(required)}; ${order > 0 ? 'it overfills the bar' : 'it leaves an unexplained gap (add rests, or declare a pickup/incomplete bar)'}.`,
              [voice.id],
            ),
          );
        }
      });
    });
  });
  return details;
}

/** Tuplet units: written group length divided by `actual` must be one of these plain values. */
const PLAIN_VALUE_DENOMINATORS: ReadonlySet<number> = new Set([1, 2, 4, 8, 16, 32]);

function sameRatio(a: Tuplet | undefined, b: Tuplet): boolean {
  return a !== undefined && a.actual === b.actual && a.normal === b.normal;
}

function tupletGroupProblem(members: readonly IndexedEvent[], ratio: Tuplet): string | undefined {
  const first = members[0]?.location;
  if (first === undefined || members.length < 2) {
    return 'A tuplet group needs at least two consecutive events.';
  }
  const consecutive = members.every(
    ({ location }, position) =>
      location.staffIndex === first.staffIndex &&
      location.measureIndex === first.measureIndex &&
      location.voiceIndex === first.voiceIndex &&
      location.eventIndex === first.eventIndex + position,
  );
  if (!consecutive) {
    return 'Members of a tuplet group must be consecutive events of one voice in one bar.';
  }
  if (!members.every(({ event }) => sameRatio(event.duration.tuplet, ratio))) {
    return 'Every member of a tuplet group must use the same actual:normal ratio.';
  }
  const written = sumFractions(members.map(({ event }) => writtenDuration(event.duration)));
  const unit = divideFractions(written, fraction(ratio.actual));
  if (unit.numerator !== 1 || !PLAIN_VALUE_DENOMINATORS.has(unit.denominator)) {
    return `The group's written length (${formatFraction(written)} whole notes) is not ${ratio.actual} equal whole, half, quarter, eighth, sixteenth or thirty-second units.`;
  }
  return undefined;
}

function checkTupletGroups(index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  for (const group of index.tupletGroups) {
    const first = group.members[0];
    const ratio = first?.event.duration.tuplet;
    if (first === undefined || ratio === undefined) {
      continue;
    }
    const problem = tupletGroupProblem(group.members, ratio);
    if (problem !== undefined) {
      details.push(tupletDetail(group, first, problem));
    }
  }
  return details;
}

function tupletDetail(group: TupletGroup, first: IndexedEvent, message: string): DomainErrorDetail {
  return errorDetail('TUPLET_GROUP_INVALID', [...first.path, 'duration', 'tuplet'], message, [
    group.id,
  ]);
}

// ---------------------------------------------------------------------------
// Pitch and ties
// ---------------------------------------------------------------------------

/** Note targets that own their ID (later duplicates are reported by DUPLICATE_ID only). */
function ownedNoteTargets(index: ScoreIndex): NoteTarget[] {
  return index.noteTargets.filter((target) => index.noteTarget(target.id) === target);
}

function checkPitches(index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  for (const target of index.noteTargets) {
    if (!isOnPianoKeyboard(target.pitch)) {
      details.push(
        errorDetail(
          'PITCH_OUT_OF_RANGE',
          [...target.path, 'pitch'],
          `${formatWrittenPitch(target.pitch)} is outside the piano range A0-C8.`,
          [target.id],
        ),
      );
    }
  }
  for (const { event, path } of index.events) {
    if (event.type !== 'chord') {
      continue;
    }
    event.notes.forEach((member, position) => {
      const repeated = event.notes
        .slice(0, position)
        .some((earlier) => writtenPitchesEqual(earlier.pitch, member.pitch));
      if (repeated) {
        details.push(
          errorDetail(
            'CHORD_DUPLICATE_PITCH',
            [...path, 'notes', position, 'pitch'],
            `The chord repeats the written pitch ${formatWrittenPitch(member.pitch)}.`,
            [event.id, member.id],
          ),
        );
      }
    });
  }
  return details;
}

function checkTies(index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  const reached = new Set<string>();
  const targets = ownedNoteTargets(index);
  for (const target of targets) {
    if (target.tie?.start !== true) {
      continue;
    }
    const next = index.tieContinuation(target.id);
    if (next === undefined) {
      details.push(
        errorDetail(
          'TIE_UNMATCHED',
          [...target.path, 'tie'],
          'A tie start needs a note of the same written pitch in the next event of the same voice (across a bar line: the same voice position of the next bar).',
          [target.id],
        ),
      );
      continue;
    }
    reached.add(next.id);
    if (next.tie?.end !== true) {
      details.push(
        errorDetail(
          'TIE_UNMATCHED',
          [...target.path, 'tie'],
          `The following note of the same written pitch, ${quote(next.id)}, does not declare tie.end.`,
          [target.id, next.id],
        ),
      );
    }
  }
  for (const target of targets) {
    if (target.tie?.end === true && !reached.has(target.id)) {
      details.push(
        errorDetail(
          'TIE_UNMATCHED',
          [...target.path, 'tie'],
          'A tie end needs a tie start on the same written pitch in the previous event of the same voice.',
          [target.id],
        ),
      );
    }
  }
  return details;
}

// ---------------------------------------------------------------------------
// References, spans and attachments
// ---------------------------------------------------------------------------

function referenceProblem(
  index: ScoreIndex,
  id: string,
  path: ErrorPath,
  expected: string,
): DomainErrorDetail {
  return index.get(id) === undefined
    ? errorDetail('REFERENCE_NOT_FOUND', path, `No element has the ID ${quote(id)}.`, [id])
    : errorDetail('REFERENCE_KIND_MISMATCH', path, `${quote(id)} must be ${expected}.`, [id]);
}

function resolveNote(
  index: ScoreIndex,
  id: string,
  path: ErrorPath,
  sink: DomainErrorDetail[],
): NoteTarget | undefined {
  const target = index.noteTarget(id);
  if (target === undefined) {
    sink.push(referenceProblem(index, id, path, 'a note or a chord member'));
  }
  return target;
}

function resolveEvent(
  index: ScoreIndex,
  id: string,
  path: ErrorPath,
  sink: DomainErrorDetail[],
): IndexedEvent | undefined {
  const event = index.event(id);
  if (event === undefined) {
    sink.push(referenceProblem(index, id, path, 'a note, chord or rest event'));
  }
  return event;
}

/** A resolved span in musical time: [start, end) where end is the end of the last target. */
interface TimedSpan {
  readonly id: string;
  readonly staffId: string;
  readonly start: Fraction;
  readonly end: Fraction;
  readonly path: ErrorPath;
}

function orderedSpan(
  label: string,
  id: string,
  path: ErrorPath,
  start: EventLocation,
  end: EventLocation,
  allowSameOnset: boolean,
  sink: DomainErrorDetail[],
): TimedSpan | undefined {
  if (start.staffId !== end.staffId) {
    sink.push(
      errorDetail('SPAN_CROSS_STAFF', path, `A ${label} starts and ends on the same staff.`, [id]),
    );
    return undefined;
  }
  const order = compareFractions(start.onset, end.onset);
  if (order > 0 || (order === 0 && !allowSameOnset)) {
    sink.push(
      errorDetail(
        'SPAN_ORDER_INVALID',
        path,
        allowSameOnset
          ? `A ${label} cannot end before it starts.`
          : `A ${label} must end on a note that starts later than its first note.`,
        [id],
      ),
    );
    return undefined;
  }
  return {
    id,
    staffId: start.staffId,
    start: start.onset,
    end: addFractions(end.onset, end.duration),
    path,
  };
}

function overlaps(
  spans: readonly TimedSpan[],
  label: string,
  sameStaffOnly: boolean,
): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  spans.forEach((later, position) => {
    for (const earlier of spans.slice(0, position)) {
      if (sameStaffOnly && earlier.staffId !== later.staffId) {
        continue;
      }
      if (
        compareFractions(earlier.start, later.end) < 0 &&
        compareFractions(later.start, earlier.end) < 0
      ) {
        details.push(
          errorDetail(
            'SPAN_OVERLAP',
            later.path,
            `${label} spans ${quote(earlier.id)} and ${quote(later.id)} overlap in time.`,
            sortedIds([earlier.id, later.id]),
          ),
        );
      }
    }
  });
  return details;
}

/** One detail per target carrying more than one attachment of a kind. */
function attachmentConflicts(
  attachments: ReadonlyMap<string, readonly string[]>,
  path: ErrorPath,
  describe: (targetId: string, count: number) => string,
): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  for (const [targetId, ids] of attachments) {
    if (ids.length > 1) {
      details.push(
        errorDetail('ATTACHMENT_CONFLICT', path, describe(targetId, ids.length), [
          targetId,
          ...sortedIds(ids),
        ]),
      );
    }
  }
  return details;
}

function append(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
}

function checkHarmony(spec: ScoreSpec, index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  const byPosition = new Map<string, { measureId: string; offset: Fraction; ids: string[] }>();
  (spec.harmony ?? []).forEach((harmony, position) => {
    const path: ErrorPath = ['harmony', position];
    const bar = index.bar(harmony.measureId);
    if (bar === undefined) {
      details.push(
        referenceProblem(index, harmony.measureId, [...path, 'measureId'], 'a bar (measure) ID'),
      );
      return;
    }
    const offset = reduce(harmony.offset ?? ZERO);
    if (compareFractions(offset, bar.duration) >= 0) {
      details.push(
        errorDetail(
          'POSITION_OUT_OF_RANGE',
          [...path, 'offset'],
          `Offset ${formatFraction(offset)} is not inside bar ${bar.number}, which lasts ${formatFraction(bar.duration)} whole notes.`,
          [harmony.id],
        ),
      );
      return;
    }
    const key = `${harmony.measureId}@${formatFraction(offset)}`;
    const group = byPosition.get(key);
    if (group === undefined) {
      byPosition.set(key, { measureId: harmony.measureId, offset, ids: [harmony.id] });
    } else {
      group.ids.push(harmony.id);
    }
  });
  for (const { measureId, offset, ids } of byPosition.values()) {
    if (ids.length > 1) {
      details.push(
        errorDetail(
          'ATTACHMENT_CONFLICT',
          ['harmony'],
          `Bar ${quote(measureId)} has ${ids.length} harmony events at offset ${formatFraction(offset)}; at most one per position.`,
          [measureId, ...sortedIds(ids)],
        ),
      );
    }
  }
  return details;
}

function checkSlurs(spec: ScoreSpec, index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  (spec.slurs ?? []).forEach((slur, position) => {
    const path: ErrorPath = ['slurs', position];
    const start = resolveNote(index, slur.startNoteId, [...path, 'startNoteId'], details);
    const end = resolveNote(index, slur.endNoteId, [...path, 'endNoteId'], details);
    if (start !== undefined && end !== undefined) {
      orderedSpan('slur', slur.id, path, start.location, end.location, false, details);
    }
  });
  return details;
}

function checkDynamics(spec: ScoreSpec, index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  const marksByEvent = new Map<string, string[]>();
  const hairpins: TimedSpan[] = [];
  (spec.dynamics ?? []).forEach((dynamic, position) => {
    const path: ErrorPath = ['dynamics', position];
    if (dynamic.type === 'mark') {
      if (resolveEvent(index, dynamic.eventId, [...path, 'eventId'], details) !== undefined) {
        append(marksByEvent, dynamic.eventId, dynamic.id);
      }
      return;
    }
    const start = resolveEvent(index, dynamic.startEventId, [...path, 'startEventId'], details);
    const end = resolveEvent(index, dynamic.endEventId, [...path, 'endEventId'], details);
    if (start !== undefined && end !== undefined) {
      const span = orderedSpan(
        'hairpin',
        dynamic.id,
        path,
        start.location,
        end.location,
        true,
        details,
      );
      if (span !== undefined) {
        hairpins.push(span);
      }
    }
  });
  details.push(
    ...attachmentConflicts(
      marksByEvent,
      ['dynamics'],
      (eventId, count) =>
        `Event ${quote(eventId)} carries ${count} dynamic marks; at most one is allowed.`,
    ),
    ...overlaps(hairpins, 'Hairpin', true),
  );
  return details;
}

function checkPedal(spec: ScoreSpec, index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  const spans: TimedSpan[] = [];
  (spec.pedal ?? []).forEach((pedal, position) => {
    const path: ErrorPath = ['pedal', position];
    const start = resolveEvent(index, pedal.startEventId, [...path, 'startEventId'], details);
    const end = resolveEvent(index, pedal.endEventId, [...path, 'endEventId'], details);
    if (start !== undefined && end !== undefined) {
      const span = orderedSpan(
        'sustain-pedal span',
        pedal.id,
        path,
        start.location,
        end.location,
        true,
        details,
      );
      if (span !== undefined) {
        spans.push(span);
      }
    }
  });
  details.push(...overlaps(spans, 'Sustain-pedal', false));
  return details;
}

function checkScaleDegrees(spec: ScoreSpec, index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  const labelsByNote = new Map<string, string[]>();
  (spec.scaleDegrees ?? []).forEach((label, position) => {
    const path: ErrorPath = ['scaleDegrees', position, 'noteId'];
    if (resolveNote(index, label.noteId, path, details) !== undefined) {
      append(labelsByNote, label.noteId, label.id);
    }
  });
  details.push(
    ...attachmentConflicts(
      labelsByNote,
      ['scaleDegrees'],
      (noteId, count) =>
        `Note ${quote(noteId)} carries ${count} scale-degree labels; at most one is allowed.`,
    ),
  );
  return details;
}

/** References, duplicates and P-03: one note carries at most one canonical teaching color. */
function checkAnnotations(spec: ScoreSpec, index: ScoreIndex): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  const colorsByNote = new Map<string, Map<string, string[]>>();
  spec.annotations.forEach((annotation, position) => {
    const seen = new Set<string>();
    annotation.noteIds.forEach((noteId, noteIndex) => {
      const path: ErrorPath = ['annotations', position, 'noteIds', noteIndex];
      if (seen.has(noteId)) {
        details.push(
          errorDetail(
            'REFERENCE_DUPLICATE',
            path,
            `The annotation lists ${quote(noteId)} more than once.`,
            [noteId],
          ),
        );
        return;
      }
      seen.add(noteId);
      if (resolveNote(index, noteId, path, details) === undefined) {
        return;
      }
      const colors = colorsByNote.get(noteId) ?? new Map<string, string[]>();
      append(colors, annotation.color, annotation.id);
      colorsByNote.set(noteId, colors);
    });
  });
  for (const target of ownedNoteTargets(index)) {
    const colors = colorsByNote.get(target.id);
    if (colors === undefined || colors.size < 2) {
      continue;
    }
    const annotationIds = sortedIds([...colors.values()].flat());
    details.push(
      errorDetail(
        'ANNOTATION_COLOR_CONFLICT',
        ['annotations'],
        `Note ${quote(target.id)} is highlighted in ${colors.size} different colors by annotations ${annotationIds.map(quote).join(', ')}; a note carries at most one teaching color.`,
        [target.id, ...annotationIds],
      ),
    );
  }
  return details;
}
