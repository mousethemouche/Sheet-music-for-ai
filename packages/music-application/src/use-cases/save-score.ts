/**
 * SaveScore (issue #10, ADR-006, APPLICATION_LAYER.md §5.3): the explicit
 * action that puts the owner's live draft into the permanent library, through
 * the atomic promotion port. Same ID, same revision, confirmed title and tags.
 *
 * Replay of a save on a score that is already saved:
 * - same revision, title and tags as stored -> success, outcome "already_saved",
 *   nothing written;
 * - anything else -> ALREADY_SAVED, nothing written.
 * A save never creates a second library entry and never overwrites one.
 */
import {
  type SaveScoreCommand,
  type SaveScoreOutput,
  saveScoreInputSchema,
} from '@sheet-music/music-contracts';
import {
  type AppResult,
  alreadySaved,
  concurrentChange,
  fail,
  notFound,
  ok,
  revisionMismatch,
} from '../errors';
import type { DraftExpiryPolicy } from '../expiry-policy';
import type {
  AuthenticatedPrincipal,
  Clock,
  SavedScore,
  SavedScoreRepository,
  ScoreDraftRepository,
  ScorePromotion,
} from '../ports';
import { fromStore, parseInput, requireOwner, savedArtifact } from '../shared';

export interface SaveScoreDependencies {
  readonly drafts: ScoreDraftRepository;
  readonly saved: SavedScoreRepository;
  readonly promotion: ScorePromotion;
  readonly clock: Clock;
  readonly expiry: DraftExpiryPolicy;
}

export class SaveScore {
  constructor(private readonly deps: SaveScoreDependencies) {}

  /**
   * `input` is the save_score input `{ scoreId, expectedRevision, title, tags? }`
   * (untrusted). Calling this use case IS the save request: the transport must
   * only call it for a save the human approved.
   */
  async execute(
    principal: AuthenticatedPrincipal | null | undefined,
    input: unknown,
  ): Promise<AppResult<SaveScoreOutput>> {
    const owner = requireOwner(principal);
    if (!owner.ok) {
      return owner;
    }
    const parsed = parseInput(saveScoreInputSchema, input);
    if (!parsed.ok) {
      return parsed;
    }
    const command = parsed.value;
    const now = this.deps.clock.now();

    const existing = await fromStore(() => this.deps.saved.get(owner.value, command.scoreId));
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== null) {
      return replay(existing.value, command);
    }

    const draft = await fromStore(() => this.deps.drafts.get(owner.value, command.scoreId));
    if (!draft.ok) {
      return draft;
    }
    if (draft.value === null || this.deps.expiry.isExpired(draft.value.expiresAt, now)) {
      return fail(notFound());
    }
    if (draft.value.spec.revision !== command.expectedRevision) {
      return fail(
        revisionMismatch(command.scoreId, draft.value.spec.revision, command.expectedRevision),
      );
    }

    const promoted = await fromStore(() =>
      this.deps.promotion.promote(owner.value, {
        id: command.scoreId,
        expectedRevision: command.expectedRevision,
        title: command.title,
        tags: command.tags,
        now,
      }),
    );
    if (!promoted.ok) {
      return promoted;
    }
    if (promoted.value.status === 'promoted') {
      return ok({ outcome: 'saved', artifact: savedArtifact(promoted.value.saved) });
    }

    // The draft changed or disappeared after it was read; a concurrent save may have won.
    const after = await fromStore(() => this.deps.saved.get(owner.value, command.scoreId));
    if (!after.ok) {
      return after;
    }
    return after.value === null
      ? fail(concurrentChange(command.scoreId))
      : replay(after.value, command);
  }
}

function replay(saved: SavedScore, command: SaveScoreCommand): AppResult<SaveScoreOutput> {
  const identical =
    saved.spec.revision === command.expectedRevision &&
    saved.title === command.title &&
    saved.tags.length === command.tags.length &&
    saved.tags.every((tag, index) => tag === command.tags[index]);
  return identical
    ? ok({ outcome: 'already_saved', artifact: savedArtifact(saved) })
    : fail(alreadySaved(saved.spec.revision));
}
