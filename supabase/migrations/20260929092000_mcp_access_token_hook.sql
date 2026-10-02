-- MCP resource binding for OAuth access tokens: a Supabase Custom Access Token
-- Hook (issue #26; docs/architecture/AUTH_MCP_OAUTH.md §4.1).
--
-- The MCP authorization spec requires the MCP server to accept only tokens
-- whose `aud` contains its canonical resource URI. Supabase Auth ignores the
-- RFC 8707 `resource` parameter and issues every user token with
-- `aud: "authenticated"`. Supabase Auth calls this function before it signs
-- any access token (web session, OAuth grant, refresh) and signs the claims it
-- returns. For a token issued to an OAuth client (its claims carry
-- `client_id`, on the first grant and on every refresh), it appends the
-- canonical MCP resource URI to `aud`, keeping "authenticated":
--
--   "aud": "authenticated"  ->  "aud": ["authenticated", "https://mcp.example.com/mcp"]
--
-- Every other token is returned unchanged. The hook is a no-op, so MCP tokens
-- keep `aud: "authenticated"` and the resource-bound verifier refuses them
-- (fail closed), while:
-- - the resource is not configured (no `mcp_resource` row), or
-- - an allow-list is configured (`mcp_allowed_client_ids`) and does not name
--   the token's client.
--
-- Supabase Auth runs the hook as its own database role, supabase_auth_admin,
-- inside its token transaction; a hook error fails every token request, web
-- sign-ins included. Per Supabase's recommendation the function is SECURITY
-- INVOKER and that role gets exactly what it needs: USAGE on auth_hooks,
-- EXECUTE on the function, USAGE on private and SELECT on
-- private.app_settings. No other role may call the hook or read the settings.
--
-- Enabling the hook is project configuration, not schema: Authentication >
-- Hooks, or the Management API (hook_custom_access_token_enabled,
-- hook_custom_access_token_uri =
-- pg-functions://postgres/auth_hooks/custom_access_token_hook). The settings
-- rows are data, inserted after deployment. Steps: supabase/README.md.

-- ---------------------------------------------------------------------------
-- Settings, written by the migration role (the owner) only
-- ---------------------------------------------------------------------------

-- `mcp_resource`: a JSON string, the canonical resource URI exactly as the MCP
-- server computes it from MCP_PUBLIC_URL (canonicalResourceUri): https (http
-- only on a loopback host), lowercase host, no credentials, query, fragment or
-- trailing slash, printable ASCII.
-- `mcp_allowed_client_ids`: optional, a non-empty JSON array of Supabase OAuth
-- client IDs (lowercase UUIDs, as they appear in the `client_id` claim). When
-- the row is absent, every OAuth client of the project is bound.
create table private.app_settings (
  key text primary key,
  value jsonb not null,
  constraint app_settings_known_key check (key in ('mcp_resource', 'mcp_allowed_client_ids')),
  constraint app_settings_mcp_resource_format check (
    key <> 'mcp_resource'
    or (
      jsonb_typeof(value) = 'string'
      and char_length(value #>> '{}') <= 2048
      and (value #>> '{}') !~ '[^!-~]'
      and (value #>> '{}')
        ~ '^(https://[a-z0-9.-]+|http://(localhost|127\.0\.0\.1|\[::1\]))(:[0-9]{1,5})?(/[^?#]*[^?#/])?$'
    )
  ),
  constraint app_settings_mcp_allowed_client_ids_format check (
    key <> 'mcp_allowed_client_ids'
    or (
      jsonb_typeof(value) = 'array'
      and jsonb_array_length(value) between 1 and 100
      and not jsonb_path_exists(
        value,
        '$[*] ? (@.type() != "string" || !(@ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))'
      )
    )
  )
);

comment on table private.app_settings is
  'Deployment settings read by the Custom Access Token Hook (issue #26). Owner writes only.';

-- Row Level Security stays off: the only reader is supabase_auth_admin, which
-- has no BYPASSRLS, through the invoker hook; a policy-less RLS table would
-- hide every row from it. Access is controlled by grants: SELECT for
-- supabase_auth_admin, nothing for any other role, writes by the owner only.
-- The values are not secret (the public MCP URL and OAuth client IDs).
revoke all on table private.app_settings from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant select on table private.app_settings to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- The hook
-- ---------------------------------------------------------------------------

-- A schema of its own, not exposed by the Data API: supabase_auth_admin gets
-- USAGE on a schema that holds this function only.
create schema auth_hooks;
revoke all on schema auth_hooks from public, anon, authenticated, service_role;

create function auth_hooks.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  claims constant jsonb := event -> 'claims';
  unchanged constant jsonb := jsonb_build_object('claims', event -> 'claims');
  client_id text;
  resource text;
  allowed_client_ids jsonb;
  audiences jsonb;
begin
  -- Supabase Auth puts the OAuth client in the claims (omitted for other tokens).
  if jsonb_typeof(claims -> 'client_id') is distinct from 'string' then
    return unchanged;
  end if;
  client_id := claims ->> 'client_id';
  if client_id = '' then
    return unchanged;
  end if;

  select s.value #>> '{}' into resource
  from private.app_settings s
  where s.key = 'mcp_resource';
  if resource is null then
    return unchanged;
  end if;

  select s.value into allowed_client_ids
  from private.app_settings s
  where s.key = 'mcp_allowed_client_ids';
  if allowed_client_ids is not null
    and not allowed_client_ids @> jsonb_build_array(client_id)
  then
    return unchanged;
  end if;

  -- Supabase serializes a one-value aud as a string, but may send an array.
  audiences := case jsonb_typeof(claims -> 'aud')
    when 'string' then jsonb_build_array(claims -> 'aud')
    when 'array' then claims -> 'aud'
  end;
  if audiences is null then
    return unchanged;
  end if;
  if not audiences @> jsonb_build_array(resource) then
    audiences := audiences || jsonb_build_array(resource);
  end if;

  return jsonb_build_object('claims', jsonb_set(claims, '{aud}', audiences));
end
$$;

comment on function auth_hooks.custom_access_token_hook(jsonb) is
  'Supabase Custom Access Token Hook: adds the MCP resource to aud for OAuth-client tokens (issue #26).';

revoke all on function auth_hooks.custom_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema auth_hooks to supabase_auth_admin;
grant execute on function auth_hooks.custom_access_token_hook(jsonb) to supabase_auth_admin;
