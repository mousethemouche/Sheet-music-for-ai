/**
 * OAUTH-02 wire, MCP half (issue #26; AUTH_MCP_OAUTH.md §2, §4-§6): the
 * production composition with the bearer guard in front of every method of
 * /mcp, verified by the production verifier against a local ES256 issuer
 * whose JWKS is fetched over loopback HTTP (the production key source).
 *
 * - No token: 401 with `WWW-Authenticate: Bearer resource_metadata="..."`,
 *   an UNAUTHENTICATED envelope, and no MCP processing; the metadata is
 *   public at that URL and names this resource and the Supabase issuer.
 * - A valid resource-bound token reaches the tools as its subject.
 * - Expired, other-resource and web-session tokens (and a token in the query
 *   string) get the same generic challenge; GET/DELETE/OPTIONS/PUT are no
 *   bypass (401 without token, 405 with one).
 * - A JWKS outage is 503 DEPENDENCY_UNAVAILABLE, not a challenge.
 * - Audience policy (§4): an `aud: authenticated` OAuth token is refused by
 *   default and accepted only under the explicit interim override, which
 *   warns at start.
 *
 * The verifier's token matrix is OAUTH-01's (packages/auth-jwt); one
 * representative token per branch here.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { INVALID_TOKEN_DESCRIPTION, type ProtectedResourceMetadata } from '@sheet-music/auth-jwt';
import { TEST_OAUTH_CLIENT_ID, startTestIssuer } from '@sheet-music/auth-jwt/testing';
import { searchScoresOutputSchema } from '@sheet-music/music-contracts';
import { TEST_USER_A } from '@sheet-music/persistence-postgres/testing';
import { F01 } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpTestBackend, openMcpTestBackend, rowCounts } from './support/backend';
import { type RunningMcpApp, startMcpApp } from './support/mcp-harness';
import {
  MCP_ACCEPT,
  type RawResponse,
  UUID,
  callTool,
  httpEnvelopeOf,
  outputOf,
  postJsonRpc,
  scoreArgument,
} from './support/tool-calls';

let backend: McpTestBackend;
let app: RunningMcpApp;

beforeAll(async () => {
  backend = await openMcpTestBackend();
  app = await startMcpApp({ stores: backend.persistence });
});

afterAll(async () => {
  await app?.close();
  await backend?.close();
});

const INITIALIZE = {
  method: 'initialize',
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'oauth-02', version: '0.0.0' },
  },
};

function missingTokenChallenge(): string {
  return `Bearer resource_metadata="${app.metadataUrl}"`;
}

function invalidTokenChallenge(): string {
  return `Bearer resource_metadata="${app.metadataUrl}", error="invalid_token", error_description="${INVALID_TOKEN_DESCRIPTION}"`;
}

/** A 401 answered by the guard: challenge, correlated UNAUTHENTICATED envelope, nothing reached MCP. */
function expectChallenge(response: RawResponse, challenge: string, transportBefore: number): void {
  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toBe(challenge);
  const correlationId = response.headers.get('x-correlation-id');
  expect(correlationId).toMatch(UUID);
  expect(httpEnvelopeOf(response)).toEqual({
    code: 'UNAUTHENTICATED',
    message: 'Authentication is required.',
    correlationId,
  });
  expect(app.transportRequests()).toBe(transportBefore);
}

describe('OAUTH-02 discovery from an unauthenticated request', () => {
  it('answers an initialize without token with 401 and the resource_metadata challenge, before any MCP work', async () => {
    const before = app.transportRequests();

    const response = await postJsonRpc(app.url, INITIALIZE);

    expectChallenge(response, missingTokenChallenge(), before);
  });

  it('serves the metadata publicly at the well-known URL of the resource', async () => {
    expect(app.metadataUrl).toBe(`${app.origin}/.well-known/oauth-protected-resource/mcp`);

    const response = await fetch(app.metadataUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect((await response.json()) as ProtectedResourceMetadata).toEqual({
      resource: `${app.origin}/mcp`,
      authorization_servers: [`${app.issuer.projectUrl}/auth/v1`],
      bearer_methods_supported: ['header'],
      resource_name: 'Sheet Music for AI',
    });
  });
});

describe('OAUTH-02 a valid resource-bound token reaches the tools', () => {
  let client: Client;

  beforeAll(async () => {
    client = await app.connect(await app.token(TEST_USER_A.id));
  });

  afterAll(async () => {
    await client?.close();
  });

  it('initializes, lists the five tools and runs them as the token subject', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);

    const listed = searchScoresOutputSchema.parse(
      outputOf(await callTool(client, 'search_scores', {})),
    );
    expect(listed.page.total).toBe(0);

    outputOf(await callTool(client, 'create_score', { score: scoreArgument(F01) }));
    expect(await rowCounts(backend, TEST_USER_A.id)).toEqual({ drafts: 1, saved: 0 });
  });
});

describe('OAUTH-02 refused tokens: one generic challenge, no MCP work', () => {
  it.each([
    {
      case: 'an expired token',
      reason: 'EXPIRED',
      token: () => app.token(TEST_USER_A.id, { expiresInSeconds: -3600 }),
    },
    {
      case: 'a token issued for another MCP resource',
      reason: 'WRONG_AUDIENCE',
      token: () => app.issuer.mcpToken(TEST_USER_A.id, 'https://other-mcp.example.test/mcp'),
    },
    {
      case: 'a first-party web session token (aud "authenticated", no client_id)',
      reason: 'WRONG_AUDIENCE',
      token: () => app.issuer.sessionToken(TEST_USER_A.id),
    },
  ])(
    '$case is 401 invalid_token, logged as $reason without the token',
    async ({ reason, token }) => {
      const bearer = await token();
      const before = app.transportRequests();
      const logsBefore = app.logs.length;

      const response = await postJsonRpc(app.url, INITIALIZE, {
        authorization: `Bearer ${bearer}`,
      });

      expectChallenge(response, invalidTokenChallenge(), before);
      expect(app.logs.slice(logsBefore)).toContainEqual(
        expect.objectContaining({ event: 'auth.rejected', reason, method: 'POST' }),
      );
      expect(JSON.stringify(app.logs)).not.toContain(bearer);
    },
  );

  it('never reads a token from the query string', async () => {
    const before = app.transportRequests();
    const url = new URL(app.url);
    url.searchParams.set('access_token', await app.token(TEST_USER_A.id));

    const response = await postJsonRpc(url, INITIALIZE);

    expectChallenge(response, missingTokenChallenge(), before);
  });
});

describe('OAUTH-02 every method of /mcp is guarded', () => {
  function request(method: string, headers: Record<string, string> = {}): Promise<RawResponse> {
    return fetch(app.url, { method, headers: { accept: MCP_ACCEPT, ...headers } }).then(
      async (response) => ({
        status: response.status,
        headers: response.headers,
        text: await response.text(),
      }),
    );
  }

  it.each(['GET', 'DELETE', 'OPTIONS', 'PUT'])(
    '%s without token is 401 with the challenge, not 405',
    async (method) => {
      const before = app.transportRequests();

      expectChallenge(await request(method), missingTokenChallenge(), before);
    },
  );

  it.each(['GET', 'DELETE', 'OPTIONS'])(
    '%s with a valid token is still 405 (no session, no stream)',
    async (method) => {
      const token = await app.token(TEST_USER_A.id);

      const response = await request(method, { authorization: `Bearer ${token}` });

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    },
  );
});

describe('OAUTH-02 a key-source outage', () => {
  it('answers 503 DEPENDENCY_UNAVAILABLE without a challenge, and logs it', async () => {
    const issuer = await startTestIssuer();
    const outage = await startMcpApp({ stores: backend.persistence, issuer });
    try {
      const token = await outage.token(TEST_USER_A.id);
      await issuer.stop();

      const response = await postJsonRpc(outage.url, INITIALIZE, {
        authorization: `Bearer ${token}`,
      });

      expect(response.status).toBe(503);
      expect(response.headers.get('www-authenticate')).toBeNull();
      expect(httpEnvelopeOf(response)).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
      expect(outage.logs).toContainEqual(
        expect.objectContaining({
          level: 'error',
          event: 'auth.keys_unavailable',
          reason: 'KEYS_UNAVAILABLE',
        }),
      );
      expect(outage.transportRequests()).toBe(0);
    } finally {
      await outage.close();
      await issuer.stop();
    }
  });
});

describe('OAUTH-02 audience policy (AUTH_MCP_OAUTH.md §4)', () => {
  /** An OAuth token as Supabase issues it without the Custom Access Token Hook. */
  const unboundToken = (target: RunningMcpApp) =>
    target.issuer.mint({ sub: TEST_USER_A.id, clientId: TEST_OAUTH_CLIENT_ID });

  it('refuses by default an OAuth token not bound to this resource (aud "authenticated" only)', async () => {
    const before = app.transportRequests();

    const response = await postJsonRpc(app.url, INITIALIZE, {
      authorization: `Bearer ${await unboundToken(app)}`,
    });

    expectChallenge(response, invalidTokenChallenge(), before);
    expect(app.logs).not.toContainEqual(
      expect.objectContaining({ event: 'auth.interim_audience_mode' }),
    );
  });

  describe('under the explicit interim override', () => {
    let interim: RunningMcpApp;

    beforeAll(async () => {
      interim = await startMcpApp({
        stores: backend.persistence,
        audienceMode: 'interim-authenticated',
      });
    });

    afterAll(async () => {
      await interim?.close();
    });

    it('warns at start', () => {
      expect(interim.logs).toContainEqual(
        expect.objectContaining({ level: 'warn', event: 'auth.interim_audience_mode' }),
      );
    });

    it('accepts the unbound OAuth token', async () => {
      const client = await interim.connect(await unboundToken(interim));
      try {
        expect((await client.listTools()).tools).toHaveLength(5);
      } finally {
        await client.close();
      }
    });

    it('still refuses a web session token (no client_id)', async () => {
      const logsBefore = interim.logs.length;

      const response = await postJsonRpc(interim.url, INITIALIZE, {
        authorization: `Bearer ${await interim.issuer.sessionToken(TEST_USER_A.id)}`,
      });

      expect(response.status).toBe(401);
      expect(interim.logs.slice(logsBefore)).toContainEqual(
        expect.objectContaining({ event: 'auth.rejected', reason: 'CLIENT_NOT_ALLOWED' }),
      );
    });
  });
});
