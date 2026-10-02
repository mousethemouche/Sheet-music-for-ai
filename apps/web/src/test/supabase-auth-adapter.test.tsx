/**
 * AUTH-UI-01/03 adapter side (issue #25): the real supabase-js client, with a
 * fake HTTP layer standing in for Supabase Auth, is translated into the neutral
 * AuthPort results the pages rely on. Catches mapping mistakes the fake-port
 * component tests cannot: a confirmation-required sign-up read as a session,
 * provider errors or messages leaking through, recovery/expired emailed links
 * misread, and consent decisions navigating before the page checks the URL.
 * The real provider flow with a mail sink is AUTH-UI-I01 (cloud phase).
 */
import { createClient } from '@supabase/supabase-js';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthChange, AuthResult } from '../auth/authPort';
import { createSupabaseAuthAdapter } from '../auth/supabaseAuthAdapter';

const SUPABASE_URL = 'https://project.supabase.test';

interface SentRequest {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}
type Route = (request: SentRequest) => Response;

const USER = {
  id: 'user-a',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'alice@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-09-01T00:00:00Z',
};

function unsignedJwt(payload: object): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function sessionBody() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: unsignedJwt({ sub: USER.id, exp: expiresAt, role: 'authenticated' }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'refresh-1',
    user: USER,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let clientCount = 0;
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

/** Real supabase-js client whose HTTP calls go to `route`, wrapped by the adapter. */
function connect(route: Route, pageUrl = 'http://localhost:3000/login') {
  window.history.replaceState(null, '', pageUrl);
  const requests: SentRequest[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const text = typeof init?.body === 'string' ? init.body : null;
    const request = {
      method: init?.method ?? 'GET',
      url,
      body: text ? (JSON.parse(text) as unknown) : null,
    };
    requests.push(request);
    try {
      return Promise.resolve(route(request));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const client = createClient(SUPABASE_URL, 'sb_publishable_test', {
    auth: {
      flowType: 'implicit',
      persistSession: false,
      autoRefreshToken: false,
      // One storage key per client keeps the SDK's multiple-instance warning quiet.
      storageKey: `sb-test-${++clientCount}`,
    },
    global: { fetch },
  });
  const port = createSupabaseAuthAdapter({
    auth: client.auth,
    initialUrl: pageUrl,
    appOrigin: 'http://localhost:3000',
  });
  const changes: AuthChange[] = [];
  const unsubscribe = port.onChange((change) => changes.push(change));
  cleanups.push(unsubscribe);
  return { port, requests, changes };
}

const path = (request: SentRequest) => `${request.method} ${request.url.pathname}`;

async function signedIn(route: Route): Promise<ReturnType<typeof connect>> {
  const connection = connect((request) =>
    path(request) === 'POST /auth/v1/token' ? json(200, sessionBody()) : route(request),
  );
  expect(await connection.port.signIn({ email: USER.email, password: 'pw' })).toEqual({
    ok: true,
    value: undefined,
  });
  return connection;
}

describe('Supabase adapter: sign-up and sign-in results', () => {
  it('reads a sign-up without session as confirmation-required and sends the return link', async () => {
    const { port, requests } = connect(() => json(200, { ...USER, identities: [] }));

    const result = await port.signUp({
      email: USER.email,
      password: 'a long password',
      confirmationPath: '/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Da1',
    });

    expect(result).toEqual({ ok: true, value: 'confirmation-required' });
    expect(await port.getSession()).toBeNull();
    const signUp = requests.find((request) => path(request) === 'POST /auth/v1/signup');
    expect(signUp?.url.searchParams.get('redirect_to')).toBe(
      'http://localhost:3000/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Da1',
    );
  });

  it('reads a sign-up that returns a session as signed-in', async () => {
    const { port } = connect(() => json(200, sessionBody()));

    const result = await port.signUp({
      email: USER.email,
      password: 'a long password',
      confirmationPath: '/login',
    });

    expect(result).toEqual({ ok: true, value: 'signed-in' });
    expect(await port.getSession()).toEqual({ user: { id: USER.id, email: USER.email } });
  });

  it('refuses to send an emailed link that would leave the app', async () => {
    const { port, requests } = connect(() => json(200, USER));

    const result = await port.signUp({
      email: USER.email,
      password: 'a long password',
      confirmationPath: '//evil.example/login',
    });

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(requests.filter((request) => path(request) === 'POST /auth/v1/signup')).toHaveLength(0);
  });

  it.each<{ name: string; route: Route; expected: AuthResult<void> }>([
    {
      name: 'wrong credentials',
      route: () =>
        json(400, {
          code: 400,
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        }),
      expected: { ok: false, error: 'invalid-credentials' },
    },
    {
      name: 'an unconfirmed email',
      route: () =>
        json(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }),
      expected: { ok: false, error: 'email-not-confirmed' },
    },
    {
      name: 'rate limiting',
      route: () =>
        json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Rate limit hit' }),
      expected: { ok: false, error: 'rate-limited' },
    },
    {
      name: 'a provider outage',
      route: () => json(503, { msg: 'upstream db at 10.0.0.12 unavailable' }),
      expected: { ok: false, error: 'unavailable' },
    },
    {
      name: 'a network failure',
      route: () => {
        throw new TypeError('Failed to fetch');
      },
      expected: { ok: false, error: 'network' },
    },
  ])('maps $name to a neutral code without the provider message', async ({ route, expected }) => {
    const { port } = connect(route);

    const result = await port.signIn({ email: USER.email, password: 'wrong' });

    expect(result).toEqual(expected);
  });
});

describe('Supabase adapter: emailed links', () => {
  it('recognises a valid recovery link and restores its session', async () => {
    const session = sessionBody();
    const fragment = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: '3600',
      expires_at: String(session.expires_at),
      token_type: 'bearer',
      type: 'recovery',
    });
    const { port, changes } = connect(
      (request) => (path(request) === 'GET /auth/v1/user' ? json(200, USER) : json(404, {})),
      `http://localhost:3000/reset-password#${fragment.toString()}`,
    );

    expect(await port.getRedirectResult()).toEqual({ kind: 'password-recovery' });
    expect(await port.getSession()).toEqual({ user: { id: USER.id, email: USER.email } });
    await waitFor(() => expect(changes).toContain('password-recovery'));
  });

  it('does not treat an email confirmation link as a recovery link', async () => {
    const session = sessionBody();
    const fragment = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: '3600',
      expires_at: String(session.expires_at),
      token_type: 'bearer',
      type: 'signup',
    });
    const { port } = connect(
      (request) => (path(request) === 'GET /auth/v1/user' ? json(200, USER) : json(404, {})),
      `http://localhost:3000/login#${fragment.toString()}`,
    );

    expect(await port.getRedirectResult()).toEqual({ kind: 'none' });
    expect(await port.getSession()).toEqual({ user: { id: USER.id, email: USER.email } });
  });

  it.each([
    { name: 'expired', errorCode: 'otp_expired', reason: 'expired' },
    { name: 'invalid', errorCode: 'bad_jwt', reason: 'invalid' },
  ])('reports an $name link and creates no session', async ({ errorCode, reason }) => {
    const fragment = new URLSearchParams({
      error: 'access_denied',
      error_code: errorCode,
      error_description: 'Email link is invalid or has expired',
    });
    const { port } = connect(
      () => json(404, {}),
      `http://localhost:3000/reset-password#${fragment.toString()}`,
    );

    expect(await port.getRedirectResult()).toEqual({ kind: 'link-error', reason });
    expect(await port.getSession()).toBeNull();
  });
});

describe('Supabase adapter: OAuth consent', () => {
  const DETAILS = {
    authorization_id: 'auth-123',
    redirect_uri: 'https://ai.example/callback',
    client: { id: 'c1', name: 'Example AI', uri: 'https://ai.example', logo_uri: '' },
    user: { id: USER.id, email: USER.email },
    scope: 'openid email',
  };

  it('maps authorization details to a consent request', async () => {
    const { port } = await signedIn((request) =>
      path(request) === 'GET /auth/v1/oauth/authorizations/auth-123'
        ? json(200, DETAILS)
        : json(404, {}),
    );

    expect(await port.getOAuthAuthorization('auth-123')).toEqual({
      ok: true,
      value: {
        kind: 'consent-required',
        request: {
          authorizationId: 'auth-123',
          clientName: 'Example AI',
          clientUri: 'https://ai.example',
          redirectUri: 'https://ai.example/callback',
          scopes: ['openid', 'email'],
        },
      },
    });
  });

  it('maps an already-consented request to a redirect', async () => {
    const { port } = await signedIn(() =>
      json(200, { redirect_url: 'https://ai.example/callback?code=c2' }),
    );

    expect(await port.getOAuthAuthorization('auth-123')).toEqual({
      ok: true,
      value: { kind: 'redirect', redirectUrl: 'https://ai.example/callback?code=c2' },
    });
  });

  it('records a decision and leaves the navigation to the page', async () => {
    // A same-document URL: if the SDK redirected the browser itself, jsdom
    // would follow this fragment change and the page URL would change.
    const redirectUrl = 'http://localhost:3000/login#decided';
    const { port, requests } = await signedIn((request) =>
      path(request) === 'POST /auth/v1/oauth/authorizations/auth-123/consent'
        ? json(200, { redirect_url: redirectUrl })
        : json(404, {}),
    );
    const before = window.location.href;

    const result = await port.decideOAuthAuthorization('auth-123', 'deny');

    expect(result).toEqual({ ok: true, value: { redirectUrl } });
    expect(requests.at(-1)?.body).toEqual({ action: 'deny' });
    expect(window.location.href).toBe(before);
  });

  it('reports an unknown authorization request as not found', async () => {
    const { port } = await signedIn(() =>
      json(404, { code: 404, error_code: 'oauth_authorization_not_found', msg: 'not found' }),
    );

    expect(await port.getOAuthAuthorization('gone')).toEqual({ ok: false, error: 'not-found' });
  });
});
