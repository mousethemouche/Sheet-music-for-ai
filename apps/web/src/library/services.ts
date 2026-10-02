import type { ScoresApi } from '../api/scoresApi';
import type { WebPlayer } from '../player/webPlayer';

/** What the saved-score library needs from the composition root (main.tsx). */
export interface LibraryServices {
  /** Read-only client of the saved-library HTTP API. */
  readonly scores: ScoresApi;
  /** Shared ScorePlayer ports, audio stop and sound credits. */
  readonly player: WebPlayer;
}
