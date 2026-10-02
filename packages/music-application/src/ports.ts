/**
 * Neutral ports of the application layer (ADR-005, ADR-006,
 * APPLICATION_LAYER.md §3). Adapters implement them with Postgres/Supabase,
 * JWT verification or system time; no provider type appears here.
 *
 * Conventions for every repository and promotion port:
 * - every call receives the authenticated owner and only sees that owner's rows;
 *   another owner's row behaves exactly like a missing one;
 * - expected outcomes (missing row, lost compare-and-swap) are return values;
 * - an infrastructure failure rejects the promise. The use cases turn any
 *   rejection into DEPENDENCY_UNAVAILABLE, or INTERNAL for
 *   StoredScoreUnreadableError, and never fall back to memory or to an empty
 *   result.
 */
import type { ScoreSpec } from '@sheet-music/music-domain';

/** Stable identity of an authenticated user, taken from the verified token subject. */
export type UserId = string;

/** The trusted identity of the caller, built by an inbound auth adapter; never read from a payload. */
export interface AuthenticatedPrincipal {
  readonly userId: UserId;
}

/** A score ID (the ScoreSpec ID pattern). Drafts and saved scores share one ID space. */
export type ScoreId = string;

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** A new, unique score ID matching the ScoreSpec ID pattern (for example "scr_" + UUID). */
  newScoreId(): ScoreId;
}

/** A temporary, owner-private score (ADR-006). Its ID and revision are `spec.id` and `spec.revision`. */
export interface ScoreDraft {
  readonly spec: ScoreSpec;
  readonly createdAt: Date;
  /** Time of the latest successful write (creation or edit). */
  readonly updatedAt: Date;
  /** From the DraftExpiryPolicy at the latest successful write; the draft is dead from this instant. */
  readonly expiresAt: Date;
}

/** A score in the permanent library. Title and tags are library metadata, not part of `spec`. */
export interface SavedScore {
  readonly spec: ScoreSpec;
  readonly title: string;
  readonly tags: readonly string[];
  /** When the score entered the library (promotion time). */
  readonly createdAt: Date;
  /** Time of the latest successful write (promotion or edit). */
  readonly updatedAt: Date;
}

export interface SavedScoreSummary {
  readonly id: ScoreId;
  readonly title: string;
  readonly tags: readonly string[];
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Result of a compare-and-swap write: `updated` when the owner's row existed
 * at `expectedRevision` and now holds the new record; `stale` when no such row
 * matched (it changed, was promoted, deleted or never existed). Nothing is
 * written on `stale`.
 */
export type WriteOutcome = 'updated' | 'stale';

export interface ScoreDraftRepository {
  /** Inserts a new draft. Rejects on failure, including an ID collision. */
  create(owner: UserId, draft: ScoreDraft): Promise<void>;
  /** The owner's draft with this ID, expired or not; null when there is none. */
  get(owner: UserId, id: ScoreId): Promise<ScoreDraft | null>;
  /**
   * Replaces the owner's draft `draft.spec.id` only if it is still at
   * `expectedRevision`. Liveness is not re-checked here: the use case decides
   * it at the request instant, and a row still at `expectedRevision` keeps the
   * expiresAt that was checked then (APPLICATION_LAYER.md §3.4).
   */
  update(owner: UserId, draft: ScoreDraft, expectedRevision: number): Promise<WriteOutcome>;
  /** Deletes the owner's draft if it exists (idempotent). */
  delete(owner: UserId, id: ScoreId): Promise<void>;
}

/** A normalized library search (see APPLICATION_LAYER.md §5.5 for matching and order). */
export interface SavedScoreQuery {
  /** Normalized free text; absent means no text filter. */
  readonly text?: string;
  /** Normalized tag filters; a score must carry every one of them. */
  readonly tags: readonly string[];
  readonly limit: number;
  readonly offset: number;
}

export interface SavedScorePage {
  readonly items: readonly SavedScoreSummary[];
  /** Number of matching saved scores over all pages. */
  readonly total: number;
}

export interface SavedScoreRepository {
  /** The owner's saved score with this ID; null when there is none. */
  get(owner: UserId, id: ScoreId): Promise<SavedScore | null>;
  /** Replaces the owner's saved score `saved.spec.id` only if it is still at `expectedRevision`. */
  update(owner: UserId, saved: SavedScore, expectedRevision: number): Promise<WriteOutcome>;
  /** One page of the owner's saved scores matching the query. Never returns drafts. */
  search(owner: UserId, query: SavedScoreQuery): Promise<SavedScorePage>;
}

export interface PromotionRequest {
  readonly id: ScoreId;
  readonly expectedRevision: number;
  /** Normalized, confirmed library title. */
  readonly title: string;
  /** Normalized, confirmed library tags (possibly empty). */
  readonly tags: readonly string[];
  /** Promotion time: the draft must be live at this instant, and it becomes createdAt/updatedAt. */
  readonly now: Date;
}

export type PromotionOutcome =
  { readonly status: 'promoted'; readonly saved: SavedScore } | { readonly status: 'stale' };

/**
 * Atomic draft -> saved promotion (ADR-006). In one transaction: find the
 * owner's draft `id` that is live at `now` (expiresAt > now) and at
 * `expectedRevision`; insert the saved score with the same ID, the same
 * ScoreSpec (same revision), the given title and tags and createdAt =
 * updatedAt = now; delete the draft. Returns `stale` and changes nothing when
 * no such draft exists. A failure rejects and leaves the draft untouched.
 */
export interface ScorePromotion {
  promote(owner: UserId, request: PromotionRequest): Promise<PromotionOutcome>;
}

/**
 * Thrown (as a rejection) by a repository when a stored score exists but this
 * build cannot read it, for example an unsupported ScoreSpec version with no
 * read-upgrade path. The use cases report INTERNAL; the row is never rewritten.
 */
export class StoredScoreUnreadableError extends Error {
  constructor(message = 'A stored score could not be read by this version of the service.') {
    super(message);
    this.name = 'StoredScoreUnreadableError';
  }
}
