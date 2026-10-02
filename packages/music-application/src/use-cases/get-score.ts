/**
 * GetScore and GetSavedScore (issue #10, APPLICATION_LAYER.md §5.4): private,
 * read-only retrieval. Reads never write, so they never renew a draft's TTL.
 */
import {
  type GetScoreOutput,
  type SavedArtifact,
  getScoreInputSchema,
} from '@sheet-music/music-contracts';
import { type AppResult, fail, notFound, ok } from '../errors';
import type { DraftExpiryPolicy } from '../expiry-policy';
import type {
  AuthenticatedPrincipal,
  Clock,
  SavedScoreRepository,
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

export interface GetScoreDependencies {
  readonly drafts: ScoreDraftRepository;
  readonly saved: SavedScoreRepository;
  readonly clock: Clock;
  readonly expiry: DraftExpiryPolicy;
}

/** The owner's saved score or live draft (get_score). */
export class GetScore {
  constructor(private readonly deps: GetScoreDependencies) {}

  /** `input` is the get_score input `{ scoreId }` (untrusted). */
  async execute(
    principal: AuthenticatedPrincipal | null | undefined,
    input: unknown,
  ): Promise<AppResult<GetScoreOutput>> {
    const owner = requireOwner(principal);
    if (!owner.ok) {
      return owner;
    }
    const query = parseInput(getScoreInputSchema, input);
    if (!query.ok) {
      return query;
    }
    const resolved = await resolveArtifact(
      this.deps,
      owner.value,
      query.value.scoreId,
      this.deps.clock.now(),
    );
    if (!resolved.ok) {
      return resolved;
    }
    return ok({
      artifact:
        resolved.value.state === 'saved'
          ? savedArtifact(resolved.value.saved)
          : draftArtifact(resolved.value.draft),
    });
  }
}

export interface GetSavedScoreDependencies {
  readonly saved: SavedScoreRepository;
}

/** The owner's saved score only; drafts are NOT_FOUND (GET /scores/:id). */
export class GetSavedScore {
  constructor(private readonly deps: GetSavedScoreDependencies) {}

  /** `input` is `{ scoreId }` (untrusted). */
  async execute(
    principal: AuthenticatedPrincipal | null | undefined,
    input: unknown,
  ): Promise<AppResult<{ readonly artifact: SavedArtifact }>> {
    const owner = requireOwner(principal);
    if (!owner.ok) {
      return owner;
    }
    const query = parseInput(getScoreInputSchema, input);
    if (!query.ok) {
      return query;
    }
    const saved = await fromStore(() => this.deps.saved.get(owner.value, query.value.scoreId));
    if (!saved.ok) {
      return saved;
    }
    return saved.value === null ? fail(notFound()) : ok({ artifact: savedArtifact(saved.value) });
  }
}
