/**
 * Writes an error envelope as an HTTP response (ERRORS_AND_SECURITY.md §1).
 * Uses the plain Node response API, so Express handlers, Nest filters and
 * the MCP route share it. Error bodies are JSON with `nosniff`: user text in a
 * body is never interpreted as HTML by a browser, and never cached.
 */
import type { ServerResponse } from 'node:http';
import { currentRequestContext } from './context';
import { type ServerError, toHttpError } from './errors';

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function sendError(
  res: ServerResponse,
  error: ServerError,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (res.headersSent) {
    // Too late for a status: end the response so the client sees a failure, not a partial success.
    res.destroy();
    return;
  }
  const { status, body } = toHttpError(error, currentRequestContext()?.correlationId);
  const payload = JSON.stringify(body);
  res.statusCode = status;
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.setHeader('Content-Type', JSON_CONTENT_TYPE);
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(payload);
}
