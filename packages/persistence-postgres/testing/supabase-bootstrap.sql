-- Supabase compatibility bootstrap for a fresh plain-PostgreSQL test database.
--
-- Recreates the part of the Supabase platform that supabase/migrations relies
-- on, before the migrations run:
-- - the API roles anon, authenticated and service_role;
-- - the auth schema with a minimal auth.users table;
-- - auth.uid() and auth.jwt(), defined exactly as Supabase Auth defines them
--   (they read the request.jwt.* settings that PostgREST, or a test, sets);
-- - Supabase's default privileges in schema public, which grant ALL on every
--   new table and function to the API roles, so a missing REVOKE in a
--   migration shows up in tests as it would in the cloud project.
--
-- Test databases only. Never run this against a Supabase project.

-- Roles are cluster-wide and may be shared with other databases: create a role
-- only when it is missing, never alter or drop an existing one.
do $$
declare
  api_role record;
begin
  for api_role in
    select * from (values
      ('anon', 'nologin noinherit'),
      ('authenticated', 'nologin noinherit'),
      ('service_role', 'nologin noinherit bypassrls')
    ) as r (name, options)
  loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = api_role.name) then
      begin
        execute format('create role %I %s', api_role.name, api_role.options);
      exception
        when duplicate_object or unique_violation then
          null; -- created concurrently by another database's bootstrap
      end;
    end if;
  end loop;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Only the columns tests use; Supabase's auth.users has many more.
create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function auth.uid()
returns uuid
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt()
returns jsonb
language sql stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;
