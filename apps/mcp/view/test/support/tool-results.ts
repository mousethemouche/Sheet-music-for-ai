/**
 * Tool results as the host forwards them to the View (`ui/notifications/tool-result`),
 * built from the rich wire fixture (score id "rich", revision 3).
 */
import { RICH_WIRE_FIXTURE, cloneFixture } from '@sheet-music/test-fixtures';

export const FIXTURE_ID = 'rich';
export const FIXTURE_REVISION = 3;

/** A draft artifact whose envelope and document agree; `patch` edits the envelope, `scorePatch` the document. */
export function draftArtifactJson(
  patch: Record<string, unknown> = {},
  scorePatch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: 'draft',
    scoreId: FIXTURE_ID,
    revision: FIXTURE_REVISION,
    score: { ...(cloneFixture(RICH_WIRE_FIXTURE) as Record<string, unknown>), ...scorePatch },
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
    expiresAt: '2026-10-05T12:00:00.000Z',
    ...patch,
  };
}

/** The same score at another revision (as a successful edit would return it). */
export function revisionArtifactJson(
  revision: number,
  scoreId = FIXTURE_ID,
): Record<string, unknown> {
  return draftArtifactJson({ scoreId, revision }, { id: scoreId, revision });
}

export function successResult(artifact: unknown): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: 'Created score.' }],
    structuredContent: { artifact },
  };
}

export function errorResult(text: string): Record<string, unknown> {
  return { isError: true, content: [{ type: 'text', text }] };
}

export const COLOR_CONFLICT_TEXT = JSON.stringify({
  code: 'SCORE_VALIDATION_FAILED',
  message: 'The score breaks ScoreSpec v1 rules; see details. Nothing was stored.',
  details: [
    {
      code: 'ANNOTATION_COLOR_CONFLICT',
      path: ['annotations'],
      message: 'Note rich-rh-n3 has two teaching colors.',
      ids: ['rich-rh-n3', 'a1', 'a2'],
    },
  ],
});
