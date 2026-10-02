/**
 * ScoreSpec -> VexFlow objects, one bar at a time (no drawing, no DOM).
 *
 * `prepareScore` gathers the score-wide decisions (accidentals, teaching
 * colors, label anchors). `buildBar` creates the notes, modifiers, tuplets,
 * beams and voices of one bar on the staves it is given, joined in one
 * Formatter so that both hands share tick contexts (aligned onsets).
 */
import {
  type Articulation as ArticulationName,
  type DynamicMark,
  type Fraction,
  type HarmonyEvent,
  type IndexedEvent,
  type MusicalEvent,
  type ScaleDegreeLabel,
  type ScoreIndex,
  type ScoreSpec,
  type TimeSignature,
  ZERO,
  buildScoreIndex,
  compareFractions,
  fractionsEqual,
  reduce,
  subtractFractions,
} from '@sheet-music/music-domain';
import {
  Accidental,
  Articulation,
  Beam,
  Dot,
  Element as VexElement,
  Formatter,
  FretHandFinger,
  GhostNote,
  Modifier,
  type Note,
  PedalMarking,
  type Stave,
  StaveNote,
  Stem,
  TextDynamics,
  TextNote,
  Tuplet,
  Voice,
} from 'vexflow/core';
import {
  type BeamCandidate,
  type SpelledEvent,
  VEXFLOW_ARTICULATIONS,
  VEXFLOW_DURATIONS,
  beamGroups,
  chordSymbolText,
  displayedAccidentals,
  fingeringGoesAbove,
  vexflowKey,
} from './notation';

/** Score-wide rendering decisions, computed once per engraving. */
export interface PreparedScore {
  readonly score: ScoreSpec;
  readonly index: ScoreIndex;
  readonly fifths: number;
  /** Teaching color of each targeted note (P-03 guarantees at most one). */
  readonly colors: ReadonlyMap<string, string>;
  /** Accidental code drawn on a note, when it shows one. */
  readonly accidentals: ReadonlyMap<string, string>;
  readonly harmonyByBar: ReadonlyMap<string, readonly HarmonyEvent[]>;
  readonly markByEvent: ReadonlyMap<string, { readonly id: string; readonly marking: DynamicMark }>;
  readonly degreeByNote: ReadonlyMap<string, ScaleDegreeLabel>;
}

export function prepareScore(score: ScoreSpec): PreparedScore {
  const index = buildScoreIndex(score);
  const fifths = score.keySignature?.fifths ?? 0;

  const colors = new Map<string, string>();
  for (const annotation of score.annotations) {
    for (const noteId of annotation.noteIds) {
      colors.set(noteId, annotation.color);
    }
  }

  const accidentals = new Map<string, string>();
  score.staves.forEach((_, staffIndex) => {
    index.bars.forEach((_bar, barIndex) => {
      const events: SpelledEvent[] = barEvents(index, staffIndex, barIndex).map((indexed) => ({
        offset: indexed.location.offsetInMeasure,
        voiceIndex: indexed.location.voiceIndex,
        notes: index.notesOfEvent(indexed.id).map((note) => ({
          id: note.id,
          pitch: note.pitch,
          tieEnd: note.tie?.end === true,
        })),
      }));
      for (const [noteId, code] of displayedAccidentals(events, fifths)) {
        accidentals.set(noteId, code);
      }
    });
  });

  const harmonyByBar = new Map<string, HarmonyEvent[]>();
  for (const harmony of score.harmony ?? []) {
    const list = harmonyByBar.get(harmony.measureId) ?? [];
    list.push(harmony);
    harmonyByBar.set(harmony.measureId, list);
  }

  const markByEvent = new Map<string, { id: string; marking: DynamicMark }>();
  for (const dynamic of score.dynamics ?? []) {
    if (dynamic.type === 'mark') {
      markByEvent.set(dynamic.eventId, { id: dynamic.id, marking: dynamic.marking });
    }
  }

  const degreeByNote = new Map<string, ScaleDegreeLabel>();
  for (const label of score.scaleDegrees ?? []) {
    degreeByNote.set(label.noteId, label);
  }

  return { score, index, fifths, colors, accidentals, harmonyByBar, markByEvent, degreeByNote };
}

function barEvents(index: ScoreIndex, staffIndex: number, barIndex: number): IndexedEvent[] {
  return index.events.filter(
    (indexed) =>
      indexed.location.staffIndex === staffIndex && indexed.location.measureIndex === barIndex,
  );
}

/** One written note as engraved: a key of a StaveNote. */
export interface NoteGlyph {
  readonly noteId: string;
  readonly note: StaveNote;
  /** Key index inside the StaveNote (chord member order). */
  readonly index: number;
  readonly staffIndex: number;
  readonly measureId: string;
}

/** One event (note, chord or rest) as engraved. */
export interface EventGlyph {
  readonly eventId: string;
  readonly note: StaveNote;
  readonly staffIndex: number;
  readonly onset: Fraction;
}

/** A text drawn at a musical position, anchored by a tickable of a text voice. */
export interface PositionedLabel<T extends Note> {
  /** ID of the harmony event or dynamic it renders. */
  readonly id: string;
  readonly note: T;
}

export interface StaffBarGlyphs {
  readonly staffIndex: number;
  readonly stave: Stave;
  readonly musicVoices: readonly Voice[];
  readonly beams: readonly Beam[];
  /** Tuplets with the side of the staff their number is drawn on. */
  readonly tuplets: readonly { readonly tuplet: Tuplet; readonly below: boolean }[];
  /** Harmony texts in bar order; chord symbols sit on the top staff, Roman numerals on the bottom one. */
  readonly chordSymbols: readonly PositionedLabel<TextNote>[];
  readonly romanNumerals: readonly PositionedLabel<TextNote>[];
  /** Dynamic marks; marks of several voices at one onset get successive rows (0 nearest the staff). */
  readonly dynamics: readonly (PositionedLabel<TextDynamics> & { readonly row: number })[];
  /** Every event of the staff in this bar, by onset. */
  readonly events: readonly EventGlyph[];
}

export interface BarGlyphs {
  readonly barIndex: number;
  readonly measureId: string;
  readonly staves: readonly StaffBarGlyphs[];
  /** Music and text voices of every staff, joined per staff in `formatter`. */
  readonly voices: readonly Voice[];
  readonly formatter: Formatter;
  readonly notes: readonly NoteGlyph[];
}

const TEXT_FONT = 'Academico';
const HARMONY_FONT = { family: TEXT_FONT, size: 12, weight: 'normal', style: 'normal' };
/**
 * Room a chord symbol or Roman numeral keeps after its text (half a staff
 * space): two successive ones of a bar never read as one.
 */
const HARMONY_PADDING = 5;
/** Gap between "Ped." and the release mark of a short pedal span. */
const PEDAL_GAP = 4;
/**
 * Gap a pedal release keeps before the next event of its voice, where the
 * "Ped." of a pedal change starts, or before the bar line.
 */
export const RELEASE_GAP = 3;

/**
 * Width a pedal span's marks take from its start event to the event (or bar
 * line) its release is written before: "Ped.", the gap, the release mark and
 * the gap after it, in the font PedalMarking draws with.
 */
export function pedalMarksWidth(): number {
  const width = (glyph: string | undefined): number =>
    VexElement.measureWidth(glyph ?? '', PedalMarking.CATEGORY);
  return (
    width(PedalMarking.GLYPHS.pedalDepress) +
    PEDAL_GAP +
    width(PedalMarking.GLYPHS.pedalRelease) +
    RELEASE_GAP
  );
}

/** Rest positions (VexFlow keys) per clef: centered alone, apart when voices share a staff. */
const REST_KEYS: Readonly<Record<'treble' | 'bass', readonly string[]>> = {
  treble: ['b/4', 'd/5', 'g/4', 'f/5', 'e/4'],
  bass: ['d/3', 'f/3', 'b/2', 'a/3', 'g/2'],
};

function restKey(clef: 'treble' | 'bass', voiceIndex: number, voiceCount: number): string {
  const keys = REST_KEYS[clef];
  return (voiceCount === 1 ? keys[0] : keys[voiceIndex + 1]) ?? 'b/4';
}

/** Sets a tickable's length to an exact whole-note fraction (built from a whole note). */
function withLength<T extends Note>(note: T, length: Fraction): T {
  const exact = reduce(length);
  note.applyTickMultiplier(exact.numerator, exact.denominator);
  return note;
}

function voiceFor(barLength: Fraction): Voice {
  const length = reduce(barLength);
  return new Voice({ numBeats: length.numerator, beatValue: length.denominator }).setMode(
    Voice.Mode.SOFT,
  );
}

/**
 * A voice holding labels at their bar offsets, padded with invisible notes,
 * so that labels share tick contexts (and horizontal space) with the music.
 * Offsets must be distinct: callers put labels sharing an offset in separate
 * voices.
 */
function positionedVoice<T extends Note>(
  barLength: Fraction,
  items: readonly { readonly id: string; readonly offset: Fraction; readonly make: () => T }[],
  stave: Stave,
): { voice: Voice; placed: PositionedLabel<T>[] } {
  const sorted = [...items].sort((a, b) => compareFractions(a.offset, b.offset));
  const tickables: Note[] = [];
  const placed: PositionedLabel<T>[] = [];
  let cursor = ZERO;
  sorted.forEach((item, position) => {
    if (compareFractions(item.offset, cursor) > 0) {
      tickables.push(ghost(subtractFractions(item.offset, cursor)));
    }
    const end = sorted[position + 1]?.offset ?? barLength;
    const note = withLength(item.make(), subtractFractions(end, item.offset));
    tickables.push(note);
    placed.push({ id: item.id, note });
    cursor = end;
  });
  if (compareFractions(cursor, barLength) < 0) {
    tickables.push(ghost(subtractFractions(barLength, cursor)));
  }
  for (const tickable of tickables) {
    tickable.setStave(stave);
  }
  return { voice: voiceFor(barLength).addTickables(tickables), placed };
}

function ghost(length: Fraction): GhostNote {
  return withLength(new GhostNote({ duration: 'w' }), length);
}

function staveNoteFor(
  event: MusicalEvent,
  clef: 'treble' | 'bass',
  voiceIndex: number,
  voiceCount: number,
): StaveNote {
  const keys =
    event.type === 'rest'
      ? [restKey(clef, voiceIndex, voiceCount)]
      : event.type === 'note'
        ? [vexflowKey(event.pitch)]
        : event.notes.map((member) => vexflowKey(member.pitch));
  const stem =
    voiceCount > 1 ? { stemDirection: voiceIndex === 0 ? Stem.UP : Stem.DOWN } : { autoStem: true };
  const dots = event.duration.dots ?? 0;
  const note = new StaveNote({
    keys,
    duration: VEXFLOW_DURATIONS[event.duration.value],
    dots,
    clef,
    ...(event.type === 'rest' ? { type: 'r' } : {}),
    ...stem,
  });
  for (let dot = 0; dot < dots; dot += 1) {
    Dot.buildAndAttach([note], { all: true });
  }
  return note;
}

/** The written notes of an event with their key index; none for a rest. */
function membersOf(event: MusicalEvent): readonly (Pick<
  Extract<MusicalEvent, { type: 'note' }>,
  'id' | 'fingering' | 'articulations' | 'tie'
> & {
  readonly keyIndex: number;
})[] {
  if (event.type === 'rest') {
    return [];
  }
  if (event.type === 'note') {
    return [{ ...event, keyIndex: 0 }];
  }
  return event.notes.map((member, keyIndex) => ({ ...member, keyIndex }));
}

/**
 * Each articulation of an event once, with the key it is attached to (a
 * modifier takes its key's color). ScoreSpec stores articulations per chord
 * member, but a chord is engraved with one set: an articulation carried by
 * one member stays on that member (and its teaching color); one shared by
 * several members goes on the first of them without a teaching color.
 */
function articulationAnchors(
  event: MusicalEvent,
  colors: ReadonlyMap<string, string>,
): Map<ArticulationName, number> {
  const carriers = new Map<ArticulationName, { id: string; keyIndex: number }[]>();
  for (const member of membersOf(event)) {
    for (const articulation of member.articulations ?? []) {
      carriers.set(articulation, [...(carriers.get(articulation) ?? []), member]);
    }
  }
  const anchors = new Map<ArticulationName, number>();
  for (const [articulation, members] of carriers) {
    const anchor =
      members.length === 1
        ? members[0]
        : (members.find((member) => !colors.has(member.id)) ?? members[0]);
    anchors.set(articulation, anchor?.keyIndex ?? 0);
  }
  return anchors;
}

/**
 * Builds one bar of every staff on `staves` (one Stave per ScoreSpec staff,
 * in order). Staves may be placeholders when only widths are needed. `room`
 * gives the minimum width (px) the onset of some events must take.
 */
export function buildBar(
  prepared: PreparedScore,
  barIndex: number,
  staves: readonly Stave[],
  room: ReadonlyMap<string, number> = new Map(),
): BarGlyphs {
  const { score, index } = prepared;
  const bar = index.bars[barIndex];
  if (bar === undefined) {
    throw new RangeError(`No bar at index ${barIndex}`);
  }
  const meter: TimeSignature = bar.timeSignature;
  const barLength = bar.duration;
  const barStart = bar.start;
  const formatter = new Formatter();
  const allVoices: Voice[] = [];
  const notes: NoteGlyph[] = [];
  const lastStaff = score.staves.length - 1;
  /** Every position of the bar a tickable starts at (events of every staff, harmony labels), in order. */
  const barOnsets = [
    ...index.events
      .filter((indexed) => indexed.location.measureIndex === barIndex)
      .map((indexed) => indexed.location.offsetInMeasure),
    ...(prepared.harmonyByBar.get(bar.id) ?? []).map((harmony) => harmony.offset ?? ZERO),
  ].sort(compareFractions);

  const staffGlyphs = score.staves.map((staff, staffIndex): StaffBarGlyphs => {
    const stave = staves[staffIndex];
    const measure = staff.measures[barIndex];
    if (stave === undefined || measure === undefined) {
      throw new RangeError(`No stave or measure for staff ${staffIndex}, bar ${barIndex}`);
    }
    const staffStave: Stave = stave;
    const clef = staff.clef;
    const voiceCount = measure.voices.length;
    const musicVoices: Voice[] = [];
    const beams: Beam[] = [];
    const tuplets: { tuplet: Tuplet; below: boolean }[] = [];
    const events: EventGlyph[] = [];
    const voiced: {
      readonly event: MusicalEvent;
      readonly note: StaveNote;
      readonly voiceIndex: number;
      readonly onset: Fraction;
    }[] = [];

    measure.voices.forEach((voice, voiceIndex) => {
      const located = voice.events.map((event) => {
        const indexed = index.event(event.id);
        if (indexed === undefined) {
          throw new Error(`Event ${event.id} is not indexed`);
        }
        const note = staveNoteFor(event, clef, voiceIndex, voiceCount);
        note.setStave(stave);
        for (const member of membersOf(event)) {
          const accidental = prepared.accidentals.get(member.id);
          if (accidental !== undefined) {
            note.addModifier(new Accidental(accidental), member.keyIndex);
          }
          const color = prepared.colors.get(member.id);
          if (color !== undefined) {
            note.setKeyStyle(member.keyIndex, { fillStyle: color, strokeStyle: color });
          }
          notes.push({
            noteId: member.id,
            note,
            index: member.keyIndex,
            staffIndex,
            measureId: measure.id,
          });
        }
        events.push({ eventId: event.id, note, staffIndex, onset: indexed.location.onset });
        return { event, indexed, note };
      });

      // Tuplets change the notes' ticks, so they come before the voice.
      const tupletGroups = new Map<string, (typeof located)[number][]>();
      for (const item of located) {
        const groupId = item.event.duration.tuplet?.groupId;
        if (groupId !== undefined) {
          tupletGroups.set(groupId, [...(tupletGroups.get(groupId) ?? []), item]);
        }
      }
      const voiceTuplets = [...tupletGroups.values()].flatMap((members) => {
        const ratio = members[0]?.event.duration.tuplet;
        if (ratio === undefined) {
          return [];
        }
        const tuplet = new Tuplet(
          members.map(({ note }) => note),
          {
            numNotes: ratio.actual,
            notesOccupied: ratio.normal,
            ratioed: false,
            bracketed: !members.every(({ event }) => event.type !== 'rest' && isBeamable(event)),
          },
        );
        return [{ tuplet, first: members[0]?.note }];
      });

      musicVoices.push(voiceFor(bar.duration).addTickables(located.map(({ note }) => note)));

      const candidates: BeamCandidate[] = located.map(({ event, indexed }) => ({
        id: event.id,
        offset: indexed.location.offsetInMeasure,
        value: event.duration.value,
        rest: event.type === 'rest',
        tupletGroupId: event.duration.tuplet?.groupId,
      }));
      const noteById = new Map(located.map(({ event, note }) => [event.id, note]));
      for (const group of beamGroups(candidates, meter)) {
        const beamNotes = group.flatMap((id) => {
          const note = noteById.get(id);
          return note === undefined ? [] : [note];
        });
        beams.push(new Beam(beamNotes, voiceCount === 1));
      }

      // Articulations once stem directions are final (after beams).
      for (const { event, indexed, note } of located) {
        const onHeadSide = note.getStemDirection() === Stem.UP ? 'below' : 'above';
        for (const [articulation, keyIndex] of articulationAnchors(event, prepared.colors)) {
          const position =
            articulation === 'marcato' || onHeadSide === 'above'
              ? Modifier.Position.ABOVE
              : Modifier.Position.BELOW;
          note.addModifier(
            new Articulation(VEXFLOW_ARTICULATIONS[articulation]).setPosition(position),
            keyIndex,
          );
        }
        voiced.push({ event, note, voiceIndex, onset: indexed.location.onset });
      }

      // Tuplet numbers go on the beam/stem side, now that stems are final.
      for (const { tuplet, first } of voiceTuplets) {
        const below = first?.getStemDirection() === Stem.DOWN;
        tuplet.setTupletLocation(below ? -1 : 1);
        tuplets.push({ tuplet, below });
      }
    });

    // Fingerings once every voice of the staff is built. With one voice, a
    // note's goes above on the top staff and below on the others. Where voices
    // share a staff, the first voice's (stems up) goes above and the others'
    // below, away from the other voices' notes; a note on or beyond an outer
    // staff line takes the outer side instead (`fingeringGoesAbove`), unless a
    // slur or tie is drawn there (on the notehead's side). A chord member's
    // goes right of its notehead.
    const linesOf = (note: StaveNote): number[] => note.getKeyProps().map((props) => props.line);
    const curved = (event: MusicalEvent, onset: Fraction): boolean =>
      membersOf(event).some((member) => member.tie !== undefined) ||
      (score.slurs ?? []).some((slur) => {
        const start = index.location(slur.startNoteId);
        const end = index.location(slur.endNoteId);
        return (
          start?.staffIndex === staffIndex &&
          end !== undefined &&
          compareFractions(start.onset, onset) <= 0 &&
          compareFractions(onset, end.onset) <= 0
        );
      });
    for (const { event, note, voiceIndex, onset } of voiced) {
      const preferAbove = voiceCount > 1 ? voiceIndex === 0 : staffIndex === 0;
      const above =
        voiceCount > 1 && !curved(event, onset)
          ? fingeringGoesAbove(
              linesOf(note)[0] ?? 0,
              preferAbove,
              voiced
                .filter(
                  (other) =>
                    other.voiceIndex !== voiceIndex &&
                    other.event.type !== 'rest' &&
                    fractionsEqual(other.onset, onset),
                )
                .flatMap((other) => linesOf(other.note)),
            )
          : preferAbove;
      for (const member of membersOf(event)) {
        if (member.fingering !== undefined) {
          const position =
            event.type === 'chord'
              ? Modifier.Position.RIGHT
              : above
                ? Modifier.Position.ABOVE
                : Modifier.Position.BELOW;
          note.addModifier(
            new FretHandFinger(String(member.fingering)).setPosition(position),
            member.keyIndex,
          );
        }
      }
    }

    events.sort((a, b) => compareFractions(a.onset, b.onset));

    const textVoices: Voice[] = [];
    const harmony = prepared.harmonyByBar.get(measure.id) ?? [];
    let chordSymbols: PositionedLabel<TextNote>[] = [];
    let romanNumerals: PositionedLabel<TextNote>[] = [];
    if (staffIndex === 0) {
      chordSymbols = placeLabels(
        harmony.flatMap((event) =>
          event.chord === undefined
            ? []
            : [{ id: event.id, offset: event.offset ?? ZERO, text: chordSymbolText(event.chord) }],
        ),
      );
    }
    if (staffIndex === lastStaff) {
      romanNumerals = placeLabels(
        harmony.flatMap((event) =>
          event.analysis === undefined
            ? []
            : [{ id: event.id, offset: event.offset ?? ZERO, text: event.analysis.romanNumeral }],
        ),
      );
    }
    function placeLabels(
      labels: readonly { id: string; offset: Fraction; text: string }[],
    ): PositionedLabel<TextNote>[] {
      if (labels.length === 0) {
        return [];
      }
      const { voice, placed } = positionedVoice(
        barLength,
        labels.map((label) => ({
          id: label.id,
          offset: label.offset,
          make: () => {
            const text = new TextNote({ text: label.text, duration: 'w', font: HARMONY_FONT });
            return text.setWidth(text.getTextMetrics().width + HARMONY_PADDING);
          },
        })),
        staffStave,
      );
      textVoices.push(voice);
      return placed;
    }

    // One text voice per row: marks of several voices at one onset (one mark
    // per event is allowed) take successive rows instead of hiding each other.
    const markRows: { id: string; offset: Fraction; marking: DynamicMark }[][] = [];
    for (const { eventId, onset } of events) {
      const mark = prepared.markByEvent.get(eventId);
      if (mark === undefined) {
        continue;
      }
      const offset = subtractFractions(onset, barStart);
      const row = markRows.find((marks) => !marks.some((m) => fractionsEqual(m.offset, offset)));
      const placed = { id: mark.id, offset, marking: mark.marking };
      if (row === undefined) {
        markRows.push([placed]);
      } else {
        row.push(placed);
      }
    }
    const dynamics = markRows.flatMap((marks, row) => {
      const { voice, placed } = positionedVoice(
        bar.duration,
        marks.map((mark) => ({
          id: mark.id,
          offset: mark.offset,
          make: () => new TextDynamics({ text: mark.marking, duration: 'w' }),
        })),
        stave,
      );
      textVoices.push(voice);
      return placed.map((label) => ({ ...label, row }));
    });

    // Minimum widths the layout asked for at some onsets (`room`, by event):
    // an invisible note of that width shares the onset's tick context. It
    // lasts until the next position of the bar, where a zero-width invisible
    // note of the same voice starts: justification never brings a voice's
    // next tickable closer than the width of the one before it, so the room
    // holds at any bar width, not only at the natural one.
    const spacers: { id: string; offset: Fraction; width: number }[] = [];
    for (const { eventId, onset } of events) {
      const width = room.get(eventId);
      if (width === undefined) {
        continue;
      }
      const offset = subtractFractions(onset, barStart);
      const same = spacers.find((spacer) => fractionsEqual(spacer.offset, offset));
      if (same === undefined) {
        spacers.push({ id: eventId, offset, width });
      } else {
        same.width = Math.max(same.width, width);
      }
    }
    if (spacers.length > 0) {
      textVoices.push(
        positionedVoice(
          bar.duration,
          spacers.flatMap(({ id, offset, width }) => {
            const spacer = {
              id,
              offset,
              make: () => new GhostNote({ duration: 'w' }).setWidth(width),
            };
            const next = barOnsets.find((position) => compareFractions(position, offset) > 0);
            return next === undefined || spacers.some((other) => fractionsEqual(other.offset, next))
              ? [spacer]
              : [
                  spacer,
                  { id: `${id}:end`, offset: next, make: () => new GhostNote({ duration: 'w' }) },
                ];
          }),
          stave,
        ).voice,
      );
    }

    formatter.joinVoices([...musicVoices, ...textVoices]);
    allVoices.push(...musicVoices, ...textVoices);
    return {
      staffIndex,
      stave,
      musicVoices,
      beams,
      tuplets,
      chordSymbols,
      romanNumerals,
      dynamics,
      events,
    };
  });

  return {
    barIndex,
    measureId: bar.id,
    staves: staffGlyphs,
    voices: allVoices,
    formatter,
    notes,
  };
}

function isBeamable(event: MusicalEvent): boolean {
  return ['eighth', 'sixteenth', 'thirtySecond'].includes(event.duration.value);
}
