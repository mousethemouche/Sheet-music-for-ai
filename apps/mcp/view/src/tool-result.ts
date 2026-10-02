/**
 * MCP-U01: parser of the tool results the host forwards to the View
 * (`ui/notifications/tool-result`). Nothing reaches the score mount unless the
 * result carries a well-formed score artifact whose ScoreSpec v1 document is
 * valid and whose envelope identity (scoreId, revision) matches the document.
 */
import {
  type ErrorEnvelope,
  type ScoreArtifact,
  errorEnvelopeSchema,
  scoreArtifactSchema,
} from '@sheet-music/music-contracts';
import { validateScoreSpec } from '@sheet-music/music-domain';

export type InvalidResultReason =
  /** Not an object, or no score artifact in `structuredContent`. */
  | 'missing-artifact'
  /** The artifact envelope breaks the transport contract (state, ids, timestamps...). */
  | 'invalid-artifact'
  /** The score is not a valid ScoreSpec v1 document (including another version). */
  | 'invalid-score'
  /** The envelope names another score ID or revision than the document it carries. */
  | 'identity-mismatch';

export type ParsedToolResult =
  | { readonly kind: 'artifact'; readonly artifact: ScoreArtifact }
  /** A tool failure: the server's error envelope, or null when it is unreadable. */
  | { readonly kind: 'tool-error'; readonly error: ErrorEnvelope | null }
  | { readonly kind: 'invalid'; readonly reason: InvalidResultReason };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The error envelope of a failed tool call: the JSON text of its first text block. */
function errorEnvelopeOf(content: unknown): ErrorEnvelope | null {
  const block = Array.isArray(content) ? (content as unknown[])[0] : undefined;
  if (!isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') {
    return null;
  }
  try {
    const parsed = errorEnvelopeSchema.safeParse(JSON.parse(block['text']));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseToolResult(result: unknown): ParsedToolResult {
  if (!isRecord(result)) {
    return { kind: 'invalid', reason: 'missing-artifact' };
  }
  if (result['isError'] === true) {
    return { kind: 'tool-error', error: errorEnvelopeOf(result['content']) };
  }
  const structured = result['structuredContent'];
  if (!isRecord(structured) || !('artifact' in structured)) {
    return { kind: 'invalid', reason: 'missing-artifact' };
  }
  const envelope = scoreArtifactSchema.safeParse(structured['artifact']);
  if (!envelope.success) {
    return { kind: 'invalid', reason: 'invalid-artifact' };
  }
  const score = validateScoreSpec(envelope.data.score);
  if (!score.ok) {
    return { kind: 'invalid', reason: 'invalid-score' };
  }
  if (envelope.data.scoreId !== score.value.id || envelope.data.revision !== score.value.revision) {
    return { kind: 'invalid', reason: 'identity-mismatch' };
  }
  return { kind: 'artifact', artifact: { ...envelope.data, score: score.value } };
}
