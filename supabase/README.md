# Supabase migrations

`supabase/migrations/` holds the production database schema as plain SQL files,
deployed to the **Supabase cloud** project with the Supabase CLI: owner-scoped
`scores` and `score_drafts` with Row Level Security for the server-only role
`score_owner` (#27), expired-draft cleanup (#22), the rate-limit store (#24),
and the pg_cron jobs that clean up both.
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
`anon` / `authenticated` / `service_role` roles (only if missing), a minimal
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
