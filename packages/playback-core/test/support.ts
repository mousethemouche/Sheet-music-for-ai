/**
 * Helpers for the AUDIO-01..05 compiler tests: they compile fixtures with the
 * real compiler and look results up by written-note ID. Expected numbers
 * always come from the test itself or the fixture oracles, never from here.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import { parseFixture } from '@sheet-music/test-fixtures';
import {
  type HighlightSpan,
  type PlaybackEvent,
  type PlaybackPlan,
  compilePlaybackPlan,
} from '../src';

export function compile(input: ScoreSpecInput): PlaybackPlan {
  return compilePlaybackPlan(parseFixture(input));
}

/** The sound attacked by written note `noteId` (a tie chain is found by its first note). */
export function soundOf(plan: PlaybackPlan, noteId: string): PlaybackEvent {
  const event = plan.events.find((candidate) => candidate.noteId === noteId);
  if (event === undefined) {
    throw new Error(`No playback event attacked by ${noteId}`);
  }
  return event;
}

export function spanOf(plan: PlaybackPlan, noteId: string): HighlightSpan {
  const span = plan.highlights.find((candidate) => candidate.noteId === noteId);
  if (span === undefined) {
    throw new Error(`No highlight span for ${noteId}`);
  }
  return span;
}

export const starts = (plan: PlaybackPlan, noteIds: readonly string[]): number[] =>
  noteIds.map((id) => spanOf(plan, id).startTick);
