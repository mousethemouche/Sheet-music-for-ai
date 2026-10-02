/**
 * Neutral playback compiler (issue #6, PLAYBACK_POLICY_V1.md): canonical
 * ScoreSpec -> PlaybackPlan. Pure and deterministic: the same score always
 * gives a deep-equal plan (no randomness, no clock).
 */
import {
  type NoteTarget,
  type ScoreIndex,
  type ScoreSpec,
  buildScoreIndex,
  writtenPitchToKey,
} from '@sheet-music/music-domain';
import {
  EXPRESSION_POLICY_VERSION,
  articulationsOf,
  gatedTicks,
  slurredNoteIds,
  staffDynamics,
  velocityOf,
} from './expression';
import {
  type ActiveNoteIdsQuery,
  type HighlightSpan,
  type PlaybackCompiler,
  type PlaybackEvent,
  type SustainPedalEvent,
  PPQ,
} from './plan';
import { performedTimeline } from './timeline';

interface MutableEvent {
  noteId: string;
  tiedNoteIds: readonly string[];
  startTick: number;
  durationTicks: number;
  midiNote: number;
  velocity: number;
}

/** Tie chains in document order of their first note: one sound each. */
function tieChains(notes: readonly NoteTarget[], ties: ScoreIndex['ties']): NoteTarget[][] {
  const next = new Map<string, NoteTarget>();
  const continuations = new Set<string>();
  for (const pair of ties) {
    next.set(pair.from.id, pair.to);
    continuations.add(pair.to.id);
  }
  const chains: NoteTarget[][] = [];
  for (const note of notes) {
    if (continuations.has(note.id)) {
      continue;
    }
    const chain = [note];
    for (let current = next.get(note.id); current !== undefined; current = next.get(current.id)) {
      chain.push(current);
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * One key never overlaps itself (PLAYBACK_POLICY_V1.md §5): a sound ends at
 * the next attack of its key; two sounds of one key attacked at the same tick
 * (a unison between voices or staves) merge into the first in document order,
 * with the longer duration and the higher velocity.
 */
function separateKeys(sorted: readonly MutableEvent[]): MutableEvent[] {
  const result: MutableEvent[] = [];
  const lastByKey = new Map<number, MutableEvent>();
  for (const event of sorted) {
    const previous = lastByKey.get(event.midiNote);
    if (previous !== undefined && previous.startTick === event.startTick) {
      previous.durationTicks = Math.max(previous.durationTicks, event.durationTicks);
      previous.velocity = Math.max(previous.velocity, event.velocity);
      continue;
    }
    if (previous !== undefined && previous.startTick + previous.durationTicks > event.startTick) {
      previous.durationTicks = event.startTick - previous.startTick;
    }
    result.push(event);
    lastByKey.set(event.midiNote, event);
  }
  return result;
}

export const compilePlaybackPlan: PlaybackCompiler = (score: ScoreSpec) => {
  const index = buildScoreIndex(score);
  const timeline = performedTimeline(index, score.playbackFeel);
  const dynamicLevel = staffDynamics(score, index);
  const slurred = slurredNoteIds(score, index);
  const spanOf = (note: NoteTarget) => {
    const event = index.event(note.eventId);
    return event === undefined ? { startTick: 0, endTick: 0 } : timeline.eventSpan(event);
  };

  const sounds = tieChains(index.noteTargets, index.ties).map<MutableEvent>((chain) => {
    const first = chain[0] as NoteTarget;
    const last = chain.at(-1) as NoteTarget;
    const startTick = spanOf(first).startTick;
    const lastSpan = spanOf(last);
    const release = gatedTicks(
      lastSpan.endTick - lastSpan.startTick,
      articulationsOf(index, last),
      slurred.has(last.id),
    );
    return {
      noteId: first.id,
      tiedNoteIds: chain.slice(1).map((note) => note.id),
      startTick,
      durationTicks: lastSpan.startTick - startTick + release,
      midiNote: writtenPitchToKey(first.pitch),
      velocity: velocityOf(
        dynamicLevel(first.location.staffIndex, first.location.onset),
        articulationsOf(index, first),
      ),
    };
  });
  // Stable sort: equal start ticks keep document order.
  const events: PlaybackEvent[] = separateKeys(
    sounds.toSorted((a, b) => a.startTick - b.startTick),
  ).map((event) => ({ ...event }));

  const highlights: HighlightSpan[] = index.noteTargets
    .map((note) => ({ noteId: note.id, ...spanOf(note) }))
    .toSorted((a, b) => a.startTick - b.startTick);

  const pedal: SustainPedalEvent[] = (score.pedal ?? [])
    .flatMap((span): SustainPedalEvent[] => {
      const start = index.event(span.startEventId);
      const end = index.event(span.endEventId);
      if (start === undefined || end === undefined) {
        return [];
      }
      return [
        { pedalId: span.id, tick: timeline.eventSpan(start).startTick, type: 'down' },
        { pedalId: span.id, tick: timeline.eventSpan(end).endTick, type: 'up' },
      ];
    })
    .toSorted((a, b) => a.tick - b.tick || (a.type === b.type ? 0 : a.type === 'up' ? -1 : 1));

  return {
    scoreId: score.id,
    revision: score.revision,
    ppq: PPQ,
    bpm: score.tempo.bpm,
    totalTicks: timeline.totalTicks,
    expressionPolicyVersion: EXPRESSION_POLICY_VERSION,
    events,
    pedal,
    highlights,
  };
};

export const activeNoteIds: ActiveNoteIdsQuery = (plan, tick) => {
  if (!(tick >= 0 && tick < plan.totalTicks)) {
    return [];
  }
  const ids: string[] = [];
  for (const span of plan.highlights) {
    if (span.startTick > tick) {
      break;
    }
    if (tick < span.endTick) {
      ids.push(span.noteId);
    }
  }
  return ids;
};
