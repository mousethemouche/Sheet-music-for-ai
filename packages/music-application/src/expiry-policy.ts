/**
 * Draft expiry policy (ADR-006, issue #22, APPLICATION_LAYER.md §3.3).
 *
 * A draft expires a fixed TTL after its latest successful write (creation or
 * edit); reads and failed edits never renew it. The boundary is exact: a draft
 * is live while now < expiresAt and expired from now >= expiresAt, whether or
 * not the cleanup job has deleted it yet. The TTL is configuration, not a
 * domain invariant.
 */

/** MVP default: 7 days after the latest successful update. */
export const DEFAULT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface DraftExpiryPolicy {
  readonly ttlMs: number;
  /** Expiry of a draft whose latest successful write happened at `writtenAt`. */
  expiresAt(writtenAt: Date): Date;
  /** True from the instant `expiresAt` on. */
  isExpired(expiresAt: Date, now: Date): boolean;
}

/** Throws RangeError unless `ttlMs` is a positive whole number of milliseconds. */
export function createDraftExpiryPolicy(ttlMs: number = DEFAULT_DRAFT_TTL_MS): DraftExpiryPolicy {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError('The draft TTL must be a positive whole number of milliseconds.');
  }
  return Object.freeze({
    ttlMs,
    expiresAt: (writtenAt: Date): Date => new Date(writtenAt.getTime() + ttlMs),
    isExpired: (expiresAt: Date, now: Date): boolean => now.getTime() >= expiresAt.getTime(),
  });
}
