/**
 * Last-resort error handling of the MCP HTTP app (#19, ERR-01 on this
 * transport; MCP_SERVER.md §1): a handler of the `/mcp` chain that throws or
 * rejects with something no guard expected (for example a verifier error the
 * token classification does not know) is answered like every other HTTP
 * failure: the shared 500 INTERNAL envelope with the request's correlation
 * ID, `no-store` and `nosniff`, and the thrown value only in the log. The
 * mapping table itself is ERR-01 (server-common); this is the app's wiring.
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorEnvelopeSchema } from '@sheet-music/music-contracts';
import { correlationMiddleware, createLogger } from '@sheet-music/server-common';
import type { RequestHandler } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { MCP_PATH, createMcpHttpApp } from './app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_TEXT = 'jose internals: kid=secret-kid';

let server: Server | undefined;

afterEach(async () => {
  const running = server;
  server = undefined;
  await new Promise<void>((resolve) => {
    if (running === undefined) {
      resolve();
      return;
    }
    running.closeAllConnections();
    running.close(() => resolve());
  });
});

/** The app with `failing` in its protection slot, after the production correlation middleware. */
async function start(
  failing: RequestHandler,
): Promise<{ url: string; logs: Record<string, unknown>[] }> {
  const logs: Record<string, unknown>[] = [];
  const app = createMcpHttpApp({
    createServer: () => new McpServer({ name: 'unused', version: '0.0.0' }),
    protection: [correlationMiddleware(), failing],
    logger: createLogger({
      level: 'debug',
      production: true,
      write: (line) => logs.push(JSON.parse(line) as Record<string, unknown>),
    }),
  });
  const listening = createServer(app);
  server = listening;
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  const { port } = listening.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}${MCP_PATH}`, logs };
}

describe('MCP HTTP app: unexpected failure in the /mcp chain', () => {
  it.each<{ name: string; failing: RequestHandler }>([
    {
      name: 'a handler that throws',
      failing: () => {
        throw new Error(SECRET_TEXT);
      },
    },
    {
      name: 'an async handler that rejects (like the bearer guard)',
      failing: async () => {
        await Promise.resolve();
        throw new Error(SECRET_TEXT);
      },
    },
  ])('answers $name with the correlated 500 INTERNAL envelope', async ({ failing }) => {
    const { url, logs } = await start(failing);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(500);
    const correlationId = response.headers.get('x-correlation-id');
    expect(correlationId).toMatch(UUID);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const text = await response.text();
    expect(text).not.toContain('secret-kid');
    expect(errorEnvelopeSchema.parse(JSON.parse(text))).toEqual({
      code: 'INTERNAL',
      message: expect.any(String) as string,
      correlationId,
    });
    const logged = logs.filter((line) => line['event'] === 'http.unhandled_error');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'error', correlationId });
  });
});
