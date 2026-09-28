/**
 * SEC-02, MCP app (issue #24): the production request protection
 * (mcpRequestProtection) in the app's protection slot, over real HTTP.
 *
 * - It runs for EVERY method on /mcp, before the POST route and the 405
 *   fallback: a forbidden or "null" Origin is 403 on POST, GET, DELETE and
 *   OPTIONS alike (MCP Streamable HTTP: invalid Origin -> 403), and a CORS
 *   preflight from an allowed origin is answered 204.
 * - An allowed origin gets CORS headers on its answers; CORS grants nothing
 *   by itself. A server-to-server call without Origin goes on.
 * - A declared body over the cap is 413 and a chunked body 411, both before
 *   an MCP server is built (no expensive work).
 * - Every rejection carries the server's correlation ID, and nothing is
 *   written: no MCP server built, no draft stored.
 */
import { request } from 'node:http';
import { RICH_WIRE_FIXTURE, cloneFixture } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type RunningMcpServer, startMcpServer } from './support/mcp-harness';

const ALLOWED = 'https://app.example.test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MCP_ACCEPT = 'application/json, text/event-stream';

let server: RunningMcpServer;
let builtBefore: number;

beforeAll(async () => {
  server = await startMcpServer(
    { viewHtml: '<!doctype html><title>View</title>' },
    { protection: { allowedOrigins: [ALLOWED] } },
  );
});

beforeEach(() => {
  builtBefore = server.serversCreated();
});

afterAll(async () => {
  await server?.close();
});

interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/**
 * One HTTP request with exactly these headers. With `body` undefined no body
 * byte is sent, so a declared Content-Length or chunked encoding is answered
 * on the headers alone.
 */
function rawRequest(
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(server.url, { method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
      );
    });
    req.on('error', reject);
    if (body === undefined) {
      req.flushHeaders();
    } else {
      req.end(body);
    }
  });
}

function jsonRpc(method: string, params: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
}

function createScoreCall(): string {
  const score = cloneFixture(RICH_WIRE_FIXTURE) as Record<string, unknown>;
  delete score['id'];
  delete score['revision'];
  return jsonRpc('tools/call', { name: 'create_score', arguments: { score } });
}

function expectTransportError(response: RawResponse, status: number, code: string): void {
  expect(response.status).toBe(status);
  const correlationId = response.headers['x-correlation-id'];
  expect(correlationId).toMatch(UUID);
  expect(JSON.parse(response.body)).toEqual({
    code,
    message: expect.any(String) as string,
    correlationId,
  });
}

describe('SEC-02 Origin policy on every method of /mcp', () => {
  it.each([
    { method: 'POST', origin: 'https://evil.example', body: createScoreCall() },
    { method: 'POST', origin: 'null', body: createScoreCall() },
    { method: 'GET', origin: 'https://evil.example', body: undefined },
    { method: 'DELETE', origin: 'https://evil.example', body: undefined },
    { method: 'OPTIONS', origin: 'https://evil.example', body: undefined },
  ])(
    '$method with Origin $origin is 403 before any MCP work, without CORS headers',
    async ({ method, origin, body }) => {
      const headers: Record<string, string> = { origin, accept: MCP_ACCEPT };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(Buffer.byteLength(body));
      }
      if (method === 'OPTIONS') {
        headers['access-control-request-method'] = 'POST';
      }

      const response = await rawRequest(method, headers, body);

      expectTransportError(response, 403, 'FORBIDDEN_ORIGIN');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(server.serversCreated()).toBe(builtBefore);
      expect(server.stores.draftCount).toBe(0);
    },
  );

  it('answers a preflight from an allowed origin with 204 and the configured CORS policy', async () => {
    const response = await rawRequest('OPTIONS', {
      origin: ALLOWED,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, content-type, mcp-protocol-version',
    });

    expect(response.status).toBe(204);
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': ALLOWED,
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version',
      vary: 'Origin',
    });
    expect(response.body).toBe('');
    expect(server.serversCreated()).toBe(builtBefore);
  });

  it('keeps GET a 405 for an allowed origin, with CORS headers so the browser can read it', async () => {
    const response = await rawRequest('GET', { origin: ALLOWED, accept: MCP_ACCEPT });

    expect(response.status).toBe(405);
    expect(response.headers['allow']).toBe('POST');
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it.each<{ name: string; headers: Record<string, string>; allowOrigin: string | undefined }>([
    { name: 'from an allowed origin', headers: { origin: ALLOWED }, allowOrigin: ALLOWED },
    { name: 'without Origin (a server-to-server call)', headers: {}, allowOrigin: undefined },
  ])('serves a POST $name', async ({ headers, allowOrigin }) => {
    const body = jsonRpc('tools/list', {});
    const response = await rawRequest(
      'POST',
      {
        ...headers,
        accept: MCP_ACCEPT,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
      body,
    );

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(allowOrigin);
    expect(response.headers['x-correlation-id']).toMatch(UUID);
    const tools = (JSON.parse(response.body) as { result: { tools: { name: string }[] } }).result
      .tools;
    expect(tools.map((tool) => tool.name)).toContain('create_score');
    expect(server.serversCreated()).toBe(builtBefore + 1);
  });
});

describe('SEC-02 body cap before any MCP work', () => {
  it('answers a declared body over 512 KiB with 413 and closes the connection', async () => {
    const response = await rawRequest('POST', {
      accept: MCP_ACCEPT,
      'content-type': 'application/json',
      'content-length': String(512 * 1024 + 1),
    });

    expectTransportError(response, 413, 'PAYLOAD_TOO_LARGE');
    expect(response.headers['connection']).toBe('close');
    expect(server.serversCreated()).toBe(builtBefore);
  });

  it('answers a chunked body (no declared length) with 411', async () => {
    const response = await rawRequest('POST', {
      accept: MCP_ACCEPT,
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    });

    expectTransportError(response, 411, 'LENGTH_REQUIRED');
    expect(server.serversCreated()).toBe(builtBefore);
    expect(server.stores.draftCount).toBe(0);
  });
});
