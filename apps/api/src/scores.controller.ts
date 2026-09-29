/**
 * Read-only saved-library routes (issue #21, APPLICATION_LAYER.md §7.2):
 *
 *   GET /scores?query=&tags=&tags=&limit=&offset=  -> ListScoresResponse (summaries only)
 *   GET /scores/:id                                -> SavedArtifact (saved scores only)
 *
 * Thin mapping onto the shared use cases: the guards have authenticated the
 * caller, the contract pipes have validated the query string or path, and
 * the use case runs through server-common's runUseCase. A draft, a missing
 * score and another user's score are the same 404. There is no write route.
 */
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@sheet-music/music-application';
import {
  type ListScoresResponse,
  type SavedArtifact,
  type SavedScoreParams,
  type SearchScoresQuery,
  listScoresQuerySchema,
  savedScoreParamsSchema,
} from '@sheet-music/music-contracts';
import { type Logger, runUseCase } from '@sheet-music/server-common';
import { CurrentPrincipal } from './auth';
import { ContractPipe, unwrap } from './errors';
import { API_LOGGER, API_USE_CASES, type ApiUseCases } from './tokens';

@Controller('scores')
export class ScoresController {
  constructor(
    @Inject(API_USE_CASES) private readonly useCases: ApiUseCases,
    @Inject(API_LOGGER) private readonly logger: Logger,
  ) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal | null,
    @Query(new ContractPipe(listScoresQuerySchema)) query: SearchScoresQuery,
  ): Promise<ListScoresResponse> {
    return unwrap(
      await runUseCase(this.logger, 'list_scores', () =>
        this.useCases.searchScores.execute(principal, query),
      ),
    );
  }

  @Get(':id')
  async get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal | null,
    @Param(new ContractPipe(savedScoreParamsSchema)) params: SavedScoreParams,
  ): Promise<SavedArtifact> {
    const { artifact } = unwrap(
      await runUseCase(this.logger, 'get_saved_score', () =>
        this.useCases.getSavedScore.execute(principal, { scoreId: params.id }),
      ),
    );
    return artifact;
  }
}
