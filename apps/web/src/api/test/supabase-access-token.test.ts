/**
 * #15: `AuthPort.getAccessToken` on the real supabase-js client (fake HTTP
 * layer). The API client sends this value as the Bearer token, so it must be
 * the session's access token (never the refresh token), and null once there
 * is no session.
 */
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseAuthAdapter } from '../../auth/supabaseAuthAdapter';

const SUPABASE_URL = 'https://project.supabase.test';

function unsignedJwt(payload: object): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const ACCESS_TOKEN = unsignedJwt({ sub: 'user-a', exp: expiresAt, role: 'authenticated' });
const SESSION = {
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: expiresAt,
  refresh_token: 'refresh-1',
  user: {
    id: 'user-a',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'alice@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-09-01T00:00:00Z',
  },
};

function connect() {
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = url.pathname === '/auth/v1/token' ? SESSION : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const client = createClient(SUPABASE_URL, 'sb_publishable_test', {
    auth: {
      flowType: 'implicit',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'sb-access-token-test',
    },
    global: { fetch },
  });
  return createSupabaseAuthAdapter({
    auth: client.auth,
    initialUrl: 'http://localhost:5173/library',
    appOrigin: 'http://localhost:5173',
  });
}

describe('AuthPort.getAccessToken (Supabase adapter)', () => {
  it('is null without a session, the access token once signed in, and null after sign-out', async () => {
    const port = connect();
    expect(await port.getAccessToken()).toBeNull();

    expect(await port.signIn({ email: 'alice@example.com', password: 'correct horse' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await port.getAccessToken()).toBe(ACCESS_TOKEN);

    expect((await port.signOut()).ok).toBe(true);
    expect(await port.getAccessToken()).toBeNull();
  });
});
