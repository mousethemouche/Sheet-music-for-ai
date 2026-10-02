import { type ScoreSpec, validateScoreSpec } from '@sheet-music/music-domain';

/**
 * Validates a fixture and returns the canonical ScoreSpec, or throws with the
 * structured error. For downstream tests (#3, #5, #6) that need a valid score
 * as input rather than testing validation itself.
 */
export function parseFixture(input: unknown): ScoreSpec {
  const result = validateScoreSpec(input);
  if (!result.ok) {
    throw new Error(`Fixture is not a valid ScoreSpec: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
