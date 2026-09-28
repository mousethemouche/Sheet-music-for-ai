/**
 * @sheet-music/persistence-postgres
 *
 * PostgreSQL adapters implementing the music-application ports (ADR-005,
 * ADR-006): owner-scoped draft and saved-score repositories, atomic
 * promotion, the expired-draft cleanup runner and the shared rate-limit
 * store. Connection model and SQL: docs/architecture/DATABASE.md.
 */
export { type ExpiredDraftCleanup, createExpiredDraftCleanup } from './draft-cleanup';
export { createScoreDraftRepository } from './drafts';
export { PersistenceError } from './errors';
export { type PostgresPersistence, createPostgresPersistence } from './persistence';
export { type PostgresPoolConfig, createPostgresPool } from './pool';
export { createScorePromotion } from './promotion';
export {
  type RateLimitStore,
  type RateLimitWindow,
  createPostgresRateLimitStore,
} from './rate-limit';
export { createSavedScoreRepository } from './saved-scores';
