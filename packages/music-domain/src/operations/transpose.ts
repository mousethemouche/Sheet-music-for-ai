/**
 * `transpose`: moves every written note of the selected staff x bar cells by
 * one key-aware interval (./spelling). Rhythm, IDs, ties, fingering and every
 * other field stay as they are.
 *
 * Harmonic context never goes silently stale:
 * - an octave shift changes no pitch class, so nothing else changes;
 * - a whole-score shift moves the key signature, the tonal context and the
 *   chord symbols with the music; Roman numerals and scale degrees are
 *   relative to the key, so they stay correct;
 * - any other shift (part of the score, not by octaves) is rejected while
 *   harmony events of the selected bars or scale-degree labels of the moved
 *   notes exist: the edit must remove or replace them explicitly first.
 */
import type { DomainErrorDetail, ErrorPath } from '../errors';
import { domainError, errorDetail } from '../errors';
import { PIANO_KEY_RANGE, formatWrittenPitch, writtenPitchToKey } from '../pitch';
import {
  type DraftNote,
  type HandlerResult,
  type ScoreDraft,
  barIds,
  notesOf,
  targetDetail,
} from './draft';
import type { ScoreOperation } from './schema';
import {
  type Interval,
  chooseInterval,
  transposeChordDisplay,
  transposePitch,
  transposePitchClass,
} from './spelling';

type TransposeOperation = Extract<ScoreOperation, { type: 'transpose' }>;
type MutableChord = NonNullable<NonNullable<ScoreDraft['harmony']>[number]['chord']>;

const quote = (id: string): string => `"${id}"`;

interface Selection {
  readonly staffIds: ReadonlySet<string>;
  readonly measureIds: ReadonlySet<string>;
  readonly wholeScore: boolean;
}

function resolveSelection(
  draft: ScoreDraft,
  operation: TransposeOperation,
  path: ErrorPath,
): Selection | DomainErrorDetail[] {
  const allStaves = draft.staves.map((staff) => staff.id);
  const allBars = barIds(draft);
  const missing: DomainErrorDetail[] = [];
  const check = (ids: readonly string[] | undefined, known: readonly string[], field: string) =>
    ids?.forEach((id, index) => {
      if (!known.includes(id)) {
        missing.push(
          targetDetail(
            draft,
            id,
            [...path, 'target', field, index],
            field === 'staffIds' ? 'staff' : 'bar',
          ),
        );
      }
    });
  check(operation.target.staffIds, allStaves, 'staffIds');
  check(operation.target.measureIds, allBars, 'measureIds');
  if (missing.length > 0) {
    return missing;
  }
  const staffIds = new Set(operation.target.staffIds ?? allStaves);
  const measureIds = new Set(operation.target.measureIds ?? allBars);
  return {
    staffIds,
    measureIds,
    wholeScore: staffIds.size === allStaves.length && measureIds.size === allBars.length,
  };
}

function transposedChord(chord: MutableChord, interval: Interval): MutableChord | undefined {
  const root = transposePitchClass(chord.root, interval);
  const bass = chord.bass === undefined ? undefined : transposePitchClass(chord.bass, interval);
  const moved: MutableChord = { ...chord, root, ...(bass === undefined ? {} : { bass }) };
  if (chord.display === undefined) {
    return moved;
  }
  const display = transposeChordDisplay(chord.display, chord, moved);
  return display === undefined ? undefined : { ...moved, display };
}

export function transpose(
  draft: ScoreDraft,
  operation: TransposeOperation,
  path: ErrorPath,
): HandlerResult {
  const selection = resolveSelection(draft, operation, path);
  if (Array.isArray(selection)) {
    return domainError('TARGET_NOT_FOUND', selection);
  }
  const interval = chooseInterval(operation.semitones, draft.keySignature?.fifths ?? 0);
  const byOctave = interval.fifths === 0 && interval.letterShift === 0;

  const moved: DraftNote[] = [];
  for (const { note, staffId, measureId } of notesOf(draft)) {
    if (selection.staffIds.has(staffId) && selection.measureIds.has(measureId)) {
      moved.push(note);
    }
  }

  const outOfRange = moved.filter((note) => {
    const key = writtenPitchToKey(note.pitch) + operation.semitones;
    return key < PIANO_KEY_RANGE.lowest || key > PIANO_KEY_RANGE.highest;
  });
  if (outOfRange.length > 0) {
    return domainError(
      'INVALID_OPERATION',
      outOfRange.map((note) =>
        errorDetail(
          'PITCH_OUT_OF_RANGE',
          [...path, 'semitones'],
          `${formatWrittenPitch(note.pitch)} moved by ${operation.semitones} semitones leaves the piano range A0-C8.`,
          [note.id],
        ),
      ),
    );
  }

  const stale: DomainErrorDetail[] = [];
  const chords = new Map<string, MutableChord>();
  if (!byOctave && !selection.wholeScore) {
    const movedIds = new Set(moved.map((note) => note.id));
    for (const harmony of draft.harmony ?? []) {
      if (selection.measureIds.has(harmony.measureId)) {
        stale.push(
          errorDetail(
            'OPERATION_INVALID',
            [...path, 'target'],
            `Harmony event ${quote(harmony.id)} describes a bar this partial transposition changes; remove or replace its chord symbol and analysis before transposing.`,
            [harmony.id],
          ),
        );
      }
    }
    for (const label of draft.scaleDegrees ?? []) {
      if (movedIds.has(label.noteId)) {
        stale.push(
          errorDetail(
            'OPERATION_INVALID',
            [...path, 'target'],
            `Scale-degree label ${quote(label.id)} is on a note this partial transposition moves away from the key; remove or replace it before transposing.`,
            [label.id],
          ),
        );
      }
    }
  } else if (!byOctave) {
    for (const harmony of draft.harmony ?? []) {
      if (harmony.chord === undefined) {
        continue;
      }
      const chord = transposedChord(harmony.chord, interval);
      if (chord === undefined) {
        stale.push(
          errorDetail(
            'OPERATION_INVALID',
            [...path, 'target'],
            `The display text of chord symbol ${quote(harmony.id)} cannot be transposed automatically; replace the chord symbol (or drop its display) before transposing.`,
            [harmony.id],
          ),
        );
      } else {
        chords.set(harmony.id, chord);
      }
    }
  }
  if (stale.length > 0) {
    return domainError('INVALID_OPERATION', stale);
  }

  for (const note of moved) {
    note.pitch = transposePitch(note.pitch, interval);
  }
  if (selection.wholeScore && !byOctave) {
    if (draft.keySignature !== undefined) {
      draft.keySignature = { fifths: draft.keySignature.fifths + interval.fifths };
    }
    if (draft.tonalContext !== undefined) {
      draft.tonalContext = {
        ...draft.tonalContext,
        tonic: transposePitchClass(draft.tonalContext.tonic, interval),
      };
    }
    for (const harmony of draft.harmony ?? []) {
      const chord = chords.get(harmony.id);
      if (chord !== undefined) {
        harmony.chord = chord;
      }
    }
  }
  return undefined;
}
