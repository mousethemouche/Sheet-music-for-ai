/**
 * EditScore (ADR-002, issue #13, APPLICATION_LAYER.md §5.2): applies typed
 * ScoreOperations to the owner's live draft or saved score and persists the
 * result with compare-and-swap. Only a successful edit renews a draft's TTL.
 */
import { type EditScoreOutput, editScoreInputSchema } from '@sheet-music/music-contracts';
import { applyScoreEdit } from '@sheet-music/music-domain';
import { type AppResult, concurrentChange, fail, fromDomainError, ok } from '../errors';
import type { DraftExpiryPolicy } from '../expiry-policy';
import type {
  AuthenticatedPrincipal,
  Clock,
  SavedScore,
  SavedScoreRepository,
  ScoreDraft,
  ScoreDraftRepository,
} from '../ports';
import {
  draftArtifact,
  fromStore,
  parseInput,
  requireOwner,
  resolveArtifact,
  savedArtifact,
} from '../shared';

export interface EditScoreDependencies {
  readonly drafts: ScoreDraftRepository;
  readonly saved: SavedScoreRepository;
  readonly clock: Clock;
  readonly expiry: DraftExpiryPolicy;
}

export class EditScore {
  constructor(private readonly deps: EditScoreDependencies) {}

  /** `input` is the edit_score input `{ scoreId, expectedRevision, operations }` (untrusted). */
  async execute(
    principal: AuthenticatedPrincipal | null | undefined,
    input: unknown,
  ): Promise<AppResult<EditScoreOutput>> {
    const owner = requireOwner(principal);
    if (!owner.ok) {
      return owner;
    }
    const command = parseInput(editScoreInputSchema, input);
    if (!command.ok) {
      return command;
    }
    const { scoreId, expectedRevision, operations } = command.value;
    const now = this.deps.clock.now();
    const resolved = await resolveArtifact(this.deps, owner.value, scoreId, now);
    if (!resolved.ok) {
      return resolved;
    }
    const current = resolved.value.state === 'saved' ? resolved.value.saved : resolved.value.draft;
    const edited = applyScoreEdit(current.spec, { expectedRevision, operations });
    if (!edited.ok) {
      return fail(fromDomainError(edited.error));
    }

    if (resolved.value.state === 'draft') {
      const draft: ScoreDraft = {
        ...resolved.value.draft,
        spec: edited.value,
        updatedAt: now,
        expiresAt: this.deps.expiry.expiresAt(now),
      };
      const written = await fromStore(() =>
        this.deps.drafts.update(owner.value, draft, current.spec.revision),
      );
      if (!written.ok) {
        return written;
      }
      return written.value === 'updated'
        ? ok({ artifact: draftArtifact(draft) })
        : fail(concurrentChange(scoreId));
    }

    const saved: SavedScore = { ...resolved.value.saved, spec: edited.value, updatedAt: now };
    const written = await fromStore(() =>
      this.deps.saved.update(owner.value, saved, current.spec.revision),
    );
    if (!written.ok) {
      return written;
    }
    return written.value === 'updated'
      ? ok({ artifact: savedArtifact(saved) })
      : fail(concurrentChange(scoreId));
  }
}
