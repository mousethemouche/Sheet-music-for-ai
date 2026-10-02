# Supabase migrations

`supabase/migrations/` holds the production database schema as plain SQL files,
deployed to the **Supabase cloud** project with the Supabase CLI: owner-scoped
`scores` and `score_drafts` with Row Level Security for the server-only role
`score_owner` (#27), expired-draft cleanup (#22), the rate-limit store (#24),
the pg_cron jobs that clean up both, and the Custom Access Token Hook that
binds MCP OAuth tokens to the MCP resource (#26, see below).
Tables, access paths and the test harness are described in
[docs/architecture/DATABASE.md](../docs/architecture/DATABASE.md).

## Conventions

- One file per change, named `<UTC timestamp>_<snake_case_name>.sql`
  (`supabase migration new <name>` creates it).
- Forward-only: never edit a migration that has been applied anywhere; add a new one.
- Supabase-compatible PostgreSQL SQL only. The API roles `anon`,
  `authenticated` and `service_role` get no privilege on score data; policies
  target the server's role `score_owner` (docs/architecture/DATABASE.md §3.1).
- Roles are cluster-wide: a migration creates a role only when it is missing
  and never alters or drops an existing one.
- Migrations are the only schema source. Application code never creates tables.

## Local and CI databases

Tests use native PostgreSQL 15 (CI: the `postgres:15` service in
`.github/workflows/ci.yml`), not a local Supabase stack. Use databases named
`sheet_music_*` only (default integration database: `sheet_music_test`).
The Supabase cloud project runs PostgreSQL 17, so migrations must be valid on
both 15 and 17.

The Supabase CLI can apply these migrations to any Postgres URL. Native
Postgres has no TLS, so disable it explicitly:

```sh
supabase db push --db-url "postgres://user@localhost:5432/sheet_music_test?sslmode=disable" --dry-run
supabase db push --db-url "postgres://user@localhost:5432/sheet_music_test?sslmode=disable" --yes
```

The CLI records applied versions in `supabase_migrations.schema_migrations`.

Plain Postgres has no `auth` schema and no Supabase roles. The test harness
(`@sheet-music/persistence-postgres/testing`) applies
`packages/persistence-postgres/testing/supabase-bootstrap.sql` first: the
`anon` / `authenticated` / `service_role` roles and Supabase Auth's
`supabase_auth_admin` (only if missing), a minimal
`auth.users`, Supabase's `auth.uid()` and `auth.jwt()`, and Supabase's default
privileges on `public`. Apply the same file before pushing to a fresh local
database with the CLI:

```sh
psql "postgres://user@localhost:5432/sheet_music_test" -1 -f packages/persistence-postgres/testing/supabase-bootstrap.sql
```

pg_cron is not available on plain Postgres: the schedule migration then only
raises a notice, and tests call `private.cleanup_expired_drafts` and
`private.prune_rate_limit_windows` directly.

Run `supabase db push` as the role the server will connect with (Supabase's
`postgres`): the first migration makes that role a member of `score_owner`,
which the server's user path switches to.

## Cloud deployment

No credentials are stored in this repository. `supabase link` records the
linked project under `supabase/.temp/` (git-ignored). Linking and
`db push --db-url` work without a `supabase/config.toml`. With access to the
project:

```sh
supabase login                               # personal access token, stored by the CLI
supabase link --project-ref <project-ref>
supabase db push --dry-run                   # review
supabase db push
```

Never commit connection strings, service-role keys or access tokens.

The servers reach the database over TLS verified against the project's root
certificate (`DATABASE_CA_CERT`, docs/architecture/DATABASE.md §10.2): in
Database Settings, turn on "Enforce SSL on incoming connections" and
download the certificate (SSL Configuration) for the Vercel projects
(docs/deploy/VERCEL.md §6).

## Custom Access Token Hook

`20260929092000_mcp_access_token_hook.sql` creates
`auth_hooks.custom_access_token_hook(jsonb)` and its settings table
`private.app_settings`. For a token issued to an OAuth client (claims carry
`client_id`) it turns `aud: "authenticated"` into
`["authenticated", "<MCP resource>"]`, which the MCP server's resource-bound
verifier requires; web session tokens are returned unchanged, and while the
`mcp_resource` setting is missing every token is returned unchanged (fail
closed). Design, sources and residual risks:
[docs/architecture/AUTH_MCP_OAUTH.md](../docs/architecture/AUTH_MCP_OAUTH.md)
§4.1. Local tests: OAUTH-05
(`packages/persistence-postgres/test/hook/`).

The migration only creates the function. The hook stays off until it is
enabled in the project's Auth configuration, and binds nothing until the
setting is inserted. Once enabled, Supabase Auth calls it for **every**
access token, web sign-ins included: if it fails (a missing grant, for
example), every sign-in and refresh fails with HTTP 500. Hence the order
below, with a check before enabling.

1. Push the migration (`supabase db push`, "Cloud deployment" above).
2. Check what Supabase Auth's role can do (SQL editor or `psql` as
   `postgres`); expect `t, t, t, t, f, f, f`:

   ```sql
   select
     has_schema_privilege('supabase_auth_admin', 'auth_hooks', 'USAGE'),
     has_function_privilege('supabase_auth_admin', 'auth_hooks.custom_access_token_hook(jsonb)', 'EXECUTE'),
     has_schema_privilege('supabase_auth_admin', 'private', 'USAGE'),
     has_table_privilege('supabase_auth_admin', 'private.app_settings', 'SELECT'),
     (select relrowsecurity from pg_class where oid = 'private.app_settings'::regclass),
     has_function_privilege('authenticated', 'auth_hooks.custom_access_token_hook(jsonb)', 'EXECUTE'),
     has_function_privilege('anon', 'auth_hooks.custom_access_token_hook(jsonb)', 'EXECUTE');
   ```

3. Enable the hook with the Management API, which changes only these two
   fields (a personal access token in `SUPABASE_ACCESS_TOKEN`, never
   committed):

   ```sh
   curl -sS -X PATCH "https://api.supabase.com/v1/projects/<project-ref>/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
     -d '{"hook_custom_access_token_enabled": true,
          "hook_custom_access_token_uri": "pg-functions://postgres/auth_hooks/custom_access_token_hook"}'
   ```

   Or in the Dashboard: Authentication > Hooks, add the Custom Access Token
   hook, type Postgres, schema `auth_hooks`, function
   `custom_access_token_hook`. There is no `supabase/config.toml` here; do not
   create one only for the hook, since `supabase config push` would also push
   every other Auth value it holds.

4. Sign in on the web app: the session must still work (its token keeps
   `aud: "authenticated"`). To roll back, send the same request with
   `"hook_custom_access_token_enabled": false`.
5. When the MCP server's public URL is known, insert the resource. The value
   must be exactly the canonical form the MCP server derives from
   `MCP_PUBLIC_URL` (lowercase scheme and host, no trailing slash, no query),
   for example `https://mcp.example.com/mcp`; a check constraint refuses
   other forms:

   ```sql
   insert into private.app_settings (key, value)
   values ('mcp_resource', to_jsonb('https://<mcp-host>/mcp'::text))
   on conflict (key) do update set value = excluded.value;
   ```

   If `MCP_PUBLIC_URL` changes, update this row at the same time: access
   tokens already issued keep the old audience until they expire (1 hour by
   default); refreshed ones get the new one.

6. Optional, for pre-registered clients only: restrict binding to a list of
   OAuth client IDs (lowercase UUIDs). With dynamic client registration,
   leave it unset. Delete the row to lift the restriction.

   ```sql
   insert into private.app_settings (key, value)
   values ('mcp_allowed_client_ids', '["<client-uuid>"]'::jsonb)
   on conflict (key) do update set value = excluded.value;
   ```

7. Dry run as the owner; without an allow-list (or with a client ID it
   lists) expect `"aud": ["authenticated", "<MCP resource>"]`:

   ```sql
   select auth_hooks.custom_access_token_hook(
     '{"claims": {"aud": "authenticated", "client_id": "00000000-0000-4000-8000-000000000000"}}'::jsonb
   );
   ```

8. The OAUTH-04 release smoke (AUTH_MCP_OAUTH.md §4) then checks a real
   OAuth token end to end.
