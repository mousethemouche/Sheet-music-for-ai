-- Owner-scoped score storage (ADR-005, ADR-006; issues #9, #22, #27).
--
-- public.score_drafts holds unsaved drafts with a TTL; public.scores is the
-- permanent library. Each row belongs to one auth.users row. Only the server
-- reads and writes them, as the role `score_owner`, and Row Level Security
-- limits that role to the rows of the owner the server names for the
-- transaction. The Supabase API roles (anon, authenticated, service_role) get
-- no privilege on either table: no Data API or GraphQL request can read or
-- write a score, not even with the user's own access token, so every write
-- goes through the application rules (validation, TTL, promotion, limits).
-- The id and the owner of a row never change. Access paths and the promotion
-- recipe: docs/architecture/DATABASE.md.

-- Server-only objects (owner lookup, trigger functions, maintenance and rate
-- limiting) live in `private`, which is not exposed by the Supabase Data API
-- and which no API role may use.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The server's user-path role.
--
-- `score_owner` cannot log in, and only the migration role (the server's own
-- login role: `postgres` on Supabase) is made a member of it. PostgREST's
-- `authenticator` can only switch to roles it is a member of (anon,
-- authenticated, service_role), so no API request can act as score_owner.
-- Roles are cluster-wide: an existing score_owner is reused only if it is as
-- powerless as the one created here and unreachable from the API roles;
-- otherwise the migration fails. A superuser (local and CI databases) can
-- switch to any role and is given no membership.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'score_owner') then
    begin
      create role score_owner nologin noinherit;
    exception
      when duplicate_object or unique_violation then
        null; -- created concurrently by another database's migration
    end;
  end if;

  if not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then
    execute format('grant score_owner to %I', current_user);
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'score_owner'
      and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)
  ) then
    raise exception 'Role score_owner exists with LOGIN or an elevated attribute.';
  end if;

  if exists (select 1 from pg_catalog.pg_auth_members where member = 'score_owner'::regrole)
    or exists (
      select 1 from pg_catalog.pg_roles
      where rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
        and pg_catalog.pg_has_role(oid, 'score_owner'::regrole, 'MEMBER')
    )
  then
    raise exception 'Role score_owner must be a member of no role and reachable by no API role.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Drafts
-- ---------------------------------------------------------------------------

create table public.score_drafts (
  id text primary key,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  score_spec jsonb not null,
  score_spec_version integer not null,
  revision integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null,
  -- The ScoreSpec ID pattern (music-domain ID_PATTERN).
  constraint score_drafts_id_format check (id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  -- The stored document is a JSON object whose id, revision and version are
  -- the row's own columns, so the row and its ScoreSpec never disagree.
  constraint score_drafts_spec_matches_row check (
    jsonb_typeof(score_spec) = 'object'
    and score_spec ->> 'id' is not distinct from id
    and score_spec -> 'revision' is not distinct from to_jsonb(revision)
    and score_spec -> 'version' is not distinct from to_jsonb(score_spec_version)
  ),
  -- Twice the 512 KiB request cap: a bound on direct writes, never reached by the API.
  constraint score_drafts_spec_size check (octet_length(score_spec::text) <= 1048576),
  constraint score_drafts_version_positive check (score_spec_version >= 1),
  constraint score_drafts_revision_non_negative check (revision >= 0),
  -- expires_at = latest successful write + a positive TTL (DraftExpiryPolicy).
  constraint score_drafts_timestamps_ordered check (
    updated_at >= created_at and expires_at > updated_at
  )
);

comment on table public.score_drafts is
  'Unsaved, owner-private score drafts with a TTL (ADR-006). Never part of the library.';

-- Owner lookups, RLS-filtered scans and the auth.users cascade.
create index score_drafts_owner_idx on public.score_drafts (owner_user_id);
-- Expired-draft cleanup (private.cleanup_expired_drafts).
create index score_drafts_expires_at_idx on public.score_drafts (expires_at);

-- ---------------------------------------------------------------------------
-- Saved scores (the permanent library)
-- ---------------------------------------------------------------------------

create table public.scores (
  id text primary key,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  score_spec jsonb not null,
  score_spec_version integer not null,
  revision integer not null,
  -- Library metadata (APPLICATION_LAYER.md §8), not ScoreSpec metadata.
  title text not null,
  tags text[] not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint scores_id_format check (id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  constraint scores_spec_matches_row check (
    jsonb_typeof(score_spec) = 'object'
    and score_spec ->> 'id' is not distinct from id
    and score_spec -> 'revision' is not distinct from to_jsonb(revision)
    and score_spec -> 'version' is not distinct from to_jsonb(score_spec_version)
  ),
  constraint scores_spec_size check (octet_length(score_spec::text) <= 1048576),
  constraint scores_version_positive check (score_spec_version >= 1),
  constraint scores_revision_non_negative check (revision >= 0),
  -- 1-120 characters, no control character.
  constraint scores_title_format check (title ~ '^[^\x01-\x1f\x7f-\x9f]{1,120}$'),
  -- At most 16 tags, none null, each 1-40 characters without control
  -- characters. Joining on U+0001 (itself forbidden in a tag) checks every
  -- element with one expression, without a function call.
  constraint scores_tags_format check (
    cardinality(tags) <= 16
    and array_position(tags, null) is null
    and (
      cardinality(tags) = 0
      or array_to_string(tags, E'\x01')
        ~ '^[^\x01-\x1f\x7f-\x9f]{1,40}(\x01[^\x01-\x1f\x7f-\x9f]{1,40})*$'
    )
  ),
  constraint scores_timestamps_ordered check (updated_at >= created_at)
);

comment on table public.scores is
  'The permanent, owner-private score library (ADR-005). Rows enter it by promotion of a draft.';

-- Every library query is owner-scoped and ordered by updated_at desc, id asc
-- (APPLICATION_LAYER.md §3.5). Text and tag predicates filter the owner's rows
-- reached through this index; see DATABASE.md "Search".
create index scores_owner_updated_idx on public.scores (owner_user_id, updated_at desc, id);

-- ---------------------------------------------------------------------------
-- Immutable identity: no path, privileged or not, changes a row's id or owner.
-- ---------------------------------------------------------------------------

create function private.forbid_score_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The id and the owner of a stored score cannot change.'
    using errcode = '23000';
end;
$$;

revoke all on function private.forbid_score_identity_change() from public, anon, authenticated, service_role;

create trigger score_drafts_identity_immutable
  before update on public.score_drafts
  for each row
  when (old.id is distinct from new.id or old.owner_user_id is distinct from new.owner_user_id)
  execute function private.forbid_score_identity_change();

create trigger scores_identity_immutable
  before update on public.scores
  for each row
  when (old.id is distinct from new.id or old.owner_user_id is distinct from new.owner_user_id)
  execute function private.forbid_score_identity_change();

-- ---------------------------------------------------------------------------
-- Row Level Security: own rows only, for the role `score_owner`.
--
-- The owner is the `sheet_music.owner_id` setting, which the server sets
-- transaction-locally (set_config(..., true)) to the verified UserId before
-- any statement. Unset (or empty) means no owner, and no row matches.
-- `(select private.current_owner_id())` is evaluated once per statement.
-- auth.uid() is not used: it would need USAGE on Supabase's `auth` schema for
-- score_owner, and API request claims play no part on this path.
-- ---------------------------------------------------------------------------

create function private.current_owner_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('sheet_music.owner_id', true), '')::uuid
$$;

revoke all on function private.current_owner_id() from public, anon, authenticated, service_role;

alter table public.score_drafts enable row level security;
alter table public.scores enable row level security;

create policy score_drafts_select_own on public.score_drafts
  for select to score_owner
  using ((select private.current_owner_id()) = owner_user_id);

create policy score_drafts_insert_own on public.score_drafts
  for insert to score_owner
  with check ((select private.current_owner_id()) = owner_user_id);

create policy score_drafts_update_own on public.score_drafts
  for update to score_owner
  using ((select private.current_owner_id()) = owner_user_id)
  with check ((select private.current_owner_id()) = owner_user_id);

create policy score_drafts_delete_own on public.score_drafts
  for delete to score_owner
  using ((select private.current_owner_id()) = owner_user_id);

create policy scores_select_own on public.scores
  for select to score_owner
  using ((select private.current_owner_id()) = owner_user_id);

create policy scores_insert_own on public.scores
  for insert to score_owner
  with check ((select private.current_owner_id()) = owner_user_id);

create policy scores_update_own on public.scores
  for update to score_owner
  using ((select private.current_owner_id()) = owner_user_id)
  with check ((select private.current_owner_id()) = owner_user_id);

-- No delete policy on scores: no MVP flow deletes a saved score.

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants ALL on new public tables to anon, authenticated and
-- service_role by default; revoke that from every API role and grant only
-- what the user path needs, to score_owner. UPDATE is column-level: id,
-- owner_user_id and created_at (and the library title and tags) are not
-- updatable.
-- ---------------------------------------------------------------------------

revoke all on table public.score_drafts, public.scores from public, anon, authenticated, service_role;

grant usage on schema public to score_owner;
-- For private.current_owner_id() only: score_owner gets no other privilege in `private`.
grant usage on schema private to score_owner;
grant execute on function private.current_owner_id() to score_owner;

grant select, insert, delete on table public.score_drafts to score_owner;
grant update (score_spec, score_spec_version, revision, updated_at, expires_at)
  on table public.score_drafts to score_owner;

grant select, insert on table public.scores to score_owner;
grant update (score_spec, score_spec_version, revision, updated_at)
  on table public.scores to score_owner;
