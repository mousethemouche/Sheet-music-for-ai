/**
 * Test doubles for #6's pure functions, written from the contract
 * (RENDER_PLAYBACK_PORTS.md §3), not from #6's code: straight rhythm only,
 * no articulation gate, no ties or tuplets (the fixtures used here have none),
 * constant velocity. They exist so the player can be tested before #6 lands;
 * they prove nothing about #6's timing or expression.
 */
import type { MusicalEvent, Pitch, ScoreSpec } from '@sheet-music/music-domain';
import {
  type ActiveNoteIdsQuery,
  type HighlightSpan,
  type PlaybackCompiler,
  type PlaybackEvent,
  type SustainPedalEvent,
  PPQ,
} from '@sheet-music/playback-core';

const VALUE_TICKS = {
  whole: 4 * PPQ,
  half: 2 * PPQ,
  quarter: PPQ,
  eighth: PPQ / 2,
  sixteenth: PPQ / 4,
  thirtySecond: PPQ / 8,
} as const;

const DOT_FACTOR = [1, 1.5, 1.75] as const;

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;

function eventTicks(event: MusicalEvent): number {
  if (event.duration.tuplet !== undefined) {
    throw new Error('fake compiler: tuplets are not supported');
  }
  return VALUE_TICKS[event.duration.value] * DOT_FACTOR[event.duration.dots ?? 0];
}

function midiNote(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + STEP_SEMITONES[pitch.step] + pitch.alter;
}

function writtenNotes(event: MusicalEvent): readonly { id: string; pitch: Pitch }[] {
  if (event.type === 'note') {
    return [{ id: event.id, pitch: event.pitch }];
  }
  return event.type === 'chord' ? event.notes : [];
}

export const compileFakePlan: PlaybackCompiler = (score: ScoreSpec) => {
  const events: PlaybackEvent[] = [];
  const highlights: HighlightSpan[] = [];
  const spans = new Map<string, { start: number; end: number }>();
  let totalTicks = 0;
  score.staves.forEach((staff, staffIndex) => {
    let barStart = 0;
    for (const measure of staff.measures) {
      let barLength = 0;
      for (const voice of measure.voices) {
        let cursor = barStart;
        for (const event of voice.events) {
          const length = eventTicks(event);
          spans.set(event.id, { start: cursor, end: cursor + length });
          for (const note of writtenNotes(event)) {
            events.push({
              noteId: note.id,
              tiedNoteIds: [],
              startTick: cursor,
              durationTicks: length,
              midiNote: midiNote(note.pitch),
              velocity: 80,
            });
            highlights.push({ noteId: note.id, startTick: cursor, endTick: cursor + length });
          }
          cursor += length;
        }
        barLength = Math.max(barLength, cursor - barStart);
      }
      barStart += barLength;
    }
    if (staffIndex === 0) {
      totalTicks = barStart;
    }
  });
  const pedal = (score.pedal ?? []).flatMap((span): SustainPedalEvent[] => [
    { pedalId: span.id, tick: spans.get(span.startEventId)?.start ?? 0, type: 'down' },
    { pedalId: span.id, tick: spans.get(span.endEventId)?.end ?? 0, type: 'up' },
  ]);
  return {
    scoreId: score.id,
    revision: score.revision,
    ppq: PPQ,
    bpm: score.tempo.bpm,
    totalTicks,
    expressionPolicyVersion: 0,
    events: events.sort((a, b) => a.startTick - b.startTick),
    pedal: pedal.sort((a, b) => a.tick - b.tick || (a.type === 'up' ? -1 : 1)),
    highlights: highlights.sort((a, b) => a.startTick - b.startTick),
  };
};

/** §3.4: half-open spans, `[]` outside [0, totalTicks). */
export const fakeActiveNoteIds: ActiveNoteIdsQuery = (plan, tick) =>
  tick < 0 || tick >= plan.totalTicks
    ? []
    : plan.highlights
        .filter((span) => span.startTick <= tick && tick < span.endTick)
        .map((span) => span.noteId);
