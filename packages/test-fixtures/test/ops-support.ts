/**
 * Helpers shared by the OPS-01..06 tests (issue #3). They only build commands,
 * read results and edit JSON copies for expected values; the behavior under
 * test is always the real applyScoreEdit from @sheet-music/music-domain.
 */
import {
  type DomainError,
  type Result,
  type ScoreSpec,
  type ScoreSpecInput,
  applyScoreEdit,
} from '@sheet-music/music-domain';
import { cloneFixture, frozen, pitch } from '../src/builders';

/** Applies `operations` at the score's current revision; the command is deep-frozen first. */
export function edit(
  score: ScoreSpec,
  operations: readonly unknown[],
  expectedRevision: number = score.revision,
): Result<ScoreSpec> {
  return applyScoreEdit(score, frozen(cloneFixture({ expectedRevision, operations })));
}

/** The new score of an edit that must succeed. */
export function edited(score: ScoreSpec, operations: readonly unknown[]): ScoreSpec {
  const result = edit(score, operations);
  if (!result.ok) {
    throw new Error(`Expected the edit to succeed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** The error of an edit that must fail. */
export function editError(
  score: ScoreSpec,
  operations: readonly unknown[],
  expectedRevision: number = score.revision,
): DomainError {
  const result = edit(score, operations, expectedRevision);
  if (result.ok) {
    throw new Error('Expected the edit to be rejected, but it was applied.');
  }
  return result.error;
}

/** A mutable JSON copy of a canonical score, for writing expected results by hand. */
export function copyOf(score: ScoreSpec): ScoreSpecInput {
  return JSON.parse(JSON.stringify(score)) as ScoreSpecInput;
}

/** `score` changed by `change`, one revision later: the independent expected result of an edit. */
export function expectedAfter(
  score: ScoreSpec,
  change: (draft: ScoreSpecInput) => void,
): ScoreSpecInput {
  const draft = copyOf(score);
  change(draft);
  draft.revision = score.revision + 1;
  return draft;
}

/** Sets the written pitch of the listed notes/chord members of a JSON copy ("F#4" notation). */
export function setPitches(draft: ScoreSpecInput, spelled: Readonly<Record<string, string>>): void {
  const pending = new Set(Object.keys(spelled));
  for (const staff of draft.staves) {
    for (const measure of staff.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          const notes = event.type === 'note' ? [event] : event.type === 'chord' ? event.notes : [];
          for (const target of notes) {
            const value = spelled[target.id];
            if (value !== undefined) {
              target.pitch = pitch(value);
              pending.delete(target.id);
            }
          }
        }
      }
    }
  }
  if (pending.size > 0) {
    throw new Error(`No note with the IDs ${[...pending].join(', ')}`);
  }
}

/** Written spelling of every note of a staff, in order ("F#4"; chords as "C4+E4+G4"). */
export function spellings(score: ScoreSpec | ScoreSpecInput, staffIndex = 0): string[] {
  const accidentals: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' };
  const name = (pitch: { step: string; alter: number; octave: number }): string =>
    `${pitch.step}${accidentals[pitch.alter] ?? '?'}${pitch.octave}`;
  const staff = score.staves[staffIndex];
  if (staff === undefined) {
    throw new Error(`No staff ${staffIndex}`);
  }
  return staff.measures.flatMap((measure) =>
    measure.voices.flatMap((voice) =>
      voice.events.flatMap((event) => {
        if (event.type === 'note') {
          return [name(event.pitch)];
        }
        if (event.type === 'chord') {
          return [event.notes.map((member) => name(member.pitch)).join('+')];
        }
        return [];
      }),
    ),
  );
}
