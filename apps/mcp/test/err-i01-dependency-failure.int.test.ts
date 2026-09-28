/**
 * ERR-I01, MCP half (issue #19): a real external-dependency failure through
 * the actual MCP transport and the production error handling.
 *
 * The stores are the production Postgres adapter pointed at a database that
 * does not exist, so every store call fails in PostgreSQL (3D000). Over real
 * HTTP, a tool call then answers a tool error whose envelope is
 * DEPENDENCY_UNAVAILABLE with the request's correlation ID (the one in the
 * response header), never a success or an empty result; the server logs one
 * error line with that same correlation ID and the redacted cause; nothing in
 * the answer or the log quotes the connection password.
 */
import {
  type PostgresPersistence,
  createPostgresPersistence,
} from '@sheet-music/persistence-postgres';
import { RICH_WIRE_FIXTURE, cloneFixture } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunningMcpServer, startMcpServer } from './support/mcp-harness';

const PASSWORD = 'not-a-real-secret-7x';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let persistence: PostgresPersistence;
let server: RunningMcpServer<PostgresPersistence>;

beforeAll(async () => {
  const url = new URL(process.env['TEST_DATABASE_URL'] ?? '');
  url.pathname = '/sheet_music_missing_database';
  url.password = PASSWORD;
  persistence = createPostgresPersistence({ connectionString: url.toString() });
  server = await startMcpServer(
    { viewHtml: '<!doctype html><title>View</title>' },
    { stores: persistence },
  );
});

afterAll(async () => {
  await server?.close();
  await persistence?.close();
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
      const logsBefore = server.logs.length;

      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
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

      const logged = server.logs.slice(logsBefore);
      expect(logged).toEqual([
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
