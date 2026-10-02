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
import { type AddressInfo, connect } from 'node:net';
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

/**
 * Every POST answered 400 is one `mcp.bad_request` warning (MCP_SERVER.md §1),
 * correlated, with the classified reason and, when they have the expected
 * shape, the JSON-RPC method and the `MCP-Protocol-Version` header: enough to
 * tell a host's protocol probe from a broken client, and never the body, the
 * params or a credential.
 */
describe('MCP HTTP app: 400 answers are logged without request content', () => {
  const SECRET_PARAM = 'param-secret-kid';
  const SECRET_BEARER = 'bearer-secret-value';

  async function post(
    body: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; correlationId: string | null; logs: Record<string, unknown>[] }> {
    const { url, logs } = await start((_req, _res, next) => next());
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body,
    });
    await response.text();
    return {
      status: response.status,
      correlationId: response.headers.get('x-correlation-id'),
      logs,
    };
  }

  const badRequests = (logs: Record<string, unknown>[]): Record<string, unknown>[] =>
    logs.filter((line) => line['event'] === 'mcp.bad_request');

  it.each<{ name: string; body: string; headers?: Record<string, string>; logged: object }>([
    {
      name: 'malformed JSON',
      body: '{"jsonrpc":',
      logged: { reason: 'parse_error' },
    },
    {
      name: 'an empty body (Content-Length 0, read as {})',
      body: '',
      logged: { reason: 'invalid_jsonrpc' },
    },
    {
      name: 'a JSON-RPC batch',
      body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]),
      logged: { reason: 'batch' },
    },
    {
      name: 'JSON that is not a JSON-RPC message',
      body: JSON.stringify({ method: 'tools/list', hello: 'world' }),
      logged: { reason: 'invalid_jsonrpc', rpcMethod: 'tools/list' },
    },
    {
      name: 'a protocol version the SDK does not support (a newer client probing first)',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      headers: { 'mcp-protocol-version': '2026-07-28' },
      logged: {
        reason: 'unsupported_protocol_version',
        rpcMethod: 'tools/list',
        protocolVersion: '2026-07-28',
      },
    },
    {
      name: 'a method and a protocol version of an unexpected shape',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list\nforged entry' }),
      headers: { 'mcp-protocol-version': 'draft <x>' },
      logged: {
        reason: 'unsupported_protocol_version',
        rpcMethod: 'other',
        protocolVersion: 'other',
      },
    },
  ])('logs $name once, with the correlation ID', async ({ body, headers, logged }) => {
    const { status, correlationId, logs } = await post(body, headers);

    expect(status).toBe(400);
    expect(badRequests(logs)).toEqual([
      {
        time: expect.any(String) as string,
        level: 'warn',
        event: 'mcp.bad_request',
        correlationId,
        ...logged,
      },
    ]);
  });

  it('logs a POST without any body (no Content-Length, no Transfer-Encoding)', async () => {
    const { url, logs } = await start((_req, _res, next) => next());
    const { host, pathname } = new URL(url);
    const [hostname = '', port = ''] = host.split(':');
    const head = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(port), hostname, () => {
        socket.end(
          [
            `POST ${pathname} HTTP/1.1`,
            `Host: ${host}`,
            'Content-Type: application/json',
            'Accept: application/json, text/event-stream',
            'Connection: close',
            '',
            '',
          ].join('\r\n'),
        );
      });
      let received = '';
      socket.on('data', (chunk: Buffer) => (received += chunk.toString('latin1')));
      socket.on('end', () => resolve(received));
      socket.on('error', reject);
    });

    expect(head).toMatch(/^HTTP\/1\.1 400 /);
    expect(badRequests(logs)).toMatchObject([{ level: 'warn', reason: 'empty_body' }]);
  });

  it('never logs the params, the body or the Authorization header', async () => {
    const { status, logs } = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_score', arguments: { scoreId: SECRET_PARAM } },
      }),
      { 'mcp-protocol-version': '2026-07-28', authorization: `Bearer ${SECRET_BEARER}` },
    );

    expect(status).toBe(400);
    expect(badRequests(logs)).toHaveLength(1);
    const text = JSON.stringify(logs);
    expect(text).not.toContain(SECRET_PARAM);
    expect(text).not.toContain(SECRET_BEARER);
  });

  it('logs nothing for a request the transport serves', async () => {
    const { status, logs } = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'app-test', version: '0.0.0' },
        },
      }),
    );

    expect(status).toBe(200);
    expect(badRequests(logs)).toEqual([]);
  });
});
