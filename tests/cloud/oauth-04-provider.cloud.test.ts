/**
 * OAUTH-04 (#26), provider part: the real Supabase OAuth 2.1 server, the
 * DEPLOYED web consent page and the DEPLOYED MCP server, driven the way an
 * MCP host drives them. Opt-in: runs only with CLOUD_E2E=1 and the variables
 * of support/env.ts, under `--project cloud`. The host part (claude.ai) is
 * the human recipe docs/release/HOST_CHECK.md; the local test issuer of the
 * integration suites is not provider evidence.
 *
 *   401 challenge -> protected resource metadata (RFC 9728) -> authorization
 *   server metadata (RFC 8414) -> client (dynamic registration, or the
 *   pre-registered client) -> authorization details readable (#2820 probe)
 *   -> deny on the consent page: access_denied, no code
 *   -> approve (sign-in first): code -> token (PKCE) -> aud holds the MCP
 *   resource (Custom Access Token Hook) -> initialize, tools/list,
 *   create_score -> save_score, listed by GET /scores for the same account
 *   -> web session token refused at /mcp, OAuth token refused by the API
 *   -> refresh keeps the audience and is accepted
 *
 * A step the provider blocks fails once with its diagnosis (for example
 * supabase/auth#2820, or the hook not configured); the steps that need it are
 * skipped with that reason. The synthetic user, the registered clients and
 * the user's scores are deleted in afterAll. Tokens are never printed.
 */
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oauthSmokeGate, readyConfig } from './support/env';
import { asObject, parseJson, problem, problemOf, request, stringField } from './support/http';
import { type SyntheticIdentity, syntheticIdentity } from './support/identity';
import {
  audiences,
  authorizationServerMetadataUrl,
  authorizeUrl,
  jwtClaims,
  newPkce,
  newState,
  tokenRequest,
} from './support/oauth';
import { createSteps, recordEvidence } from './support/steps';
import {
  type SessionTokens,
  createConfirmedUser,
  deleteOAuthClient,
  deleteUser,
  passwordSession,
  registerOAuthClientAsAdmin,
} from './support/supabase';
import {
  STEP_TIMEOUT_MS,
  captureRedirects,
  launchBrowser,
  signIn,
  submitSignIn,
  waitForHeading,
} from './support/web';
import {
  F01,
  type RawResponse,
  createScoreOutputSchema,
  listScoresResponseSchema,
  postJsonRpc,
  protectedResourceMetadataUrl,
  saveScoreOutputSchema,
  scoreArgument,
} from './support/workspace';

const PRODUCT_TOOLS = ['create_score', 'edit_score', 'get_score', 'save_score', 'search_scores'];
/** The protocol revision the pinned SDK (1.30.1) initializes with. */
const PROTOCOL_VERSION = '2025-11-25';

interface Client {
  readonly id: string;
  readonly secret: string | null;
  /** Known when this run registered it; a pre-registered client's name is not. */
  readonly name: string | null;
  readonly registeredHere: boolean;
}

interface Flow {
  /**
   * The scope a host following our metadata requests: CLOUD_E2E_OAUTH_SCOPE
   * when set; otherwise none, plus `offline_access` when the authorization
   * server advertises it (claude.ai appends it then).
   */
  scope?: string | null;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string | null;
  client?: Client;
  code?: string;
  verifier?: string;
  accessToken?: string;
  refreshToken?: string;
  scoreId?: string;
}

function known<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is not known yet`);
  return value;
}

/** The `result` of a JSON-RPC answer; a JSON-RPC error is thrown with its code and message. */
function rpcResult(response: RawResponse): Record<string, unknown> {
  const body = asObject(parseJson(response.text), 'JSON-RPC answer');
  if (body['error'] !== undefined) {
    const error = asObject(body['error'], 'JSON-RPC error');
    throw new Error(`JSON-RPC error ${String(error['code'])}: ${String(error['message'])}`);
  }
  return asObject(body['result'], 'JSON-RPC result');
}

/** The tool error envelope text of a failed tools/call (safe: code, message, correlation ID). */
function toolErrorText(result: Readonly<Record<string, unknown>>): string {
  const content = result['content'];
  const first: unknown = Array.isArray(content) ? content[0] : undefined;
  return first !== null && typeof first === 'object' && 'text' in first
    ? String(first.text)
    : 'no text';
}

const gate = oauthSmokeGate(process.env);

describe.skipIf(gate.kind === 'off')(
  'OAUTH-04 provider interoperability: real Supabase OAuth 2.1 flow to the deployed MCP',
  () => {
    if (gate.kind === 'invalid') {
      it('cloud configuration is complete', () => {
        throw new Error(gate.reason);
      });
    }
    const { step } = createSteps(
      gate.kind === 'invalid' ? 'the cloud configuration is invalid' : null,
    );
    const config = () => readyConfig(gate);
    const flow: Flow = {};

    let browser: Browser | undefined;
    let identity: SyntheticIdentity;
    let userId: string | undefined;
    let session: SessionTokens;

    beforeAll(async () => {
      if (gate.kind !== 'ready') return;
      identity = syntheticIdentity(gate.config.mailbox, 'oauth04', new Date());
      userId = await createConfirmedUser(gate.config, identity.email, identity.password);
      session = await passwordSession(gate.config, identity.email, identity.password);
      browser = await launchBrowser();
    });

    afterAll(async () => {
      if (gate.kind !== 'ready') return;
      await browser?.close();
      if (flow.client?.registeredHere) await deleteOAuthClient(gate.config, flow.client.id);
      if (userId !== undefined) await deleteUser(gate.config, userId);
    });

    function consentHeading(): string | RegExp {
      const name = flow.client?.name;
      return name ? `Allow ${name} to use your account?` : /^Allow .+ to use your account\?$/;
    }

    function authorizeFor(
      client: Client,
      resource: string | null,
      pkceChallenge: string,
      state: string,
    ): string {
      const cfg = config();
      return authorizeUrl(known(flow.authorizationEndpoint, 'authorization endpoint'), {
        clientId: client.id,
        redirectUri: cfg.redirectUri,
        challenge: pkceChallenge,
        state,
        resource,
        scope: known(flow.scope, 'requested scope'),
      });
    }

    /**
     * What a consent page would get for one authorization request: the
     * authorize redirect, then GET /oauth/authorizations/{id} with the
     * user's web session (the call supabase/auth#2820 reports failing).
     */
    async function probeDetails(
      client: Client,
      resource: string | null,
    ): Promise<{ status: string; consentUrl: URL | null }> {
      const cfg = config();
      const authorize = await request(
        authorizeFor(client, resource, newPkce().challenge, newState()),
      );
      const location = authorize.headers.get('location');
      if (location === null) return { status: `authorize ${problem(authorize)}`, consentUrl: null };
      const consentUrl = new URL(location, cfg.issuer);
      const authorizationId = consentUrl.searchParams.get('authorization_id');
      if (authorizationId === null) {
        return {
          status: `authorize redirected without authorization_id (error=${consentUrl.searchParams.get('error') ?? 'none'})`,
          consentUrl,
        };
      }
      const details = await request(
        `${cfg.issuer}/oauth/authorizations/${encodeURIComponent(authorizationId)}`,
        {
          headers: {
            apikey: cfg.publishableKey,
            authorization: `Bearer ${session.accessToken}`,
            accept: 'application/json',
          },
        },
      );
      return { status: problem(details), consentUrl };
    }

    step(
      'the deployed MCP answers an unauthenticated request with the 401 challenge and publishes its protected resource metadata',
      { provides: 'resource-metadata' },
      async () => {
        const cfg = config();
        const metadataUrl = protectedResourceMetadataUrl(cfg.mcpUrl);
        const unauthenticated = await postJsonRpc(cfg.mcpUrl, { method: 'tools/list' });
        expect(unauthenticated.status).toBe(401);
        expect(unauthenticated.headers.get('www-authenticate')).toContain(
          `resource_metadata="${metadataUrl}"`,
        );

        const metadata = await request(metadataUrl, { headers: { accept: 'application/json' } });
        expect(metadata.status, problem(metadata)).toBe(200);
        const document = asObject(parseJson(metadata.text), 'protected resource metadata');
        expect(document['resource']).toBe(cfg.mcpUrl);
        expect(document['authorization_servers']).toEqual([cfg.issuer]);
        expect(document['bearer_methods_supported']).toEqual(['header']);
      },
    );

    step(
      'the authorization server metadata (RFC 8414) offers the authorization code flow with S256 PKCE',
      { needs: ['resource-metadata'], provides: 'server-metadata' },
      async (context) => {
        const cfg = config();
        const metadata = await request(authorizationServerMetadataUrl(cfg.issuer), {
          headers: { accept: 'application/json' },
        });
        expect(metadata.status, problem(metadata)).toBe(200);
        const document = asObject(parseJson(metadata.text), 'authorization server metadata');
        expect(document['issuer']).toBe(cfg.issuer);
        expect(document['response_types_supported']).toContain('code');
        expect(document['code_challenge_methods_supported']).toContain('S256');
        flow.authorizationEndpoint = stringField(document, 'authorization_endpoint', 'metadata');
        flow.tokenEndpoint = stringField(document, 'token_endpoint', 'metadata');
        const registration = document['registration_endpoint'];
        flow.registrationEndpoint = typeof registration === 'string' ? registration : null;
        await recordEvidence(
          context,
          'dynamic client registration',
          flow.registrationEndpoint ? 'enabled' : 'disabled',
        );
        const scopesSupported = document['scopes_supported'];
        const advertisesOfflineAccess =
          Array.isArray(scopesSupported) && scopesSupported.includes('offline_access');
        flow.scope = cfg.scope ?? (advertisesOfflineAccess ? 'offline_access' : null);
        await recordEvidence(context, 'scopes_supported', JSON.stringify(scopesSupported ?? null));
        await recordEvidence(context, 'requested scope', flow.scope ?? '(none)');
      },
    );

    step(
      'an OAuth client is available: a public client registered dynamically, or the pre-registered client',
      { needs: ['server-metadata'], provides: 'client' },
      async (context) => {
        const cfg = config();
        if (cfg.preRegisteredClient !== null) {
          flow.client = { ...cfg.preRegisteredClient, name: null, registeredHere: false };
          await recordEvidence(
            context,
            'client',
            `pre-registered ${cfg.preRegisteredClient.secret === null ? 'public' : 'confidential'} client`,
          );
          return;
        }
        if (!flow.registrationEndpoint) {
          throw new Error(
            'Dynamic client registration is disabled and CLOUD_E2E_OAUTH_CLIENT_ID is not set: hosts that register themselves cannot connect.',
          );
        }
        const name = `Sheet Music release smoke ${identity.tag}`;
        const registered = await request(flow.registrationEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            client_name: name,
            redirect_uris: [cfg.redirectUri],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          }),
        });
        expect(registered.status, problem(registered)).toBe(201);
        const body = asObject(parseJson(registered.text), 'registration response');
        flow.client = {
          id: stringField(body, 'client_id', 'registration response'),
          secret: null,
          name,
          registeredHere: true,
        };
        expect(body['client_type']).toBe('public');
        await recordEvidence(context, 'client', 'public client from dynamic registration');
      },
    );

    step(
      'a host-shaped authorization request reaches the web consent page and its details are readable (supabase/auth#2820)',
      { needs: ['client'], provides: 'details-readable' },
      async (context) => {
        const cfg = config();
        const client = known(flow.client, 'client');
        const withResource = await probeDetails(client, cfg.mcpUrl);
        const withoutResource = await probeDetails(client, null);
        const kind = client.secret === null ? 'public' : 'confidential';
        const matrix = `${kind} client with resource: ${withResource.status}; without resource: ${withoutResource.status}`;
        await recordEvidence(context, '#2820 probe', matrix);

        if (client.secret === null) {
          // Diagnostic for the release decision: would a pre-registered
          // confidential client (claude.ai accepts a client ID and secret) work?
          try {
            const confidential = await registerOAuthClientAsAdmin(cfg, {
              name: `Sheet Music release smoke probe ${identity.tag}`,
              redirectUri: cfg.redirectUri,
              confidential: true,
            });
            try {
              const probeClient: Client = { ...confidential, name: null, registeredHere: true };
              const a = await probeDetails(probeClient, cfg.mcpUrl);
              const b = await probeDetails(probeClient, null);
              await recordEvidence(
                context,
                '#2820 probe (confidential)',
                `with resource: ${a.status}; without resource: ${b.status}`,
              );
            } finally {
              await deleteOAuthClient(cfg, confidential.id);
            }
          } catch (error) {
            await recordEvidence(
              context,
              '#2820 probe (confidential)',
              `not run: ${String(error)}`,
            );
          }
        }

        const consentUrl = withResource.consentUrl;
        expect(consentUrl?.origin, 'Site URL = the web app').toBe(cfg.webBaseUrl);
        expect(consentUrl?.pathname, 'Authorization Path').toBe('/oauth/consent');
        expect(
          withResource.status,
          `BLOCKED: the consent page cannot read this host-shaped request (supabase/auth#2820?). ${matrix}`,
        ).toBe('HTTP 200');
      },
    );

    step(
      'deny: refusing on the consent page returns access_denied to the client, with no code',
      { needs: ['details-readable'] },
      async () => {
        const cfg = config();
        const client = known(flow.client, 'client');
        const context = await known(browser, 'browser').newContext();
        try {
          const redirects = await captureRedirects(context, cfg.redirectUri);
          const page = await context.newPage();
          await signIn(page, cfg.webBaseUrl, identity.email, identity.password);
          await waitForHeading(page, 'Your library');
          const state = newState();
          await page.goto(authorizeFor(client, cfg.mcpUrl, newPkce().challenge, state));
          await waitForHeading(page, consentHeading());
          await page.getByRole('button', { name: 'Deny', exact: true }).click();
          const redirect = await redirects.next();
          expect(redirect.searchParams.get('error')).toBe('access_denied');
          expect(redirect.searchParams.get('state') === state, 'state echoed').toBe(true);
          expect(redirect.searchParams.has('code'), 'no authorization code').toBe(false);
        } finally {
          await context.close();
        }
      },
    );

    step(
      'approve: a signed-out user signs in from the consent redirect, allows, and the client gets a code',
      { needs: ['details-readable'], provides: 'code' },
      async () => {
        const cfg = config();
        const client = known(flow.client, 'client');
        const context = await known(browser, 'browser').newContext();
        try {
          const redirects = await captureRedirects(context, cfg.redirectUri);
          const page = await context.newPage();
          const pkce = newPkce();
          const state = newState();
          await page.goto(authorizeFor(client, cfg.mcpUrl, pkce.challenge, state));
          await page.waitForURL(
            (url) =>
              url.pathname === '/login' &&
              (url.searchParams.get('next') ?? '').startsWith('/oauth/consent?authorization_id='),
            { timeout: STEP_TIMEOUT_MS },
          );
          await submitSignIn(page, identity.email, identity.password);
          await waitForHeading(page, consentHeading());
          await page.getByRole('button', { name: 'Allow', exact: true }).click();
          const redirect = await redirects.next();
          expect(redirect.searchParams.get('error')).toBeNull();
          expect(redirect.searchParams.get('state') === state, 'state echoed').toBe(true);
          const code = redirect.searchParams.get('code');
          expect(code !== null && code !== '', 'an authorization code').toBe(true);
          flow.code = code ?? undefined;
          flow.verifier = pkce.verifier;
        } finally {
          await context.close();
        }
      },
    );

    step(
      'token exchange: the code with its PKCE verifier gives an access token and a refresh token',
      { needs: ['code'], provides: 'token' },
      async (context) => {
        const cfg = config();
        const answer = await tokenRequest(
          known(flow.tokenEndpoint, 'token endpoint'),
          known(flow.client, 'client'),
          {
            grant_type: 'authorization_code',
            code: known(flow.code, 'code'),
            redirect_uri: cfg.redirectUri,
            code_verifier: known(flow.verifier, 'verifier'),
            resource: cfg.mcpUrl,
          },
        );
        expect(answer.status, problem(answer)).toBe(200);
        const body = asObject(parseJson(answer.text), 'token response');
        expect(String(body['token_type']).toLowerCase()).toBe('bearer');
        flow.accessToken = stringField(body, 'access_token', 'token response');
        const refresh = body['refresh_token'];
        flow.refreshToken = typeof refresh === 'string' && refresh !== '' ? refresh : undefined;
        await recordEvidence(context, 'refresh token issued', flow.refreshToken ? 'yes' : 'no');
        await recordEvidence(context, 'expires_in', String(body['expires_in']));
        await recordEvidence(context, 'granted scope', JSON.stringify(body['scope'] ?? null));
      },
    );

    step(
      'the access token names the user and the client, and its aud holds the MCP resource (Custom Access Token Hook)',
      { needs: ['token'] },
      async (context) => {
        const cfg = config();
        const claims = jwtClaims(known(flow.accessToken, 'access token'));
        await recordEvidence(context, 'aud', JSON.stringify(audiences(claims)));
        expect(claims['iss']).toBe(cfg.issuer);
        expect(claims['sub'], 'the same user as the web account').toBe(userId);
        expect(claims['client_id']).toBe(known(flow.client, 'client').id);
        expect(claims['role']).toBe('authenticated');
        expect(
          audiences(claims),
          'release gate AUTH_MCP_OAUTH.md §4: the hook must add the canonical MCP resource to aud',
        ).toContain(cfg.mcpUrl);
      },
    );

    step(
      'the deployed MCP accepts the OAuth token: initialize, tools/list and create_score',
      { needs: ['token'], provides: 'mcp-accepts' },
      async (context) => {
        const cfg = config();
        const auth = { authorization: `Bearer ${known(flow.accessToken, 'access token')}` };
        const initialize = await postJsonRpc(
          cfg.mcpUrl,
          {
            method: 'initialize',
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: 'sheet-music-release-smoke', version: '1.0.0' },
            },
          },
          auth,
        );
        expect(initialize.status, problemOf(initialize.status, initialize.text)).toBe(200);
        const negotiated = String(rpcResult(initialize)['protocolVersion']);
        await recordEvidence(context, 'negotiated protocol', negotiated);
        const headers = { ...auth, 'mcp-protocol-version': negotiated };

        const listed = await postJsonRpc(cfg.mcpUrl, { method: 'tools/list' }, headers);
        expect(listed.status).toBe(200);
        const tools = rpcResult(listed)['tools'];
        const names = Array.isArray(tools)
          ? tools.map((tool) => String(asObject(tool, 'tool')['name'])).sort()
          : [];
        expect(names).toEqual(PRODUCT_TOOLS);

        const created = await postJsonRpc(
          cfg.mcpUrl,
          {
            method: 'tools/call',
            params: { name: 'create_score', arguments: { score: scoreArgument(F01) } },
          },
          headers,
        );
        expect(created.status).toBe(200);
        expect(created.headers.get('cache-control')).toContain('no-store');
        const result = rpcResult(created);
        expect(result['isError'] === true ? toolErrorText(result) : 'success').toBe('success');
        const output = createScoreOutputSchema.parse(result['structuredContent']);
        expect(output.artifact.state).toBe('draft');
        expect(output.artifact.revision).toBe(1);
        flow.scoreId = output.artifact.scoreId;
      },
    );

    step(
      'one account on both transports: a score saved through the MCP is listed by GET /scores for the web session',
      { needs: ['mcp-accepts'] },
      async () => {
        const cfg = config();
        const scoreId = known(flow.scoreId, 'score ID');
        const saved = await postJsonRpc(
          cfg.mcpUrl,
          {
            method: 'tools/call',
            params: {
              name: 'save_score',
              arguments: {
                scoreId,
                expectedRevision: 1,
                title: `Release smoke ${identity.tag}`,
                tags: ['release-smoke'],
              },
            },
          },
          {
            authorization: `Bearer ${known(flow.accessToken, 'access token')}`,
            'mcp-protocol-version': PROTOCOL_VERSION,
          },
        );
        expect(saved.status).toBe(200);
        const result = rpcResult(saved);
        expect(result['isError'] === true ? toolErrorText(result) : 'success').toBe('success');
        expect(saveScoreOutputSchema.parse(result['structuredContent']).outcome).toBe('saved');

        const listed = await request(`${cfg.apiBaseUrl}/scores`, {
          headers: { authorization: `Bearer ${session.accessToken}`, accept: 'application/json' },
        });
        expect(listed.status, problem(listed)).toBe(200);
        const page = listScoresResponseSchema.parse(parseJson(listed.text));
        expect(page.items.map((item) => item.scoreId)).toEqual([scoreId]);
      },
    );

    step(
      'a web session token (no client_id, aud "authenticated") is refused at /mcp with the invalid_token challenge',
      {},
      async () => {
        const cfg = config();
        const refused = await postJsonRpc(
          cfg.mcpUrl,
          { method: 'tools/list' },
          { authorization: `Bearer ${session.accessToken}` },
        );
        expect(refused.status).toBe(401);
        const challenge = refused.headers.get('www-authenticate') ?? '';
        expect(challenge).toContain('error="invalid_token"');
        expect(challenge).toContain(
          `resource_metadata="${protectedResourceMetadataUrl(cfg.mcpUrl)}"`,
        );
      },
    );

    step(
      'the OAuth token is refused by the REST API (session-only client binding)',
      { needs: ['token'] },
      async () => {
        const cfg = config();
        const refused = await request(`${cfg.apiBaseUrl}/scores`, {
          headers: {
            authorization: `Bearer ${known(flow.accessToken, 'access token')}`,
            accept: 'application/json',
          },
        });
        expect(refused.status, problem(refused)).toBe(401);
      },
    );

    step(
      'refresh: the refresh token gives a new access token that keeps the MCP audience and is accepted by the MCP',
      { needs: ['token'] },
      async (context) => {
        const cfg = config();
        const client = known(flow.client, 'client');
        const tokenEndpoint = known(flow.tokenEndpoint, 'token endpoint');
        const refreshToken = known(flow.refreshToken, 'refresh token (none was issued)');
        const refreshed = await tokenRequest(tokenEndpoint, client, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          resource: cfg.mcpUrl,
        });
        expect(refreshed.status, problem(refreshed)).toBe(200);
        const body = asObject(parseJson(refreshed.text), 'refresh response');
        const accessToken = stringField(body, 'access_token', 'refresh response');
        const rotated = body['refresh_token'];
        await recordEvidence(
          context,
          'refresh token rotated',
          typeof rotated === 'string' && rotated !== refreshToken ? 'yes' : 'no',
        );
        await recordEvidence(context, 'refreshed expires_in', String(body['expires_in']));
        expect(audiences(jwtClaims(accessToken)), 'the hook also runs on refresh').toContain(
          cfg.mcpUrl,
        );

        const listed = await postJsonRpc(
          cfg.mcpUrl,
          { method: 'tools/list' },
          { authorization: `Bearer ${accessToken}` },
        );
        expect(listed.status).toBe(200);

        const replay = await tokenRequest(tokenEndpoint, client, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          resource: cfg.mcpUrl,
        });
        await recordEvidence(context, 'replayed old refresh token', `HTTP ${replay.status}`);
      },
    );
  },
);
