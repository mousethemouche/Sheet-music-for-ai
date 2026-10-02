/**
 * Steps shared by the use cases: trusted owner, input parsing, guarded store
 * calls, artifact resolution and DTO mapping (APPLICATION_LAYER.md §4-§5).
 */
import type { DraftArtifact, SavedArtifact, ScoreSummary } from '@sheet-music/music-contracts';
import type { z } from 'zod';
import type { DraftExpiryPolicy } from './expiry-policy';
import {
  type AppResult,
  applicationError,
  fail,
  invalidInput,
  notFound,
  ok,
  unauthenticated,
} from './errors';
import {
  type AuthenticatedPrincipal,
  type SavedScore,
  type SavedScoreRepository,
  type SavedScoreSummary,
  type ScoreDraft,
  type ScoreDraftRepository,
  type ScoreId,
  type UserId,
  StoredScoreUnreadableError,
} from './ports';

/** The owner of every repository call: the principal from the trusted request context. */
export function requireOwner(
  principal: AuthenticatedPrincipal | null | undefined,
): AppResult<UserId> {
  if (
    principal === null ||
    typeof principal !== 'object' ||
    typeof principal.userId !== 'string' ||
    principal.userId.trim() === ''
  ) {
    return fail(unauthenticated());
  }
  return ok(principal.userId);
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): AppResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  return parsed.success ? ok(parsed.data) : fail(invalidInput(parsed.error));
}

/**
 * Runs one port call. A rejection becomes DEPENDENCY_UNAVAILABLE (INTERNAL for
 * an unreadable stored score); there is no fallback and no partial success.
 */
export async function fromStore<T>(call: () => Promise<T>): Promise<AppResult<T>> {
  try {
    return ok(await call());
  } catch (error) {
    return fail(
      error instanceof StoredScoreUnreadableError
        ? applicationError('INTERNAL', [], error.message, error)
        : applicationError('DEPENDENCY_UNAVAILABLE', [], undefined, error),
    );
  }
}

export type ResolvedArtifact =
  | { readonly state: 'saved'; readonly saved: SavedScore }
  | { readonly state: 'draft'; readonly draft: ScoreDraft };

export interface ArtifactStores {
  readonly drafts: ScoreDraftRepository;
  readonly saved: SavedScoreRepository;
  readonly expiry: DraftExpiryPolicy;
}

/**
 * Resolves a score ID for its owner: the saved score if there is one,
 * otherwise the draft if it is live at `now`, otherwise NOT_FOUND (missing,
 * foreign and expired look the same). If a saved score and a draft share the
 * ID (promotion removes the draft, so this means an adapter fault), the saved
 * score wins and the draft is ignored until it expires.
 */
export async function resolveArtifact(
  stores: ArtifactStores,
  owner: UserId,
  id: ScoreId,
  now: Date,
): Promise<AppResult<ResolvedArtifact>> {
  const saved = await fromStore(() => stores.saved.get(owner, id));
  if (!saved.ok) {
    return saved;
  }
  if (saved.value !== null) {
    return ok({ state: 'saved', saved: saved.value });
  }
  const draft = await fromStore(() => stores.drafts.get(owner, id));
  if (!draft.ok) {
    return draft;
  }
  if (draft.value === null || stores.expiry.isExpired(draft.value.expiresAt, now)) {
    return fail(notFound());
  }
  return ok({ state: 'draft', draft: draft.value });
}

export function draftArtifact(draft: ScoreDraft): DraftArtifact {
  return {
    state: 'draft',
    scoreId: draft.spec.id,
    revision: draft.spec.revision,
    score: draft.spec,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    expiresAt: draft.expiresAt.toISOString(),
  };
}

export function savedArtifact(saved: SavedScore): SavedArtifact {
  return {
    state: 'saved',
    scoreId: saved.spec.id,
    revision: saved.spec.revision,
    score: saved.spec,
    title: saved.title,
    tags: [...saved.tags],
    createdAt: saved.createdAt.toISOString(),
    updatedAt: saved.updatedAt.toISOString(),
  };
}

export function scoreSummary(summary: SavedScoreSummary): ScoreSummary {
  return {
    scoreId: summary.id,
    title: summary.title,
    tags: [...summary.tags],
    revision: summary.revision,
    createdAt: summary.createdAt.toISOString(),
    updatedAt: summary.updatedAt.toISOString(),
  };
}
