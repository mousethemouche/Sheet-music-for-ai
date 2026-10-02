/**
 * Reading tool results the way a client does: the SDK client for tool calls
 * (it checks every structuredContent against the published output schema
 * once `listTools()` ran), raw HTTP where a status or header matters, and
 * error envelopes parsed with the shared music-contracts schema.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type ErrorEnvelope, errorEnvelopeSchema } from '@sheet-music/music-contracts';
import { cloneFixture } from '@sheet-music/test-fixtures';

export const MCP_ACCEPT = 'application/json, text/event-stream';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A create_score `score`: a fixture without the server-assigned `id` and `revision`. */
export function scoreArgument(fixture: unknown): Record<string, unknown> {
  const score = cloneFixture(fixture) as Record<string, unknown>;
  delete score['id'];
  delete score['revision'];
  return score;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

export function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (block?.type !== 'text') {
    throw new Error('Expected a text block');
  }
  return block.text;
}

/** The structured output of a successful call. */
export function outputOf<T = Record<string, unknown>>(result: CallToolResult): T {
  if (result.isError === true) {
    throw new Error(`Expected a success, got ${textOf(result)}`);
  }
  return result.structuredContent as T;
}

/** The error envelope of a failed call: isError, no structuredContent, one text block of envelope JSON. */
export function envelopeOf(result: CallToolResult): ErrorEnvelope {
  if (result.isError !== true || result.structuredContent !== undefined) {
    throw new Error(`Expected a tool error, got ${JSON.stringify(result)}`);
  }
  return errorEnvelopeSchema.parse(JSON.parse(textOf(result)));
}

export interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** One JSON-RPC POST to `url` with exactly these extra headers (no MCP session, like a stateless host). */
export async function postJsonRpc(
  url: URL | string,
  message: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: MCP_ACCEPT, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...message }),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

/** tools/call over raw HTTP with a bearer token. */
export function rawToolCall(
  url: URL | string,
  token: string | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<RawResponse> {
  return postJsonRpc(
    url,
    { method: 'tools/call', params: { name, arguments: args } },
    token === undefined ? {} : { authorization: `Bearer ${token}` },
  );
}

/** The error envelope of an HTTP error body. */
export function httpEnvelopeOf(response: RawResponse): ErrorEnvelope {
  return errorEnvelopeSchema.parse(JSON.parse(response.text));
}
