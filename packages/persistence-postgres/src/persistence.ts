/**
 * What a server composition root (apps/api, apps/mcp) wires: one pool per
 * process and the adapters built on it. `drafts`, `saved` and `promotion`
 * match the application ports; `rateLimits` matches server-common's
 * RateLimitStore.
 */
import type {
  SavedScoreRepository,
  ScoreDraftRepository,
  ScorePromotion,
} from '@sheet-music/music-application';
import { createScoreDraftRepository } from './drafts';
import { type PostgresPoolConfig, createPostgresPool } from './pool';
import { createScorePromotion } from './promotion';
import { type RateLimitStore, createPostgresRateLimitStore } from './rate-limit';
import { createSavedScoreRepository } from './saved-scores';

export interface PostgresPersistence {
  readonly drafts: ScoreDraftRepository;
  readonly saved: SavedScoreRepository;
  readonly promotion: ScorePromotion;
  readonly rateLimits: RateLimitStore;
  /**
   * Graceful shutdown: stops handing out connections, waits for the calls in
   * progress to release theirs, then closes the pool. Idempotent. Later calls
   * reject with a PersistenceError.
   */
  close(): Promise<void>;
}

export function createPostgresPersistence(config: PostgresPoolConfig): PostgresPersistence {
  const pool = createPostgresPool(config);
  let closing: Promise<void> | undefined;
  return {
    drafts: createScoreDraftRepository(pool),
    saved: createSavedScoreRepository(pool),
    promotion: createScorePromotion(pool),
    rateLimits: createPostgresRateLimitStore(pool),
    close: () => (closing ??= pool.end()),
  };
}
