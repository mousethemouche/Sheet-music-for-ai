# Supabase migrations

`supabase/migrations/` holds the production database schema as plain SQL files,
deployed to the **Supabase cloud** project with the Supabase CLI. The schema
itself is delivered by the owning issues: score repository (#9), persistent
drafts with TTL (#22) and owner-scoped Row Level Security (#27).

## Conventions

- One file per change, named `<UTC timestamp>_<snake_case_name>.sql`
  (`supabase migration new <name>` creates it).
- Forward-only: never edit a migration that has been applied anywhere; add a new one.
- Supabase-compatible PostgreSQL SQL only. Policies may use Supabase's
  `auth.uid()` and the `anon` / `authenticated` / `service_role` roles.
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

Plain Postgres has no `auth` schema and no Supabase roles. Before RLS policies
land (#27), the test harness must create the minimal `auth.uid()` function and
`anon` / `authenticated` / `service_role` roles that the migrations reference.

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
