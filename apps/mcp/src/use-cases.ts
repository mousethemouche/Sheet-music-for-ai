/**
 * The five application use cases behind the MCP tools, composed over the
 * neutral ports (APPLICATION_LAYER.md §3). The composition root chooses the
 * store adapters (Postgres in production, #9/#22).
 */
import { randomUUID } from 'node:crypto';
import {
  type AppResult,
  type AuthenticatedPrincipal,
  type Clock,
  type DraftExpiryPolicy,
  type IdGenerator,
  type SavedScoreRepository,
  type ScoreDraftRepository,
  type ScorePromotion,
  CreateScore,
  EditScore,
  GetScore,
  SaveScore,
  SearchScores,
  createDraftExpiryPolicy,
} from '@sheet-music/music-application';
import type {
  CreateScoreOutput,
  EditScoreOutput,
  GetScoreOutput,
  SaveScoreOutput,
  SearchScoresOutput,
} from '@sheet-music/music-contracts';

/** A use case as the adapter calls it: trusted principal plus untrusted input. */
export interface UseCase<Output> {
  execute(principal: AuthenticatedPrincipal | null, input: unknown): Promise<AppResult<Output>>;
}

export interface McpUseCases {
  readonly createScore: UseCase<CreateScoreOutput>;
  readonly editScore: UseCase<EditScoreOutput>;
  readonly saveScore: UseCase<SaveScoreOutput>;
  readonly getScore: UseCase<GetScoreOutput>;
  readonly searchScores: UseCase<SearchScoresOutput>;
}

export interface ScoreStores {
  readonly drafts: ScoreDraftRepository;
  readonly saved: SavedScoreRepository;
  readonly promotion: ScorePromotion;
}

export interface UseCaseOptions {
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly expiry?: DraftExpiryPolicy;
}

export const systemClock: Clock = { now: () => new Date() };

/** Score IDs are "scr_" + a random UUID (matches the ScoreSpec ID pattern). */
export const randomScoreIds: IdGenerator = { newScoreId: () => `scr_${randomUUID()}` };

export function createMcpUseCases(stores: ScoreStores, options: UseCaseOptions = {}): McpUseCases {
  const ports = {
    ...stores,
    clock: options.clock ?? systemClock,
    ids: options.ids ?? randomScoreIds,
    expiry: options.expiry ?? createDraftExpiryPolicy(),
  };
  return {
    createScore: new CreateScore(ports),
    editScore: new EditScore(ports),
    saveScore: new SaveScore(ports),
    getScore: new GetScore(ports),
    searchScores: new SearchScores(ports),
  };
}
