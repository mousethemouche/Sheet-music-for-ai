/**
 * Stable-ID index over a ScoreSpec (SCORESPEC_V1_SEMANTICS.md §12).
 *
 * Collects every identified element with its JSON path, and gives each event
 * and note its staff/bar/voice and exact musical position. Validation, typed
 * operations (#3), the renderer (#5) and the playback compiler (#6) share it
 * instead of re-walking the document.
 *
 * The index tolerates documents that are shape-valid but not yet semantically
 * valid (validateScoreSpec builds it before checking invariants): the first
 * occurrence of a duplicated ID wins and later ones are listed in
 * `duplicateIds`; positions are computed per staff from that staff's bars.
 * A declared actualDuration that no voice of its bar fills is not used for
 * positions (see `positionedBarDuration`), so building the index never fails,
 * whatever fractions a rejected document declares.
 */
import { barDuration, durationToFraction, effectiveTimeSignature, meterDuration } from './duration';
import type { ErrorPath } from './errors';
import { writtenPitchesEqual } from './pitch';
import { type Fraction, ZERO, addFractions, fractionsEqual } from './rational';
import type {
  ChordEvent,
  ChordNote,
  Measure,
  MeasureKind,
  MusicalEvent,
  Pitch,
  ScoreSpec,
  Tie,
  TimeSignature,
  Tuplet,
} from './schema';

/** Where an event (or a note inside it) sits, and when it sounds. */
export interface EventLocation {
  readonly staffId: string;
  readonly staffIndex: number;
  readonly measureId: string;
  readonly measureIndex: number;
  readonly voiceId: string;
  /** Position of the voice in its measure; voice lanes continue across bars by this index. */
  readonly voiceIndex: number;
  readonly eventIndex: number;
  /** Whole notes from the start of the bar. */
  readonly offsetInMeasure: Fraction;
  /** Whole notes from the start of the score. */
  readonly onset: Fraction;
  /** Sounding length in whole notes (tuplet ratio applied). */
  readonly duration: Fraction;
}

export interface IndexedEvent {
  readonly id: string;
  readonly event: MusicalEvent;
  readonly location: EventLocation;
  readonly path: ErrorPath;
}

/** A single written note: a NoteEvent or one member of a ChordEvent. */
export interface NoteTarget {
  readonly id: string;
  /** The owning event (equal to `id` for a NoteEvent). */
  readonly eventId: string;
  readonly pitch: Pitch;
  readonly tie: Tie | undefined;
  readonly location: EventLocation;
  readonly path: ErrorPath;
}

export interface BarInfo {
  readonly id: string;
  readonly index: number;
  readonly number: number;
  readonly kind: MeasureKind;
  readonly timeSignature: TimeSignature;
  /**
   * Actual length in whole notes: a pickup/incomplete bar's actualDuration,
   * otherwise the meter's nominal length (see `positionedBarDuration`).
   */
  readonly duration: Fraction;
  /** Whole notes from the start of the score. */
  readonly start: Fraction;
}

export interface TupletGroup {
  readonly id: string;
  /** Every event carrying this groupId, in document order. */
  readonly members: readonly IndexedEvent[];
}

export interface TiePair {
  readonly from: NoteTarget;
  readonly to: NoteTarget;
}

export type IndexedEntity =
  | {
      readonly kind: 'staff';
      readonly id: string;
      readonly path: ErrorPath;
      readonly staffIndex: number;
    }
  | {
      readonly kind: 'measure';
      readonly id: string;
      readonly path: ErrorPath;
      readonly measureIndex: number;
    }
  | {
      readonly kind: 'voice';
      readonly id: string;
      readonly path: ErrorPath;
      readonly staffId: string;
      readonly measureId: string;
      readonly voiceIndex: number;
    }
  | {
      readonly kind: 'event';
      readonly id: string;
      readonly path: ErrorPath;
      readonly indexed: IndexedEvent;
    }
  | {
      readonly kind: 'chordNote';
      readonly id: string;
      readonly path: ErrorPath;
      readonly note: ChordNote;
      readonly chordId: string;
      readonly memberIndex: number;
    }
  | { readonly kind: 'tupletGroup'; readonly id: string; readonly path: ErrorPath }
  | { readonly kind: LayerKind; readonly id: string; readonly path: ErrorPath };

/** Score-level layers that reference notes, events or bars by ID. */
export type LayerKind = 'harmony' | 'slur' | 'dynamic' | 'pedal' | 'scaleDegree' | 'annotation';

export type EntityKind = IndexedEntity['kind'];

export interface DuplicateIdOccurrence {
  readonly id: string;
  /** Path of the later occurrence (the first one stays indexed). */
  readonly path: ErrorPath;
}

export interface ScoreIndex {
  /** Bars of the first staff, in order (all staves share them once the score is valid). */
  readonly bars: readonly BarInfo[];
  readonly totalDuration: Fraction;
  /** Every event in document order: staff, bar, voice, event. */
  readonly events: readonly IndexedEvent[];
  /** Every written note in document order (chord members in chord order). */
  readonly noteTargets: readonly NoteTarget[];
  readonly tupletGroups: readonly TupletGroup[];
  /** Tie pairs whose start and end are both declared and match (§7). */
  readonly ties: readonly TiePair[];
  readonly duplicateIds: readonly DuplicateIdOccurrence[];
  get(id: string): IndexedEntity | undefined;
  event(id: string): IndexedEvent | undefined;
  noteTarget(id: string): NoteTarget | undefined;
  /** Notes sounding in an event: one for a note, all members for a chord, none for a rest. */
  notesOfEvent(eventId: string): readonly NoteTarget[];
  bar(measureId: string): BarInfo | undefined;
  /** Event, NoteEvent or chord member location. */
  location(id: string): EventLocation | undefined;
  /** Next event in the same staff and voice lane, crossing into the next bar. */
  nextInLane(eventId: string): IndexedEvent | undefined;
  /** The note a tie from `noteId` would reach: same written pitch in the next event of its lane. */
  tieContinuation(noteId: string): NoteTarget | undefined;
}

type TopLevelCollection =
  'harmony' | 'slurs' | 'dynamics' | 'pedal' | 'scaleDegrees' | 'annotations';

const TOP_LEVEL_KINDS: readonly (readonly [TopLevelCollection, LayerKind])[] = [
  ['harmony', 'harmony'],
  ['slurs', 'slur'],
  ['dynamics', 'dynamic'],
  ['pedal', 'pedal'],
  ['scaleDegrees', 'scaleDegree'],
  ['annotations', 'annotation'],
];

/**
 * The length used to position a bar: `barDuration` (the declared
 * actualDuration of a pickup/incomplete bar) when at least one voice of the
 * bar fills it exactly, otherwise the nominal length of the bar's meter. In a
 * valid score every voice fills the declared length, so this is always
 * `barDuration`. A declaration that no voice fills is already reported
 * (VOICE_DURATION_MISMATCH or MEASURE_KIND_INVALID) and may be any fraction
 * the schema allows: summing bars of 1/999983, 1/999979... leaves the
 * safe-integer range. Every position is thus a sum of meter and event
 * lengths, whose denominators stay small.
 */
function positionedBarDuration(
  measure: Measure,
  scoreTimeSignature: TimeSignature,
  voiceLengths: readonly Fraction[],
): Fraction {
  const declared = barDuration(measure, scoreTimeSignature);
  return voiceLengths.some((length) => fractionsEqual(length, declared))
    ? declared
    : meterDuration(effectiveTimeSignature(measure, scoreTimeSignature));
}

export function buildScoreIndex(spec: ScoreSpec): ScoreIndex {
  const entities = new Map<string, IndexedEntity>();
  const duplicateIds: DuplicateIdOccurrence[] = [];
  const events: IndexedEvent[] = [];
  const eventsById = new Map<string, IndexedEvent>();
  const noteTargets: NoteTarget[] = [];
  const notesById = new Map<string, NoteTarget>();
  const notesByEvent = new Map<string, NoteTarget[]>();
  const tupletMembers = new Map<string, IndexedEvent[]>();
  // lanes[staff][measure][voice] -> events of that voice
  const lanes: IndexedEvent[][][][] = [];
  // Positioned length of each bar of the first staff.
  const firstStaffBarDurations: Fraction[] = [];

  const register = (entity: IndexedEntity): boolean => {
    const existing = entities.get(entity.id);
    if (existing === undefined) {
      entities.set(entity.id, entity);
      return true;
    }
    const sharedBar =
      existing.kind === 'measure' &&
      entity.kind === 'measure' &&
      existing.measureIndex === entity.measureIndex;
    if (!sharedBar) {
      duplicateIds.push({ id: entity.id, path: entity.path });
    }
    return false;
  };

  const addNote = (target: NoteTarget): void => {
    noteTargets.push(target);
    if (!notesById.has(target.id)) {
      notesById.set(target.id, target);
    }
    const list = notesByEvent.get(target.eventId) ?? [];
    list.push(target);
    notesByEvent.set(target.eventId, list);
  };

  spec.staves.forEach((staff, staffIndex) => {
    const staffPath: ErrorPath = ['staves', staffIndex];
    register({ kind: 'staff', id: staff.id, path: staffPath, staffIndex });
    const staffLanes: IndexedEvent[][][] = [];
    lanes.push(staffLanes);
    let barStart = ZERO;

    staff.measures.forEach((measure, measureIndex) => {
      const measurePath: ErrorPath = [...staffPath, 'measures', measureIndex];
      register({ kind: 'measure', id: measure.id, path: measurePath, measureIndex });
      const measureLanes: IndexedEvent[][] = [];
      staffLanes.push(measureLanes);
      const voiceLengths: Fraction[] = [];

      measure.voices.forEach((voice, voiceIndex) => {
        const voicePath: ErrorPath = [...measurePath, 'voices', voiceIndex];
        register({
          kind: 'voice',
          id: voice.id,
          path: voicePath,
          staffId: staff.id,
          measureId: measure.id,
          voiceIndex,
        });
        const laneEvents: IndexedEvent[] = [];
        measureLanes.push(laneEvents);
        let offset = ZERO;

        voice.events.forEach((event, eventIndex) => {
          const eventPath: ErrorPath = [...voicePath, 'events', eventIndex];
          const duration = durationToFraction(event.duration);
          const location: EventLocation = {
            staffId: staff.id,
            staffIndex,
            measureId: measure.id,
            measureIndex,
            voiceId: voice.id,
            voiceIndex,
            eventIndex,
            offsetInMeasure: offset,
            onset: addFractions(barStart, offset),
            duration,
          };
          offset = addFractions(offset, duration);
          const indexed: IndexedEvent = { id: event.id, event, location, path: eventPath };
          events.push(indexed);
          laneEvents.push(indexed);
          if (register({ kind: 'event', id: event.id, path: eventPath, indexed })) {
            eventsById.set(event.id, indexed);
          }
          registerTuplet(event.duration.tuplet, indexed, eventPath);

          if (event.type === 'note') {
            addNote({
              id: event.id,
              eventId: event.id,
              pitch: event.pitch,
              tie: event.tie,
              location,
              path: eventPath,
            });
          } else if (event.type === 'chord') {
            registerChordMembers(event, eventPath, location);
          }
        });
        voiceLengths.push(offset);
      });
      const duration = positionedBarDuration(measure, spec.timeSignature, voiceLengths);
      if (staffIndex === 0) {
        firstStaffBarDurations.push(duration);
      }
      barStart = addFractions(barStart, duration);
    });
  });

  function registerTuplet(
    tuplet: Tuplet | undefined,
    indexed: IndexedEvent,
    eventPath: ErrorPath,
  ): void {
    if (tuplet === undefined) {
      return;
    }
    const members = tupletMembers.get(tuplet.groupId);
    if (members === undefined) {
      tupletMembers.set(tuplet.groupId, [indexed]);
      register({
        kind: 'tupletGroup',
        id: tuplet.groupId,
        path: [...eventPath, 'duration', 'tuplet', 'groupId'],
      });
    } else {
      members.push(indexed);
    }
  }

  function registerChordMembers(
    chord: ChordEvent,
    eventPath: ErrorPath,
    location: EventLocation,
  ): void {
    chord.notes.forEach((note, memberIndex) => {
      const notePath: ErrorPath = [...eventPath, 'notes', memberIndex];
      const isNew = register({
        kind: 'chordNote',
        id: note.id,
        path: notePath,
        note,
        chordId: chord.id,
        memberIndex,
      });
      const target: NoteTarget = {
        id: note.id,
        eventId: chord.id,
        pitch: note.pitch,
        tie: note.tie,
        location,
        path: notePath,
      };
      if (isNew) {
        addNote(target);
      } else {
        // Keep document order for pitch/tie checks without shadowing the first owner of the ID.
        noteTargets.push(target);
      }
    });
  }

  for (const [collection, kind] of TOP_LEVEL_KINDS) {
    const items: readonly { readonly id: string }[] = spec[collection] ?? [];
    items.forEach((item, position) => {
      register({ kind, id: item.id, path: [collection, position] });
    });
  }

  const bars: BarInfo[] = [];
  let start = ZERO;
  spec.staves[0]?.measures.forEach((measure, index) => {
    const duration = firstStaffBarDurations[index] ?? barDuration(measure, spec.timeSignature);
    bars.push({
      id: measure.id,
      index,
      number: measure.number,
      kind: measure.kind ?? 'full',
      timeSignature: effectiveTimeSignature(measure, spec.timeSignature),
      duration,
      start,
    });
    start = addFractions(start, duration);
  });
  const barsById = new Map<string, BarInfo>();
  for (const bar of bars) {
    if (!barsById.has(bar.id)) {
      barsById.set(bar.id, bar);
    }
  }

  const nextInLane = (eventId: string): IndexedEvent | undefined => {
    const current = eventsById.get(eventId);
    if (current === undefined) {
      return undefined;
    }
    const { staffIndex, measureIndex, voiceIndex, eventIndex } = current.location;
    const measureLanes = lanes[staffIndex];
    const sameVoice = measureLanes?.[measureIndex]?.[voiceIndex];
    return sameVoice?.[eventIndex + 1] ?? measureLanes?.[measureIndex + 1]?.[voiceIndex]?.[0];
  };

  const tieContinuation = (noteId: string): NoteTarget | undefined => {
    const note = notesById.get(noteId);
    if (note === undefined) {
      return undefined;
    }
    const next = nextInLane(note.eventId);
    if (next === undefined) {
      return undefined;
    }
    return (notesByEvent.get(next.id) ?? []).find((candidate) =>
      writtenPitchesEqual(candidate.pitch, note.pitch),
    );
  };

  const ties: TiePair[] = [];
  for (const note of notesById.values()) {
    if (note.tie?.start === true) {
      const to = tieContinuation(note.id);
      if (to?.tie?.end === true) {
        ties.push({ from: note, to });
      }
    }
  }

  const tupletGroups: TupletGroup[] = [...tupletMembers].map(([groupId, members]) => ({
    id: groupId,
    members,
  }));

  return {
    bars,
    totalDuration: start,
    events,
    noteTargets,
    tupletGroups,
    ties,
    duplicateIds,
    get: (id) => entities.get(id),
    event: (id) => eventsById.get(id),
    noteTarget: (id) => notesById.get(id),
    notesOfEvent: (eventId) => notesByEvent.get(eventId) ?? [],
    bar: (measureId) => barsById.get(measureId),
    location: (id) => eventsById.get(id)?.location ?? notesById.get(id)?.location,
    nextInLane,
    tieContinuation,
  };
}
