/**
 * Library services for tests that are not about the library (AUTH-UI-01..03):
 * requests never settle, so those tests see the library heading and a loading
 * state, and no ScorePlayer is ever mounted.
 */
import type { ScoresApi } from '../../api/scoresApi';
import type { LibraryServices } from '../services';
import { createFakePlayer } from './fakePlayer';

export function pendingLibraryServices(): LibraryServices {
  const never = () => new Promise<never>(() => {});
  const scores: ScoresApi = { listScores: never, getSavedScore: never };
  return { scores, player: createFakePlayer().player };
}
