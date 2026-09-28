/**
 * ERR-01 (issue #19): the one mapping table from an error code to its HTTP
 * status and MCP disposition, and the safe envelope both transports send.
 * Expected statuses come from TEST_PLAN §5 ("invalid REST input 400; absent
 * or invalid auth 401; forbidden origin 403; missing/foreign item 404;
 * mutation conflict 409; size 413; rate 429; unavailable dependency 503")
 * and APPLICATION_LAYER.md §6. One real failure per transport on the wire is
 * ERR-I01, in the wiring phase.
 */
import { applicationError, fromDomainError } from '@sheet-music/music-application';
import { errorEnvelopeSchema } from '@sheet-music/music-contracts';
import { domainError, errorDetail } from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import {
  ERROR_MAPPING,
  type ServerErrorCode,
  internalError,
  toHttpError,
  toMcpToolError,
  transportError,
} from '../src/index';

const CORRELATION = 'corr-0001-err01';

describe('ERR-01 one table: code -> HTTP status and MCP disposition', () => {
  const table: readonly { code: ServerErrorCode; status: number; mcp: 'tool-error' | 'http' }[] = [
    { code: 'INVALID_INPUT', status: 400, mcp: 'tool-error' },
    { code: 'SCORE_VALIDATION_FAILED', status: 400, mcp: 'tool-error' },
    { code: 'MVP_LIMIT_EXCEEDED', status: 400, mcp: 'tool-error' },
    { code: 'INVALID_OPERATION', status: 400, mcp: 'tool-error' },
    { code: 'TARGET_NOT_FOUND', status: 400, mcp: 'tool-error' },
    { code: 'UNAUTHENTICATED', status: 401, mcp: 'http' },
    { code: 'FORBIDDEN_ORIGIN', status: 403, mcp: 'http' },
    { code: 'NOT_FOUND', status: 404, mcp: 'tool-error' },
    { code: 'REVISION_CONFLICT', status: 409, mcp: 'tool-error' },
    { code: 'ALREADY_SAVED', status: 409, mcp: 'tool-error' },
    { code: 'LENGTH_REQUIRED', status: 411, mcp: 'http' },
    { code: 'PAYLOAD_TOO_LARGE', status: 413, mcp: 'http' },
    { code: 'RATE_LIMITED', status: 429, mcp: 'http' },
    { code: 'INTERNAL', status: 500, mcp: 'tool-error' },
    { code: 'DEPENDENCY_UNAVAILABLE', status: 503, mcp: 'tool-error' },
  ];

  it('lists every code exactly once', () => {
    expect(Object.keys(ERROR_MAPPING).sort()).toEqual(table.map(({ code }) => code).sort());
  });

  it.each(table)('$code -> HTTP $status, MCP $mcp', ({ code, status, mcp }) => {
    expect(ERROR_MAPPING[code]).toEqual({ status, mcp });
    expect(toHttpError({ code, message: 'm', details: [] }).status).toBe(status);
  });
});

describe('ERR-01 safe envelope', () => {
  const conflict = fromDomainError(
    domainError('SCORE_VALIDATION_FAILED', [
      {
        ...errorDetail('ANNOTATION_COLOR_CONFLICT', ['annotations'], 'Two colors on one note.', [
          'n1',
          'a1',
          'a2',
        ]),
        // A stray property on a detail must not travel.
        input: 'text the user typed',
      } as ReturnType<typeof errorDetail>,
    ]),
  );

  const expectedEnvelope = {
    code: 'SCORE_VALIDATION_FAILED',
    message: conflict.message,
    details: [
      {
        code: 'ANNOTATION_COLOR_CONFLICT',
        path: ['annotations'],
        message: 'Two colors on one note.',
        ids: ['n1', 'a1', 'a2'],
      },
    ],
    correlationId: CORRELATION,
  };

  it('keeps code, detail path and ids and the correlation ID over HTTP, and fits the contract schema', () => {
    const response = toHttpError(conflict, CORRELATION);

    expect(response).toEqual({ status: 400, body: expectedEnvelope });
    expect(errorEnvelopeSchema.safeParse(response.body).success).toBe(true);
  });

  it('returns the same envelope as the text of an MCP isError result, not as structuredContent', () => {
    const result = toMcpToolError(conflict, CORRELATION);

    expect(Object.keys(result).sort()).toEqual(['content', 'isError']);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual(expectedEnvelope);
  });

  it('never serializes the cause: a foreign score and a missing one give identical bytes', () => {
    const missing = applicationError('NOT_FOUND');
    const foreign = applicationError('NOT_FOUND', [], undefined, {
      owner: 'user-b',
      row: 'scr_123',
    });

    expect(JSON.stringify(toHttpError(foreign, CORRELATION))).toBe(
      JSON.stringify(toHttpError(missing, CORRELATION)),
    );
    expect(toMcpToolError(foreign, CORRELATION)).toEqual(toMcpToolError(missing, CORRELATION));
    expect(JSON.stringify(toHttpError(foreign, CORRELATION))).not.toContain('user-b');
  });

  it('turns any thrown value into the generic INTERNAL failure', () => {
    const thrown = new Error('connect ECONNREFUSED postgres://app:hunter2@db.internal:5432/scores');

    expect(toHttpError(internalError(thrown), CORRELATION)).toEqual({
      status: 500,
      body: {
        code: 'INTERNAL',
        message: 'An internal error occurred.',
        correlationId: CORRELATION,
      },
    });
  });
});

describe('ERR-01 HTTP-layer failures stay distinct from tool results', () => {
  it('never reports UNAUTHENTICATED as a tool result: authentication is the HTTP 401 challenge', () => {
    const result = toMcpToolError(applicationError('UNAUTHENTICATED'), CORRELATION);

    expect(JSON.parse(result.content[0].text)).toEqual({
      code: 'INTERNAL',
      message: 'An internal error occurred.',
      correlationId: CORRELATION,
    });
  });

  it('serializes request-protection failures with their own code and status', () => {
    expect(toHttpError(transportError('RATE_LIMITED'), CORRELATION)).toEqual({
      status: 429,
      body: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Retry after the delay given in the Retry-After header.',
        correlationId: CORRELATION,
      },
    });
  });
});
