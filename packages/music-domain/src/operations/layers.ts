/**
 * Harmony and pedagogical operations. They target stable IDs only:
 * - note attributes (fingering, articulations) change exactly one written
 *   note: a NoteEvent or one chord member;
 * - `set_*` layer operations create the item with the given ID or replace it
 *   completely; `add_*` creates; `update_annotation` changes given fields;
 * - `remove_*` needs an existing item (TARGET_NOT_FOUND otherwise, including
 *   a repeated removal); clearing an attribute that is already absent from an
 *   existing note or harmony event changes nothing.
 * IDs an operation stores (anchors, noteIds, a harmony event's bar) are
 * references: they are checked by the final validation, so an edit may add
 * them before or after the content they point to.
 */
import type { ErrorPath } from '../errors';
import {
  type DraftNote,
  type HandlerResult,
  type ScoreDraft,
  cloneJson,
  dropIfEmpty,
  findNote,
  invalidOperation,
  targetNotFound,
} from './draft';
import type { ScoreOperation } from './schema';

type Op<T extends ScoreOperation['type']> = Extract<ScoreOperation, { type: T }>;
type DraftHarmony = NonNullable<ScoreDraft['harmony']>[number];

/** Creates `item` or replaces the item with its ID in place. */
function upsert<T extends { id: string }>(items: T[], item: T): void {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index < 0) {
    items.push(item);
  } else {
    items[index] = item;
  }
}

/** Removes the item `id`; false when there is none. */
function removeById(items: { id: string }[] | undefined, id: string): boolean {
  const index = items?.findIndex((item) => item.id === id) ?? -1;
  if (index < 0) {
    return false;
  }
  items?.splice(index, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Harmony events: chord symbol and Roman analysis are independent parts
// ---------------------------------------------------------------------------

function setHarmonyPart(
  draft: ScoreDraft,
  operation: Op<'set_chord_symbol'> | Op<'set_harmonic_analysis'>,
  path: ErrorPath,
  apply: (harmony: DraftHarmony) => void,
): HandlerResult {
  const existing = draft.harmony?.find((harmony) => harmony.id === operation.harmonyId);
  if (existing !== undefined) {
    if (operation.measureId !== undefined) {
      existing.measureId = operation.measureId;
    }
    if (operation.offset !== undefined) {
      existing.offset = cloneJson(operation.offset);
    }
    apply(existing);
    return undefined;
  }
  if (operation.measureId === undefined) {
    return invalidOperation(
      [...path, 'measureId'],
      `No harmony event has the ID "${operation.harmonyId}"; give measureId (and optionally offset) to create it.`,
      [operation.harmonyId],
    );
  }
  const created: DraftHarmony = {
    id: operation.harmonyId,
    measureId: operation.measureId,
    ...(operation.offset === undefined ? {} : { offset: cloneJson(operation.offset) }),
  };
  apply(created);
  (draft.harmony ??= []).push(created);
  return undefined;
}

function removeHarmonyPart(
  draft: ScoreDraft,
  harmonyId: string,
  path: ErrorPath,
  part: 'chord' | 'analysis',
): HandlerResult {
  const harmony = draft.harmony?.find((item) => item.id === harmonyId);
  if (harmony === undefined) {
    return targetNotFound(draft, harmonyId, [...path, 'harmonyId'], 'harmony event');
  }
  delete harmony[part];
  if (harmony.chord === undefined && harmony.analysis === undefined) {
    removeById(draft.harmony, harmonyId);
    dropIfEmpty(draft, 'harmony');
  }
  return undefined;
}

export function setChordSymbol(
  draft: ScoreDraft,
  operation: Op<'set_chord_symbol'>,
  path: ErrorPath,
): HandlerResult {
  return setHarmonyPart(draft, operation, path, (harmony) => {
    harmony.chord = cloneJson(operation.chord);
  });
}

export function removeChordSymbol(
  draft: ScoreDraft,
  operation: Op<'remove_chord_symbol'>,
  path: ErrorPath,
): HandlerResult {
  return removeHarmonyPart(draft, operation.harmonyId, path, 'chord');
}

export function setHarmonicAnalysis(
  draft: ScoreDraft,
  operation: Op<'set_harmonic_analysis'>,
  path: ErrorPath,
): HandlerResult {
  return setHarmonyPart(draft, operation, path, (harmony) => {
    harmony.analysis = cloneJson(operation.analysis);
  });
}

export function removeHarmonicAnalysis(
  draft: ScoreDraft,
  operation: Op<'remove_harmonic_analysis'>,
  path: ErrorPath,
): HandlerResult {
  return removeHarmonyPart(draft, operation.harmonyId, path, 'analysis');
}

// ---------------------------------------------------------------------------
// Note attributes
// ---------------------------------------------------------------------------

function withNote(
  draft: ScoreDraft,
  noteId: string,
  path: ErrorPath,
  change: (note: DraftNote) => void,
): HandlerResult {
  const note = findNote(draft, noteId);
  if (note === undefined) {
    return targetNotFound(draft, noteId, [...path, 'noteId'], 'note');
  }
  change(note);
  return undefined;
}

export function setFingering(
  draft: ScoreDraft,
  operation: Op<'set_fingering'>,
  path: ErrorPath,
): HandlerResult {
  return withNote(draft, operation.noteId, path, (note) => {
    note.fingering = operation.fingering;
  });
}

export function removeFingering(
  draft: ScoreDraft,
  operation: Op<'remove_fingering'>,
  path: ErrorPath,
): HandlerResult {
  return withNote(draft, operation.noteId, path, (note) => {
    delete note.fingering;
  });
}

export function setArticulations(
  draft: ScoreDraft,
  operation: Op<'set_articulations'>,
  path: ErrorPath,
): HandlerResult {
  return withNote(draft, operation.noteId, path, (note) => {
    if (operation.articulations.length === 0) {
      delete note.articulations;
    } else {
      note.articulations = [...operation.articulations];
    }
  });
}

// ---------------------------------------------------------------------------
// Slurs, dynamics, pedal and scale-degree labels
// ---------------------------------------------------------------------------

export function addSlur(draft: ScoreDraft, operation: Op<'add_slur'>): HandlerResult {
  (draft.slurs ??= []).push(cloneJson(operation.slur));
  return undefined;
}

export function removeSlur(
  draft: ScoreDraft,
  operation: Op<'remove_slur'>,
  path: ErrorPath,
): HandlerResult {
  if (!removeById(draft.slurs, operation.slurId)) {
    return targetNotFound(draft, operation.slurId, [...path, 'slurId'], 'slur');
  }
  dropIfEmpty(draft, 'slurs');
  return undefined;
}

export function setDynamic(draft: ScoreDraft, operation: Op<'set_dynamic'>): HandlerResult {
  upsert((draft.dynamics ??= []), cloneJson(operation.dynamic));
  return undefined;
}

export function removeDynamic(
  draft: ScoreDraft,
  operation: Op<'remove_dynamic'>,
  path: ErrorPath,
): HandlerResult {
  if (!removeById(draft.dynamics, operation.dynamicId)) {
    return targetNotFound(draft, operation.dynamicId, [...path, 'dynamicId'], 'dynamic');
  }
  dropIfEmpty(draft, 'dynamics');
  return undefined;
}

export function setPedal(draft: ScoreDraft, operation: Op<'set_pedal'>): HandlerResult {
  upsert((draft.pedal ??= []), cloneJson(operation.pedal));
  return undefined;
}

export function removePedal(
  draft: ScoreDraft,
  operation: Op<'remove_pedal'>,
  path: ErrorPath,
): HandlerResult {
  if (!removeById(draft.pedal, operation.pedalId)) {
    return targetNotFound(draft, operation.pedalId, [...path, 'pedalId'], 'pedal span');
  }
  dropIfEmpty(draft, 'pedal');
  return undefined;
}

export function setScaleDegree(
  draft: ScoreDraft,
  operation: Op<'set_scale_degree'>,
): HandlerResult {
  upsert((draft.scaleDegrees ??= []), cloneJson(operation.scaleDegree));
  return undefined;
}

export function removeScaleDegree(
  draft: ScoreDraft,
  operation: Op<'remove_scale_degree'>,
  path: ErrorPath,
): HandlerResult {
  if (!removeById(draft.scaleDegrees, operation.scaleDegreeId)) {
    return targetNotFound(
      draft,
      operation.scaleDegreeId,
      [...path, 'scaleDegreeId'],
      'scale-degree label',
    );
  }
  dropIfEmpty(draft, 'scaleDegrees');
  return undefined;
}

// ---------------------------------------------------------------------------
// Teaching annotations (P-03 is checked on the final document)
// ---------------------------------------------------------------------------

export function addAnnotation(draft: ScoreDraft, operation: Op<'add_annotation'>): HandlerResult {
  draft.annotations.push(cloneJson(operation.annotation));
  return undefined;
}

export function updateAnnotation(
  draft: ScoreDraft,
  operation: Op<'update_annotation'>,
  path: ErrorPath,
): HandlerResult {
  const annotation = draft.annotations.find((item) => item.id === operation.annotationId);
  if (annotation === undefined) {
    return targetNotFound(draft, operation.annotationId, [...path, 'annotationId'], 'annotation');
  }
  if (operation.color !== undefined) {
    annotation.color = operation.color;
  }
  if (operation.noteIds !== undefined) {
    annotation.noteIds = [...operation.noteIds];
  }
  if (operation.text !== undefined) {
    annotation.text = operation.text;
  }
  return undefined;
}

export function removeAnnotation(
  draft: ScoreDraft,
  operation: Op<'remove_annotation'>,
  path: ErrorPath,
): HandlerResult {
  if (!removeById(draft.annotations, operation.annotationId)) {
    return targetNotFound(draft, operation.annotationId, [...path, 'annotationId'], 'annotation');
  }
  return undefined;
}
