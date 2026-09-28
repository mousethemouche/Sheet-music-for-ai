/**
 * Global score operations: tempo, meter, key, tonal context, feel, title and
 * tags. They set score-level fields only and never rewrite notes, durations or
 * local bar meters; whether the music still fits is decided by the final
 * validation of the whole edit.
 */
import { type HandlerResult, type ScoreDraft, cloneJson } from './draft';
import type { ScoreOperation } from './schema';

type Op<T extends ScoreOperation['type']> = Extract<ScoreOperation, { type: T }>;

export function setTempo(draft: ScoreDraft, operation: Op<'set_tempo'>): HandlerResult {
  draft.tempo = { bpm: operation.bpm };
  return undefined;
}

export function setTimeSignature(
  draft: ScoreDraft,
  operation: Op<'set_time_signature'>,
): HandlerResult {
  draft.timeSignature = { numerator: operation.numerator, denominator: operation.denominator };
  return undefined;
}

export function setKeySignature(
  draft: ScoreDraft,
  operation: Op<'set_key_signature'>,
): HandlerResult {
  if (operation.keySignature === null) {
    delete draft.keySignature;
  } else {
    draft.keySignature = cloneJson(operation.keySignature);
  }
  return undefined;
}

export function setTonalContext(
  draft: ScoreDraft,
  operation: Op<'set_tonal_context'>,
): HandlerResult {
  if (operation.tonalContext === null) {
    delete draft.tonalContext;
  } else {
    draft.tonalContext = cloneJson(operation.tonalContext);
  }
  return undefined;
}

export function setPlaybackFeel(
  draft: ScoreDraft,
  operation: Op<'set_playback_feel'>,
): HandlerResult {
  if (operation.playbackFeel === null) {
    delete draft.playbackFeel;
  } else {
    draft.playbackFeel = cloneJson(operation.playbackFeel);
  }
  return undefined;
}

export function setTitle(draft: ScoreDraft, operation: Op<'set_title'>): HandlerResult {
  if (operation.title === null) {
    delete draft.metadata.title;
  } else {
    draft.metadata.title = operation.title;
  }
  return undefined;
}

export function setTags(draft: ScoreDraft, operation: Op<'set_tags'>): HandlerResult {
  if (operation.tags.length === 0) {
    delete draft.metadata.tags;
  } else {
    draft.metadata.tags = [...operation.tags];
  }
  return undefined;
}
