/**
 * MCP-U01 (#11): the View accepts only a well-formed score artifact whose
 * ScoreSpec v1 document is valid and matches the envelope identity, before
 * anything is mounted; it keeps the last valid artifact, ignores stale and
 * duplicate revisions, and turns failures into recoverable notices. ScoreSpec
 * rules themselves are #2; only representative identity/version cases here.
 */
import { RICH_WIRE_FIXTURE, parseFixture } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { type InvalidResultReason, parseToolResult } from '../src/tool-result';
import { INITIAL_VIEW_STATE, type ViewState, reduceViewState } from '../src/view-state';
import {
  COLOR_CONFLICT_TEXT,
  FIXTURE_ID,
  FIXTURE_REVISION,
  draftArtifactJson,
  errorResult,
  revisionArtifactJson,
  successResult,
} from './support/tool-results';

describe('MCP-U01 parseToolResult: accepted artifacts', () => {
  it('accepts a draft artifact and returns the canonical score', () => {
    const parsed = parseToolResult(successResult(draftArtifactJson()));
    expect(parsed).toEqual({
      kind: 'artifact',
      artifact: { ...draftArtifactJson(), score: parseFixture(RICH_WIRE_FIXTURE) },
    });
  });

  it('accepts a saved artifact', () => {
    const saved = draftArtifactJson({ state: 'saved', title: 'ii-V-I', tags: ['jazz'] });
    delete saved['expiresAt'];
    const parsed = parseToolResult(successResult(saved));
    expect(parsed).toMatchObject({
      kind: 'artifact',
      artifact: {
        state: 'saved',
        scoreId: FIXTURE_ID,
        revision: FIXTURE_REVISION,
        title: 'ii-V-I',
      },
    });
  });
});

describe('MCP-U01 parseToolResult: rejected before mounting', () => {
  const withoutField = (field: string, score = false): Record<string, unknown> => {
    const artifact = draftArtifactJson();
    if (score) {
      delete (artifact['score'] as Record<string, unknown>)[field];
    } else {
      delete artifact[field];
    }
    return artifact;
  };

  it.each<{ case: string; result: unknown; reason: InvalidResultReason }>([
    { case: 'a result that is not an object', result: null, reason: 'missing-artifact' },
    {
      case: 'a result without structuredContent',
      result: { content: [{ type: 'text', text: 'Created score.' }] },
      reason: 'missing-artifact',
    },
    {
      case: 'structured content without an artifact (a search page)',
      result: { content: [], structuredContent: { items: [], page: {} } },
      reason: 'missing-artifact',
    },
    {
      case: 'an artifact without scoreId',
      result: successResult(withoutField('scoreId')),
      reason: 'invalid-artifact',
    },
    {
      case: 'an artifact without revision',
      result: successResult(withoutField('revision')),
      reason: 'invalid-artifact',
    },
    {
      case: 'an artifact of an unknown state',
      result: successResult(draftArtifactJson({ state: 'archived' })),
      reason: 'invalid-artifact',
    },
    {
      case: 'a score without id',
      result: successResult(withoutField('id', true)),
      reason: 'invalid-score',
    },
    {
      case: 'a score without version',
      result: successResult(withoutField('version', true)),
      reason: 'invalid-score',
    },
    {
      case: 'a score of version 2',
      result: successResult(draftArtifactJson({}, { version: 2 })),
      reason: 'invalid-score',
    },
    {
      case: 'an envelope naming another score ID',
      result: successResult(draftArtifactJson({ scoreId: 'other' })),
      reason: 'identity-mismatch',
    },
    {
      case: 'an envelope revision other than the document revision',
      result: successResult(draftArtifactJson({ revision: FIXTURE_REVISION + 1 })),
      reason: 'identity-mismatch',
    },
  ])('rejects $case ($reason)', ({ result, reason }) => {
    expect(parseToolResult(result)).toEqual({ kind: 'invalid', reason });
  });
});

describe('MCP-U01 parseToolResult: tool errors', () => {
  it('reads the error envelope of a failed tool call', () => {
    expect(parseToolResult(errorResult(COLOR_CONFLICT_TEXT))).toEqual({
      kind: 'tool-error',
      error: JSON.parse(COLOR_CONFLICT_TEXT) as unknown,
    });
  });

  it('keeps a failed tool call without a readable envelope as an error', () => {
    expect(parseToolResult(errorResult('MCP error -32602: Tool nope not found'))).toEqual({
      kind: 'tool-error',
      error: null,
    });
  });
});

describe('MCP-U01 View state: which result is shown', () => {
  const shown = (state: ViewState) =>
    state.artifact === null
      ? null
      : { scoreId: state.artifact.scoreId, revision: state.artifact.revision };
  const apply = (state: ViewState, result: unknown): ViewState =>
    reduceViewState(state, { type: 'tool-result', result });
  const first = apply(INITIAL_VIEW_STATE, successResult(draftArtifactJson()));

  it('shows the first valid artifact', () => {
    expect(shown(first)).toEqual({ scoreId: FIXTURE_ID, revision: FIXTURE_REVISION });
    expect(first.notice).toBeNull();
  });

  it('replaces it with a newer revision of the same score and clears the notice', () => {
    const rejected = apply(first, errorResult(COLOR_CONFLICT_TEXT));
    const next = apply(rejected, successResult(revisionArtifactJson(FIXTURE_REVISION + 1)));
    expect(shown(next)).toEqual({ scoreId: FIXTURE_ID, revision: FIXTURE_REVISION + 1 });
    expect(next.notice).toBeNull();
  });

  it.each([
    { case: 'a duplicate of the shown revision', result: successResult(draftArtifactJson()) },
    {
      case: 'a stale revision',
      result: successResult(revisionArtifactJson(FIXTURE_REVISION - 1)),
    },
    {
      case: 'a newer revision of another score',
      result: successResult(revisionArtifactJson(FIXTURE_REVISION + 1, 'another-score')),
    },
  ])('ignores $case', ({ result }) => {
    expect(apply(first, result)).toBe(first);
  });

  it('keeps the last valid score and shows the error of a rejected edit', () => {
    const next = apply(first, errorResult(COLOR_CONFLICT_TEXT));
    expect(shown(next)).toEqual({ scoreId: FIXTURE_ID, revision: FIXTURE_REVISION });
    expect(next.notice).toEqual({
      kind: 'rejected',
      code: 'SCORE_VALIDATION_FAILED',
      message: 'The score breaks ScoreSpec v1 rules; see details. Nothing was stored.',
    });
  });

  it('keeps the last valid score when a result is unreadable', () => {
    const next = apply(first, successResult(draftArtifactJson({ scoreId: 'other' })));
    expect(shown(next)).toEqual({ scoreId: FIXTURE_ID, revision: FIXTURE_REVISION });
    expect(next.notice).toEqual({ kind: 'unreadable' });
  });

  it('unmounts the score on host teardown', () => {
    expect(reduceViewState(first, { type: 'teardown' })).toEqual({
      connection: 'closed',
      artifact: null,
      notice: null,
    });
  });
});
