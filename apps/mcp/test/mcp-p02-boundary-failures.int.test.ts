/**
 * MCP-P02 (#11): boundary failures of the MCP HTTP surface. Malformed bodies,
 * unsupported HTTP methods, unknown methods, tools and resources, and a
 * closed tool input fail cleanly, write nothing and do not crash the server:
 * a valid tool call afterwards succeeds. Tool behavior is #12-#14; request
 * limits and Origin checks are #24; auth is #26.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { type CallToolResult, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { RICH_WIRE_FIXTURE, cloneFixture } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunningMcpServer, connectClient, startMcpServer } from './support/mcp-harness';

let server: RunningMcpServer;
let client: Client;

/** A create_score payload: the rich fixture without its server-assigned id and revision. */
function scorePayload(): Record<string, unknown> {
  const score = cloneFixture(RICH_WIRE_FIXTURE) as Record<string, unknown>;
  delete score['id'];
  delete score['revision'];
  return score;
}

function firstText(result: CallToolResult): string {
  const block = result.content[0];
  if (block?.type !== 'text') {
    throw new Error('Expected a text block');
  }
  return block.text;
}

async function rpcErrorCode(request: Promise<unknown>): Promise<number> {
  const error: unknown = await request.then(
    () => new Error('Expected a JSON-RPC error'),
    (rejection: unknown) => rejection,
  );
  if (!(error instanceof McpError)) {
    throw error;
  }
  return error.code;
}

beforeAll(async () => {
  server = await startMcpServer({ viewHtml: '<!doctype html><title>View</title>' });
  client = await connectClient(server.url);
  // Lets the client check every structuredContent against the published outputSchema.
  await client.listTools();
});

afterAll(async () => {
  await client?.close();
  await server?.close();
});

describe('MCP-P02 malformed HTTP bodies', () => {
  it.each([
    { case: 'malformed JSON', body: '{"jsonrpc": "2.0", "method": ' },
    { case: 'JSON that is not a JSON-RPC message', body: '{"hello": "world"}' },
  ])('answers $case with a 400 JSON-RPC parse error', async ({ body }) => {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: ErrorCode.ParseError },
      id: null,
    });
  });
});

describe('MCP-P02 HTTP methods other than POST', () => {
  it.each(['GET', 'DELETE', 'OPTIONS', 'PUT'])(
    'answers %s with 405 and Allow: POST',
    async (method) => {
      const response = await fetch(server.url, {
        method,
        headers: { accept: 'application/json, text/event-stream' },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(await response.json()).toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
    },
  );
});

describe('MCP-P02 unknown targets', () => {
  it('rejects an unsupported JSON-RPC method with Method not found', async () => {
    const code = await rpcErrorCode(client.listPrompts());
    expect(code).toBe(ErrorCode.MethodNotFound);
  });

  it('rejects an unknown resource URI with Invalid params', async () => {
    const code = await rpcErrorCode(client.readResource({ uri: 'ui://sheet-music/missing' }));
    expect(code).toBe(ErrorCode.InvalidParams);
  });

  it('answers an unknown tool with a tool error', async () => {
    const result = (await client.callTool({
      name: 'delete_score',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/delete_score not found/);
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('MCP-P02 closed tool input', () => {
  it('reports an extra consent flag as INVALID_INPUT from the shared contract, not an SDK message', async () => {
    const result = (await client.callTool({
      name: 'create_score',
      arguments: { score: scorePayload(), confirmed: true },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(firstText(result))).toEqual({
      code: 'INVALID_INPUT',
      message: expect.any(String) as string,
      details: [
        {
          code: 'UNKNOWN_FIELD',
          path: ['confirmed'],
          message: 'Unknown field: this request object is closed.',
        },
      ],
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
    });
  });
});

describe('MCP-P02 no side effect, no crash', () => {
  it('stored nothing for any failed request', () => {
    expect(server.stores.draftCount).toBe(0);
    expect(server.stores.savedCount).toBe(0);
  });

  it('still serves a valid tool call afterwards', async () => {
    const result = (await client.callTool({
      name: 'create_score',
      arguments: { score: scorePayload() },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const artifact = (result.structuredContent as { artifact: Record<string, unknown> }).artifact;
    expect(artifact).toMatchObject({ state: 'draft', revision: 1 });
    expect(artifact['scoreId']).toMatch(/^scr_[0-9a-f-]{36}$/);
    expect(firstText(result)).toContain(
      `Created score ${String(artifact['scoreId'])} at revision 1`,
    );
    expect(server.stores.draftCount).toBe(1);
    expect(server.stores.savedCount).toBe(0);
  });
});
