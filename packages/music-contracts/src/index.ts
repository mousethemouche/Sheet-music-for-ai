/**
 * @sheet-music/music-contracts
 *
 * Transport-neutral schemas and shared DTOs used by the MCP, HTTP and web
 * adapters: the five tool contracts, the saved-library HTTP DTOs, artifacts
 * and summaries, the error envelope and the payload limits.
 * See docs/architecture/APPLICATION_LAYER.md.
 */
export {
  type DraftArtifact,
  type PageInfo,
  type SavedArtifact,
  type ScoreArtifact,
  type ScoreSummary,
  draftArtifactSchema,
  pageInfoSchema,
  revisionSchema,
  savedArtifactSchema,
  scoreArtifactSchema,
  scoreIdSchema,
  scoreSummarySchema,
} from './artifacts';
export {
  type ApplicationErrorCode,
  type EnvelopeErrorCode,
  type ErrorCode,
  type ErrorDetail,
  type ErrorEnvelope,
  type TransportErrorCode,
  APPLICATION_ERROR_CODES,
  ENVELOPE_ERROR_CODES,
  ERROR_CODES,
  TRANSPORT_ERROR_CODES,
  errorDetailSchema,
  errorEnvelopeSchema,
  inputIssueDetails,
} from './errors';
export { PAYLOAD_LIMITS, type PayloadLimits } from './limits';
export {
  dedupeTags,
  libraryTagSchema,
  libraryTagsSchema,
  libraryTitleSchema,
  normalizeText,
  searchTextSchema,
  tagFiltersSchema,
} from './metadata';
export {
  type ListScoresQuery,
  type ListScoresResponse,
  type SavedScoreParams,
  listScoresQuerySchema,
  listScoresResponseSchema,
  savedScoreParamsSchema,
  savedScoreResponseSchema,
} from './rest';
export {
  type CreateScoreCommand,
  type CreateScoreInput,
  type CreateScoreOutput,
  type EditScoreCommand,
  type EditScoreInput,
  type EditScoreOutput,
  type GetScoreInput,
  type GetScoreOutput,
  type GetScoreQuery,
  type SaveOutcome,
  type SaveScoreCommand,
  type SaveScoreInput,
  type SaveScoreOutput,
  type SearchScoresInput,
  type SearchScoresOutput,
  type SearchScoresQuery,
  type ToolName,
  SAVE_OUTCOMES,
  TOOL_CONTRACTS,
  createScoreInputSchema,
  createScoreOutputSchema,
  editScoreInputSchema,
  editScoreOutputSchema,
  getScoreInputSchema,
  getScoreOutputSchema,
  saveScoreInputSchema,
  saveScoreOutputSchema,
  searchScoresInputSchema,
  searchScoresOutputSchema,
} from './tools';
