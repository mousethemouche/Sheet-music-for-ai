/**
 * @sheet-music/music-application
 *
 * Use cases (CreateScore, EditScore, SaveScore, GetScore, GetSavedScore,
 * SearchScores) and their neutral ports: repositories, promotion, clock, IDs,
 * draft expiry and the authenticated principal (ADR-003, ADR-005, ADR-006).
 * See docs/architecture/APPLICATION_LAYER.md.
 */
export { type ApplicationError, type AppResult, applicationError, fromDomainError } from './errors';
export {
  DEFAULT_DRAFT_TTL_MS,
  type DraftExpiryPolicy,
  createDraftExpiryPolicy,
} from './expiry-policy';
export {
  type AuthenticatedPrincipal,
  type Clock,
  type IdGenerator,
  type PromotionOutcome,
  type PromotionRequest,
  type SavedScore,
  type SavedScorePage,
  type SavedScoreQuery,
  type SavedScoreRepository,
  type SavedScoreSummary,
  type ScoreDraft,
  type ScoreDraftRepository,
  type ScoreId,
  type ScorePromotion,
  type UserId,
  type WriteOutcome,
  StoredScoreUnreadableError,
} from './ports';
export {
  type CreateScoreDependencies,
  CreateScore,
  INITIAL_REVISION,
} from './use-cases/create-score';
export { type EditScoreDependencies, EditScore } from './use-cases/edit-score';
export {
  type GetSavedScoreDependencies,
  type GetScoreDependencies,
  GetSavedScore,
  GetScore,
} from './use-cases/get-score';
export { type SaveScoreDependencies, SaveScore } from './use-cases/save-score';
export { type SearchScoresDependencies, SearchScores } from './use-cases/search-scores';
