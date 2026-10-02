/**
 * OAUTH-05 Custom Access Token Hook (issue #26, AUTH_MCP_OAUTH.md §4): the
 * migration's auth_hooks.custom_access_token_hook, called the way Supabase
 * Auth calls a Postgres hook (`select "auth_hooks"."custom_access_token_hook"($1)`
 * as supabase_auth_admin, whose search_path is `auth` on Supabase) with events
 * shaped like Supabase Auth's CustomAccessTokenInput.
 *
 * - A token issued to an OAuth client (claims carry `client_id`, on the first
 *   grant and on every refresh) gets aud [authenticated, <MCP resource>];
 *   every other claim is returned as it came, whether aud arrives as a string
 *   or as an array, and an aud that already holds the resource is unchanged.
 * - Web session tokens (no client_id) are returned unchanged.
 * - Fail closed: without the `mcp_resource` setting, or with an allow-list
 *   that does not name the client, every token is returned unchanged, so the
 *   resource-bound MCP verifier refuses it.
 * - Only supabase_auth_admin can execute the hook and read the settings; it
 *   cannot change them. anon, authenticated, service_role and score_owner can
 *   do neither.
 * - The settings accept only a canonical resource URI and a non-empty list of
 *   lowercase client UUIDs, under known keys.
 */
import { escapeIdentifier, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, TEST_USER_A, type TestDatabase } from '../../testing';

const RESOURCE = 'https://mcp.example.test/mcp';
const OAUTH_CLIENT = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const OTHER_CLIENT = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';

type Claims = Record<string, unknown>;
type DatabaseRole =
  'supabase_auth_admin' | 'anon' | 'authenticated' | 'service_role' | 'score_owner';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

beforeEach(async () => {
  await db.admin.query('truncate private.app_settings');
});

afterAll(async () => {
  await db?.close();
});

/** The claims Supabase Auth builds for a web session token of user A (no client_id). */
function sessionClaims(overrides: Claims = {}): Claims {
  return {
    iss: 'https://project-ref.supabase.co/auth/v1',
    sub: TEST_USER_A.id,
    aud: 'authenticated',
    exp: 1790003600,
    iat: 1790000000,
    email: TEST_USER_A.email,
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: 1790000000 }],
    session_id: '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a',
    is_anonymous: false,
    ...overrides,
  };
}

/** The claims of a token the OAuth 2.1 server issues to OAUTH_CLIENT for user A. */
function oauthClaims(overrides: Claims = {}): Claims {
  return sessionClaims({
    amr: [{ method: 'oauth_provider/authorization_code', timestamp: 1790000000 }],
    client_id: OAUTH_CLIENT,
    scope: 'openid email',
    ...overrides,
  });
}

/** A Custom Access Token Hook event (Supabase Auth's CustomAccessTokenInput). */
function hookEvent(claims: Claims, authenticationMethod: string) {
  return {
    metadata: {
      uuid: '7e6d5c4b-3a29-4817-a6f5-e4d3c2b1a098',
      time: '2026-09-29T10:00:00Z',
      name: 'customize-access-token',
      ip_address: '203.0.113.7',
    },
    user_id: TEST_USER_A.id,
    claims,
    authentication_method: authenticationMethod,
  };
}

/** Runs `work` in a transaction as `role`, always rolled back. */
async function asRole<T>(role: DatabaseRole, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.admin.connect();
  let broken: Error | undefined;
  try {
    await client.query('begin');
    await client.query(`set local role ${escapeIdentifier(role)}`);
    if (role === 'supabase_auth_admin') {
      await client.query('set local search_path = auth');
    }
    return await work(client);
  } finally {
    await client.query('rollback').catch((error: unknown) => {
      broken = error instanceof Error ? error : new Error(String(error));
    });
    client.release(broken);
  }
}

/** Calls the hook as Supabase Auth does and returns its output. */
function runHook(event: unknown, role: DatabaseRole = 'supabase_auth_admin'): Promise<unknown> {
  return asRole(role, async (client) => {
    const { rows } = await client.query<{ output: unknown }>(
      'select "auth_hooks"."custom_access_token_hook"($1) as output',
      [JSON.stringify(event)],
    );
    return rows[0]?.output;
  });
}

/** Writes a setting as the migration role (the table owner), as the deployment step does. */
async function setSetting(key: string, value: unknown): Promise<void> {
  await db.admin.query(
    `insert into private.app_settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

async function storedSettings(): Promise<{ key: string; value: unknown }[]> {
  const { rows } = await db.admin.query<{ key: string; value: unknown }>(
    'select key, value from private.app_settings order by key',
  );
  return rows;
}

describe('OAUTH-05 resource binding', () => {
  it('adds the MCP resource to aud for a token issued to an OAuth client and keeps every other claim', async () => {
    await setSetting('mcp_resource', RESOURCE);
    const claims = oauthClaims();

    const output = await runHook(hookEvent(claims, 'oauth_provider/authorization_code'));

    expect(output).toEqual({ claims: { ...claims, aud: ['authenticated', RESOURCE] } });
  });

  it.each([
    { input: 'the string "authenticated"', aud: 'authenticated' },
    { input: 'the array ["authenticated"]', aud: ['authenticated'] },
    { input: 'an array that already holds the resource', aud: ['authenticated', RESOURCE] },
  ])('binds an OAuth token whose aud is $input', async ({ aud }) => {
    await setSetting('mcp_resource', RESOURCE);
    const claims = oauthClaims({ aud });

    const output = await runHook(hookEvent(claims, 'oauth_provider/authorization_code'));

    expect(output).toEqual({ claims: { ...claims, aud: ['authenticated', RESOURCE] } });
  });

  it('binds a refreshed OAuth token too: client_id decides, not the authentication method', async () => {
    await setSetting('mcp_resource', RESOURCE);
    const claims = oauthClaims();

    const output = await runHook(hookEvent(claims, 'token_refresh'));

    expect(output).toEqual({ claims: { ...claims, aud: ['authenticated', RESOURCE] } });
  });

  it.each([
    { token: 'a web session token', claims: sessionClaims(), method: 'password' },
    { token: 'a refreshed web session token', claims: sessionClaims(), method: 'token_refresh' },
    {
      token: 'a token with an empty client_id',
      claims: sessionClaims({ client_id: '' }),
      method: 'password',
    },
    {
      token: 'an OAuth token without aud',
      claims: oauthClaims({ aud: undefined }),
      method: 'oauth_provider/authorization_code',
    },
  ])('returns $token unchanged', async ({ claims, method }) => {
    await setSetting('mcp_resource', RESOURCE);
    const sent = JSON.parse(JSON.stringify(claims)) as Claims;

    const output = await runHook(hookEvent(sent, method));

    expect(output).toEqual({ claims: sent });
  });

  it('returns every token unchanged while mcp_resource is not set (fail closed)', async () => {
    const oauth = oauthClaims();
    const session = sessionClaims();

    expect(await runHook(hookEvent(oauth, 'oauth_provider/authorization_code'))).toEqual({
      claims: oauth,
    });
    expect(await runHook(hookEvent(session, 'password'))).toEqual({ claims: session });
  });

  it('binds only the clients of the allow-list when one is set', async () => {
    await setSetting('mcp_resource', RESOURCE);
    await setSetting('mcp_allowed_client_ids', [OAUTH_CLIENT]);
    const allowed = oauthClaims();
    const other = oauthClaims({ client_id: OTHER_CLIENT });

    expect(await runHook(hookEvent(allowed, 'oauth_provider/authorization_code'))).toEqual({
      claims: { ...allowed, aud: ['authenticated', RESOURCE] },
    });
    expect(await runHook(hookEvent(other, 'oauth_provider/authorization_code'))).toEqual({
      claims: other,
    });
  });
});

describe('OAUTH-05 privileges', () => {
  const ROLES = [
    'anon',
    'authenticated',
    'service_role',
    'public',
    'score_owner',
    'supabase_auth_admin',
  ];

  it('makes the hook SECURITY INVOKER with a fixed search_path, executable by supabase_auth_admin only', async () => {
    const { rows } = await db.admin.query(
      `select p.prosecdef as security_definer,
              p.proconfig as settings,
              array(
                select r from unnest($1::text[]) as r
                where has_function_privilege(r, p.oid, 'EXECUTE')
              ) as executable_by,
              array(
                select r from unnest($1::text[]) as r
                where has_schema_privilege(r, 'auth_hooks', 'USAGE')
              ) as schema_usage,
              array(
                select r from unnest($1::text[]) as r
                where has_schema_privilege(r, 'auth_hooks', 'CREATE')
              ) as schema_create
       from pg_proc p
       where p.oid = 'auth_hooks.custom_access_token_hook(jsonb)'::regprocedure`,
      [ROLES],
    );
    expect(rows).toEqual([
      {
        security_definer: false,
        settings: ['search_path=""'],
        executable_by: ['supabase_auth_admin'],
        schema_usage: ['supabase_auth_admin'],
        schema_create: [],
      },
    ]);
  });

  it('lets supabase_auth_admin only read the settings, and every other role nothing', async () => {
    const { rows } = await db.admin.query(
      `select r as role,
              array(
                select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
                  with ordinality as t(p, n)
                where has_table_privilege(r, 'private.app_settings', p)
                order by n
              ) as privileges
       from unnest($1::text[]) as r`,
      [ROLES],
    );
    expect(rows).toEqual(
      ROLES.map((role) => ({
        role,
        privileges: role === 'supabase_auth_admin' ? ['SELECT'] : [],
      })),
    );
  });

  const CALL_HOOK = {
    what: 'call the hook',
    sql: `select auth_hooks.custom_access_token_hook($1)`,
    values: [JSON.stringify(hookEvent(oauthClaims(), 'oauth_provider/authorization_code'))],
  };
  const READ_SETTINGS = {
    what: 'read the settings',
    sql: 'select key, value from private.app_settings',
    values: [],
  };
  const REBIND = {
    what: 'change the resource',
    sql: `update private.app_settings set value = '"https://attacker.example.test/mcp"'`,
    values: [],
  };
  const ADD_CLIENT = {
    what: 'add an allow-list',
    sql: `insert into private.app_settings (key, value) values ('mcp_allowed_client_ids', $1)`,
    values: [JSON.stringify([OTHER_CLIENT])],
  };
  const DROP_SETTINGS = {
    what: 'delete the settings',
    sql: 'delete from private.app_settings',
    values: [],
  };

  it.each([
    { role: 'anon', ...CALL_HOOK, denied: 'permission denied for schema auth_hooks' },
    { role: 'authenticated', ...CALL_HOOK, denied: 'permission denied for schema auth_hooks' },
    { role: 'service_role', ...CALL_HOOK, denied: 'permission denied for schema auth_hooks' },
    { role: 'score_owner', ...CALL_HOOK, denied: 'permission denied for schema auth_hooks' },
    { role: 'anon', ...READ_SETTINGS, denied: 'permission denied for schema private' },
    { role: 'authenticated', ...READ_SETTINGS, denied: 'permission denied for schema private' },
    { role: 'service_role', ...READ_SETTINGS, denied: 'permission denied for schema private' },
    { role: 'score_owner', ...READ_SETTINGS, denied: 'permission denied for table app_settings' },
    { role: 'authenticated', ...REBIND, denied: 'permission denied for schema private' },
    {
      role: 'supabase_auth_admin',
      ...REBIND,
      denied: 'permission denied for table app_settings',
    },
    {
      role: 'supabase_auth_admin',
      ...ADD_CLIENT,
      denied: 'permission denied for table app_settings',
    },
    {
      role: 'supabase_auth_admin',
      ...DROP_SETTINGS,
      denied: 'permission denied for table app_settings',
    },
  ] satisfies {
    role: DatabaseRole;
    what: string;
    sql: string;
    values: unknown[];
    denied: string;
  }[])(
    '$role cannot $what, and the settings stay as set',
    async ({ role, sql, values, denied }) => {
      await setSetting('mcp_resource', RESOURCE);

      await expect(asRole(role, (client) => client.query(sql, values))).rejects.toMatchObject({
        code: '42501',
        message: denied,
      });
      expect(await storedSettings()).toEqual([{ key: 'mcp_resource', value: RESOURCE }]);
    },
  );
});

describe('OAUTH-05 settings validation', () => {
  it.each([
    'https://mcp.example.test/mcp',
    'https://mcp.example.test:8443/mcp',
    'https://mcp.example.test',
    'http://localhost:3001/mcp',
    'http://127.0.0.1:3001/mcp',
    'http://[::1]:3001/mcp',
  ])('accepts the canonical resource %s', async (resource) => {
    await setSetting('mcp_resource', resource);

    expect(await storedSettings()).toEqual([{ key: 'mcp_resource', value: resource }]);
  });

  it.each([
    { problem: 'a trailing slash', value: 'https://mcp.example.test/mcp/' },
    { problem: 'a root trailing slash', value: 'https://mcp.example.test/' },
    { problem: 'an uppercase host', value: 'https://MCP.example.test/mcp' },
    { problem: 'an uppercase scheme', value: 'HTTPS://mcp.example.test/mcp' },
    { problem: 'a query', value: 'https://mcp.example.test/mcp?tenant=1' },
    { problem: 'a fragment', value: 'https://mcp.example.test/mcp#top' },
    { problem: 'plain http off loopback', value: 'http://mcp.example.test/mcp' },
    { problem: 'credentials', value: 'https://user@mcp.example.test/mcp' },
    { problem: 'a space', value: 'https://mcp.example.test/m cp' },
    { problem: 'a non-ASCII character', value: 'https://mcp.example.test/mcé' },
    { problem: 'an empty string', value: '' },
    { problem: 'a JSON array', value: [RESOURCE] },
  ])('refuses a resource with $problem', async ({ value }) => {
    await expect(setSetting('mcp_resource', value)).rejects.toMatchObject({
      code: '23514',
      constraint: 'app_settings_mcp_resource_format',
    });
    expect(await storedSettings()).toEqual([]);
  });

  it.each([
    { problem: 'an empty list', value: [] },
    { problem: 'a value that is not a UUID', value: ['mcp-client'] },
    { problem: 'an uppercase UUID', value: [OAUTH_CLIENT.toUpperCase()] },
    { problem: 'a number', value: [1] },
    { problem: 'a single string instead of a list', value: OAUTH_CLIENT },
  ])('refuses an allow-list with $problem', async ({ value }) => {
    await expect(setSetting('mcp_allowed_client_ids', value)).rejects.toMatchObject({
      code: '23514',
      constraint: 'app_settings_mcp_allowed_client_ids_format',
    });
    expect(await storedSettings()).toEqual([]);
  });

  it('refuses an unknown key, so a misspelled setting cannot silently leave the hook off', async () => {
    await expect(setSetting('mcp_resouce', RESOURCE)).rejects.toMatchObject({
      code: '23514',
      constraint: 'app_settings_known_key',
    });
    expect(await storedSettings()).toEqual([]);
  });
});
