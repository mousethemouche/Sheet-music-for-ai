/**
 * Browser auth configuration (issue #25): only a Supabase project URL and a
 * PUBLISHABLE key are accepted into the public bundle. A secret, service-role
 * or legacy JWT key is refused at start-up, and the problem never echoes the
 * key. (The bundle secret scan itself is #16.)
 */
import { describe, expect, it } from 'vitest';
import { readWebAuthConfig, type WebEnv } from '../config';

const URL_OK = 'https://abcdefghijklmnop.supabase.co';
// Fake keys, assembled at run time so secret scanners do not flag this file.
const SECRET_KEY = ['sb', 'secret', 'not-a-real-key'].join('_');
const LEGACY_SERVICE_ROLE_JWT = [
  btoa('{"alg":"HS256","typ":"JWT"}'),
  btoa('{"role":"service_role"}'),
  'not-a-signature',
].join('.');

describe('readWebAuthConfig', () => {
  it('accepts a project URL with a publishable key', () => {
    expect(
      readWebAuthConfig({
        VITE_SUPABASE_URL: ` ${URL_OK} `,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
      }),
    ).toEqual({
      ok: true,
      config: { supabaseUrl: URL_OK, publishableKey: 'sb_publishable_abc123' },
    });
  });

  it.each<{ name: string; env: WebEnv; secret?: string }>([
    {
      name: 'a secret key',
      env: { VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: SECRET_KEY },
      secret: SECRET_KEY,
    },
    {
      name: 'a legacy service-role JWT',
      env: { VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: LEGACY_SERVICE_ROLE_JWT },
      secret: LEGACY_SERVICE_ROLE_JWT,
    },
    { name: 'a missing key', env: { VITE_SUPABASE_URL: URL_OK } },
    {
      name: 'a missing URL',
      env: { VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123' },
    },
    {
      name: 'a non-http URL',
      env: {
        VITE_SUPABASE_URL: 'javascript:alert(1)',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
      },
    },
  ])('refuses $name', ({ env, secret }) => {
    const result = readWebAuthConfig(env);

    expect(result.ok).toBe(false);
    if (!result.ok && secret) expect(result.problem).not.toContain(secret);
  });
});
