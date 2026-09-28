/**
 * CreateScore (issue #8, APPLICATION_LAYER.md §5.1): validates a new score and
 * stores it as the owner's DRAFT. Never writes to the permanent library.
 */
import { type CreateScoreOutput, createScoreInputSchema } from '@sheet-music/music-contracts';
import { ID_PATTERN, validateScoreSpec } from '@sheet-music/music-domain';
import { type AppResult, applicationError, fail, fromDomainError, ok } from '../errors';
import type { DraftExpiryPolicy } from '../expiry-policy';
import type {
  AuthenticatedPrincipal,
  Clock,
  IdGenerator,
  ScoreDraft,
  ScoreDraftRepository,
} from '../ports';
import { draftArtifact, fromStore, parseInput, requireOwner } from '../shared';

/** Revision of a newly created score. */
export const INITIAL_REVISION = 1;

export interface CreateScoreDependencies {
  readonly drafts: ScoreDraftRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly expiry: DraftExpiryPolicy;
}

export class CreateScore {
  constructor(private readonly deps: CreateScoreDependencies) {}

  /**
   * `input` is the create_score input `{ score }` (untrusted). The score ID and
   * revision 1 are assigned here; every inner ID is kept as given. Validation
   * errors point into the request (`["score", ...]`).
   */
  async execute(
    principal: AuthenticatedPrincipal | null | undefined,
    input: unknown,
  ): Promise<AppResult<CreateScoreOutput>> {
    const owner = requireOwner(principal);
    if (!owner.ok) {
      return owner;
    }
    const command = parseInput(createScoreInputSchema, input);
    if (!command.ok) {
      return command;
    }
    const id = this.deps.ids.newScoreId();
    if (!ID_PATTERN.test(id)) {
      return fail(applicationError('INTERNAL'));
    }
    const validated = validateScoreSpec({ ...command.value.score, id, revision: INITIAL_REVISION });
    if (!validated.ok) {
      return fail(fromDomainError(validated.error, ['score']));
    }
    const now = this.deps.clock.now();
    const draft: ScoreDraft = {
      spec: validated.value,
      createdAt: now,
      updatedAt: now,
      expiresAt: this.deps.expiry.expiresAt(now),
    };
    const stored = await fromStore(() => this.deps.drafts.create(owner.value, draft));
    if (!stored.ok) {
      return stored;
    }
    return ok({ artifact: draftArtifact(draft) });
  }
}
