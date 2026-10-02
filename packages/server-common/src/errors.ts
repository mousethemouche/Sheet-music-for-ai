/**
 * One error contract for both transports (issue #19, ERRORS_AND_SECURITY.md §1).
 *
 * `ERROR_MAPPING` is the single table from an error code to its HTTP status
 * and to its MCP disposition:
 * - `tool-error`: an authenticated tools/call answers a normal JSON-RPC result
 *   `{ isError: true, content: [{ type: 'text', text: <envelope JSON> }] }`,
 *   so the model can read the code and details and correct itself;
 * - `http`: the request never reaches a tool. It is answered at the HTTP
 *   layer (401 challenge, 403 origin, 411/413 body, 429 rate). JSON-RPC
 *   protocol errors (malformed message, unknown method or tool) stay the MCP
 *   SDK's own and are not produced here.
 *
 * Envelopes carry only the code, the safe message, copies of the detail
 * fields (code, path, message, ids) and the correlation ID. `cause`, stacks
 * and any other property never leave the server.
 */
import { type ApplicationError, applicationError } from '@sheet-music/music-application';
import type { ErrorCode, ErrorDetail } from '@sheet-music/music-contracts';

/**
 * Codes raised by request protection before any use case runs. They are not
 * application codes; music-contracts' envelope schema accepts them too
 * (`ENVELOPE_ERROR_CODES`, ERRORS_AND_SECURITY.md §1.2).
 */
export const TRANSPORT_ERROR_CODES = [
  'FORBIDDEN_ORIGIN',
  'LENGTH_REQUIRED',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
] as const;
export type TransportErrorCode = (typeof TRANSPORT_ERROR_CODES)[number];

export type ServerErrorCode = ErrorCode | TransportErrorCode;

/** An error either transport can serialize. Every ApplicationError is one. */
export interface ServerError {
  readonly code: ServerErrorCode;
  readonly message: string;
  readonly details: readonly ErrorDetail[];
  readonly cause?: unknown;
}

export type McpDisposition = 'tool-error' | 'http';

export interface ErrorMapping {
  readonly status: number;
  readonly mcp: McpDisposition;
}

export const ERROR_MAPPING: Readonly<Record<ServerErrorCode, ErrorMapping>> = Object.freeze({
  INVALID_INPUT: { status: 400, mcp: 'tool-error' },
  SCORE_VALIDATION_FAILED: { status: 400, mcp: 'tool-error' },
  MVP_LIMIT_EXCEEDED: { status: 400, mcp: 'tool-error' },
  INVALID_OPERATION: { status: 400, mcp: 'tool-error' },
  TARGET_NOT_FOUND: { status: 400, mcp: 'tool-error' },
  UNAUTHENTICATED: { status: 401, mcp: 'http' },
  FORBIDDEN_ORIGIN: { status: 403, mcp: 'http' },
  NOT_FOUND: { status: 404, mcp: 'tool-error' },
  REVISION_CONFLICT: { status: 409, mcp: 'tool-error' },
  ALREADY_SAVED: { status: 409, mcp: 'tool-error' },
  LENGTH_REQUIRED: { status: 411, mcp: 'http' },
  PAYLOAD_TOO_LARGE: { status: 413, mcp: 'http' },
  RATE_LIMITED: { status: 429, mcp: 'http' },
  INTERNAL: { status: 500, mcp: 'tool-error' },
  DEPENDENCY_UNAVAILABLE: { status: 503, mcp: 'tool-error' },
});

/** The serialized error of both transports: music-contracts' envelope, widened to the transport codes. */
export interface ServerErrorEnvelope {
  readonly code: ServerErrorCode;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
  readonly correlationId?: string;
}

function copyDetail(detail: ErrorDetail): ErrorDetail {
  const copy = { code: detail.code, path: [...detail.path], message: detail.message };
  return detail.ids === undefined ? copy : { ...copy, ids: [...detail.ids] };
}

export function toErrorEnvelope(error: ServerError, correlationId?: string): ServerErrorEnvelope {
  return {
    code: error.code,
    message: error.message,
    ...(error.details.length === 0 ? {} : { details: error.details.map(copyDetail) }),
    ...(correlationId === undefined ? {} : { correlationId }),
  };
}

export interface HttpErrorResponse {
  readonly status: number;
  readonly body: ServerErrorEnvelope;
}

export function toHttpError(error: ServerError, correlationId?: string): HttpErrorResponse {
  return { status: ERROR_MAPPING[error.code].status, body: toErrorEnvelope(error, correlationId) };
}

/** Structurally a CallToolResult of the MCP SDK; server-common does not import the SDK. */
export interface McpToolErrorResult {
  readonly isError: true;
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
}

/**
 * The tools/call result of a failed use case. The envelope is the JSON text
 * content, not `structuredContent`: the pinned SDK client (1.30.1) validates
 * `structuredContent` against the tool's output schema even when `isError` is
 * true, so an envelope there would turn a readable tool error into a client
 * failure. A code answered at the HTTP layer (UNAUTHENTICATED...) cannot
 * legitimately come out of a tool, so it becomes INTERNAL.
 */
export function toMcpToolError(error: ServerError, correlationId?: string): McpToolErrorResult {
  const served = ERROR_MAPPING[error.code].mcp === 'tool-error' ? error : internalError(error);
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(toErrorEnvelope(served, correlationId)) }],
  };
}

/** Any thrown value (a bug, never an expected failure): INTERNAL with the generic message; the value stays in `cause` for logs. */
export function internalError(cause: unknown): ApplicationError {
  return applicationError('INTERNAL', [], undefined, cause);
}

const TRANSPORT_MESSAGES: Readonly<Record<TransportErrorCode, string>> = {
  FORBIDDEN_ORIGIN: 'Requests from this origin are not allowed.',
  LENGTH_REQUIRED: 'A request body must declare its Content-Length.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  RATE_LIMITED: 'Too many requests. Retry after the delay given in the Retry-After header.',
};

export function transportError(
  code: TransportErrorCode,
  message = TRANSPORT_MESSAGES[code],
): ServerError {
  return Object.freeze({ code, message, details: Object.freeze([]) });
}
