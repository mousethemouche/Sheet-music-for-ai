/**
 * Dependency-injection tokens and the ports the controllers receive. The
 * composition root (`createApiApp`) provides them; controllers never build
 * adapters.
 */
import type { GetSavedScore, SearchScores } from '@sheet-music/music-application';

export const API_USE_CASES = Symbol('API_USE_CASES');
export const API_LOGGER = Symbol('API_LOGGER');
export const API_ON_CLOSE = Symbol('API_ON_CLOSE');

/** The use cases behind the HTTP routes: saved scores only, never drafts. */
export interface ApiUseCases {
  readonly searchScores: Pick<SearchScores, 'execute'>;
  readonly getSavedScore: Pick<GetSavedScore, 'execute'>;
}
