/**
 * ERR-I01, MCP half (issue #19): a real external-dependency failure through
 * the actual MCP transport and the production error handling.
 *
 * The score stores are the production Postgres adapter pointed at a database
 * that does not exist, so every store call fails in PostgreSQL (3D000); the
 * rate-limit store stays on the working test database, so the request passes
 * request protection and the bearer guard (a test-issuer token) and reaches
 * the tool. Over real HTTP, a tool call then answers a tool error whose envelope is
 * DEPENDENCY_UNAVAILABLE with the request's correlation ID (the one in the
 * response header), never a success or an empty result; the server logs one
 * error line with that same correlation ID and the redacted cause; nothing in
 * the answer or the log quotes the connection password.
 */
import {
  type PostgresPersistence,
  createPostgresPersistence,
} from '@sheet-music/persistence-postgres';
import { TEST_USER_A } from '@sheet-music/persistence-postgres/testing';
import { RICH_WIRE_FIXTURE, cloneFixture } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpTestBackend, openMcpTestBackend } from './support/backend';
import { type RunningMcpApp, startMcpApp } from './support/mcp-harness';

const PASSWORD = 'not-a-real-secret-7x';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let backend: McpTestBackend;
let missing: PostgresPersistence;
let app: RunningMcpApp;
let token: string;

beforeAll(async () => {
  backend = await openMcpTestBackend();
  const url = new URL(process.env['TEST_DATABASE_URL'] ?? '');
  url.pathname = '/sheet_music_missing_database';
  url.password = PASSWORD;
  missing = createPostgresPersistence({ connectionString: url.toString() });
  app = await startMcpApp({
    stores: {
      drafts: missing.drafts,
      saved: missing.saved,
      promotion: missing.promotion,
      rateLimits: backend.persistence.rateLimits,
    },
  });
  token = await app.token(TEST_USER_A.id);
});

afterAll(async () => {
  await app?.close();
  await missing?.close();
  await backend?.close();
});

function createArguments(): Record<string, unknown> {
  const score = cloneFixture(RICH_WIRE_FIXTURE) as Record<string, unknown>;
  delete score['id'];
  delete score['revision'];
  return { score };
}

describe('ERR-I01 a store outage through actual MCP', () => {
  it.each([
    { tool: 'create_score', args: createArguments() },
    { tool: 'search_scores', args: {} },
  ])(
    '$tool answers DEPENDENCY_UNAVAILABLE with the correlated envelope and log line',
    async ({ tool, args }) => {
      const logsBefore = app.logs.length;

      const response = await fetch(app.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        }),
      });

      expect(response.status).toBe(200);
      const correlationId = response.headers.get('x-correlation-id');
      expect(correlationId).toMatch(UUID);
      const raw = await response.text();
      const { result } = JSON.parse(raw) as {
        result: { isError?: boolean; structuredContent?: unknown; content: { text: string }[] };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse(result.content[0]!.text)).toEqual({
        code: 'DEPENDENCY_UNAVAILABLE',
        message:
          'The score store is temporarily unavailable. Retry later, and reload the score before retrying an edit or a save.',
        correlationId,
      });

      const logged = app.logs.slice(logsBefore);
      expect(logged.filter((line) => line['level'] === 'error')).toEqual([
        expect.objectContaining({
          level: 'error',
          event: 'use_case.failed',
          correlationId,
          operation: tool,
          code: 'DEPENDENCY_UNAVAILABLE',
          cause: expect.objectContaining({
            name: 'PersistenceError',
            code: '3D000',
          }) as unknown,
        }),
      ]);
      expect(raw).not.toContain(PASSWORD);
      expect(JSON.stringify(logged)).not.toContain(PASSWORD);
    },
  );
});
