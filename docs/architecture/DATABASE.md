# Database

Schema, access paths and test harness of the Supabase/PostgreSQL store:
owner-scoped storage and Row Level Security (#27), and the database
foundation used by the score repositories (#9), persistent drafts (#22) and
rate limiting (#24). ADR-005 and ADR-006 are the decision records; the SQL in
`supabase/migrations/` is the source of truth; this page explains it.

| Migration                                 | Adds                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `20260928210000_score_storage.sql`        | `private` schema, role `score_owner`, `score_drafts`, `scores`, identity trigger, RLS, grants            |
| `20260928210100_draft_cleanup.sql`        | `private.cleanup_expired_drafts(now, batch_size)`                                                        |
| `20260928210200_rate_limit_store.sql`     | `private.rate_limit_windows`, `private.rate_limit_hit(key, window, now)`, `prune_rate_limit_windows`     |
| `20260928210300_schedule_maintenance.sql` | pg_cron jobs (hourly draft cleanup, rate-limit prune every minute), skipped where pg_cron is unavailable |

Every migration is valid on PostgreSQL 15 (local, CI) and 17 (Supabase cloud)
and applies with `supabase db push` (see `supabase/README.md`).

## 1. Objects

| Schema    | Object                                               | Reached by                                                   |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `public`  | `score_drafts`, `scores`                             | `score_owner` (the server's user path, RLS); the table owner |
| `private` | `current_owner_id()`                                 | `score_owner` (read by the RLS policies)                     |
| `private` | `rate_limit_windows`, `rate_limit_hit`               | the table owner only (server connection)                     |
| `private` | `cleanup_expired_drafts`, `prune_rate_limit_windows` | the table owner only (pg_cron jobs, tests)                   |
| `private` | `forbid_score_identity_change` (trigger)             | fired by updates; not callable                               |
| `auth`    | `users` (Supabase-owned)                             | referenced by the foreign keys, never created here           |
| role      | `score_owner` (NOLOGIN, member of nothing)           | the migration/server login role only (`postgres`)            |

`private` is not exposed by the Supabase Data API, and no API role (`anon`,
`authenticated`, `service_role`) has `USAGE` on it. `public` holds no
function, so there is no RPC endpoint. No API role has any privilege on the
score tables: a Data API or GraphQL request cannot read or write a score, not
even with the owner's own access token (§3.1).

## 2. Tables

Both tables share one ID space (promotion keeps the ID) and map to the records
of APPLICATION_LAYER.md §3.2:

| Column               | `score_drafts` | `scores` | Maps to                                                            |
| -------------------- | -------------- | -------- | ------------------------------------------------------------------ |
| `id` text PK         | yes            | yes      | `spec.id`; the ScoreSpec ID pattern is checked                     |
| `owner_user_id` uuid | yes            | yes      | `UserId` = `auth.users.id` (JWT `sub`); `on delete cascade`        |
| `score_spec` jsonb   | yes            | yes      | the canonical ScoreSpec                                            |
| `score_spec_version` | yes            | yes      | `spec.version` (ADR-006 read-upgrade)                              |
| `revision` integer   | yes            | yes      | `spec.revision`, the compare-and-swap column                       |
| `title`, `tags`      | -              | yes      | library metadata (not ScoreSpec metadata), §8 of APPLICATION_LAYER |
| `created_at`         | yes            | yes      | `createdAt` (for `scores`: promotion time)                         |
| `updated_at`         | yes            | yes      | `updatedAt`, latest successful write                               |
| `expires_at`         | yes            | -        | `expiresAt` from the DraftExpiryPolicy                             |

Timestamps have no database default: the application's `Clock` is the only
time source, so tests with a fake clock and production behave alike. A
`UserId` that is not a UUID is rejected by PostgreSQL (`22P02`); Supabase
subjects are always UUIDs.

Constraints (same names on both tables, prefixed by the table):

- `id_format`: the ScoreSpec ID pattern `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`;
- `spec_matches_row`: `score_spec` is a JSON object whose `id`, `revision` and
  `version` equal the row's `id`, `revision` and `score_spec_version`, so the
  row and its document never disagree;
- `spec_size`: the document serializes to at most 1 MiB (twice the 512 KiB
  request cap; a bound on direct writes, never reached through the API);
- `score_spec_version >= 1`, `revision >= 0` (the ScoreSpec v1 bounds);
- drafts: `updated_at >= created_at` and `expires_at > updated_at` (a positive
  TTL from the latest write); scores: `updated_at >= created_at`;
- scores: `title` has 1-120 characters and `tags` at most 16 non-null
  elements of 1-40 characters, none containing a control character
  (U+0001-U+001F, U+007F-U+009F), mirroring APPLICATION_LAYER §8. Normalization
  (NFC, whitespace, case-insensitive de-duplication) stays in the application.

Indexes:

- `scores_owner_updated_idx (owner_user_id, updated_at desc, id)`: every library
  query is owner-scoped and ordered `updated_at desc, id asc` (§3.5), so
  listing, counting and paging walk one owner's rows in index order;
- `score_drafts_owner_idx (owner_user_id)`: owner lookups, RLS-filtered scans
  and the `auth.users` cascade;
- `score_drafts_expires_at_idx (expires_at)`: expired-draft cleanup.

### Search

Search stays on plain B-tree indexes: the text predicate (a case-insensitive
substring of the title or of one tag) and the tag filters (case-insensitive
containment) are evaluated on the owner's rows reached through
`scores_owner_updated_idx`. MVP libraries are small per owner, and a trigram
index would not change results. If a per-owner library grows large enough for
the text filter to matter, a later migration can add a `pg_trgm` GIN index
without changing the query semantics. The exact SQL and escaping of search
belong to the repository (#9, DB-02).

## 3. Access paths

### 3.1 User path: every owner-scoped repository and promotion call

The server verifies the token (#26) and gets the `UserId`. The Postgres adapter
then runs each port call in one transaction under the role `score_owner`, with
the owner in the transaction-local setting `sheet_music.owner_id`:

```sql
begin;
set local role score_owner;
select set_config('sheet_music.owner_id', $1, true); -- the verified UserId
-- the port's statements, each still filtered by owner_user_id = $owner
commit;
```

- RLS then applies to the server's own queries: a missing owner filter in a
  repository returns or changes nothing of another user (defense in depth).
  The explicit `owner_user_id = $1` filter stays in every statement anyway
  (APPLICATION_LAYER §2). The policies read the owner through
  `private.current_owner_id()`: the setting as a UUID, null (no row) when it
  is unset or empty.
- `set local` and `set_config(..., true)` end with the transaction, so nothing
  leaks into the next user of a pooled connection, including behind
  Supavisor's transaction mode.
- **Why not `authenticated`.** Every end-user access token (web session or MCP
  OAuth token) maps to the role `authenticated` in PostgREST and pg_graphql.
  Had the user path used that role, any signed-in user could write the score
  tables directly with their own token, skipping every application rule: a
  draft that never expires, a saved score without promotion or validation, or
  a saved row squatting the ID of another user's draft, which would make that
  user's save fail until the draft expires (the two tables share one ID space,
  APPLICATION_LAYER §3.2). `score_owner` closes that path: it cannot log in,
  it is a member of no role, and only the server's login role is a member of
  it. PostgREST's `authenticator` can only switch to `anon`, `authenticated`
  and `service_role`, none of which can reach `score_owner`. The migration
  fails if an existing `score_owner` has LOGIN or an elevated attribute, is a
  member of another role, or is reachable from an API role.
- `auth.uid()` is not used: `score_owner` would need `USAGE` on Supabase's
  `auth` schema, and API request claims have no role on this path. A
  `request.jwt.claims` value (for example left by a Data API request) grants
  nothing (RLS-03).
- The server's login role must be a member of `score_owner`: the migration
  grants it to the role that runs it (Supabase's `postgres`, which is also the
  table owner) unless that role is a superuser (local and CI test roles), which
  can switch to any role.

What `score_owner` may do (own rows only, `current_owner_id() = owner_user_id`):

| Table          | SELECT | INSERT | UPDATE (columns)                                                           | DELETE |
| -------------- | ------ | ------ | -------------------------------------------------------------------------- | ------ |
| `score_drafts` | yes    | yes    | `score_spec`, `score_spec_version`, `revision`, `updated_at`, `expires_at` | yes    |
| `scores`       | yes    | yes    | `score_spec`, `score_spec_version`, `revision`, `updated_at`               | no     |

Library title and tags are not updatable (no MVP flow changes them), and no
MVP flow deletes a saved score, so both are denied by missing privileges.
`anon`, `authenticated` and `service_role` have no privilege on either table;
the Supabase default grants on new `public` tables are revoked explicitly.
`score_owner` also has `USAGE` on `public` and on `private`, and `EXECUTE` on
`private.current_owner_id()` only.

### 3.2 Privileged path: maintenance and rate limiting

The table owner (the migration role, `postgres` on Supabase; the
`TEST_DATABASE_URL` role in tests) bypasses RLS (the tables do not force it).
It is used only for:

- the pg_cron jobs (§5, §6);
- `private.rate_limit_hit` (§6), which touches no user row;
- seeding and checking data in tests.

Any privileged statement that ever reads or writes user rows must carry the
application owner filter itself: RLS does not protect it. Nothing uses the
`service_role` key for these tables, so `service_role` has no grant (on
Supabase it bypasses RLS, and a leaked service key must not reach score data).

### 3.3 Immutable identity

A row's `id` and `owner_user_id` never change, whatever the path. Three
independent layers, each tested on its own (RLS-02):

1. column privileges: `score_owner` cannot update `id` or `owner_user_id`;
2. the UPDATE policies' `WITH CHECK`: a new row must still belong to
   `current_owner_id()`;
3. the `*_identity_immutable` triggers: `23000` for any role, the table owner
   included.

## 4. Promotion (draft -> saved)

Promotion is a transaction on the user path, not a database function. The
recommended statement deletes the live draft and inserts it as saved in one
atomic statement:

```sql
with promoted as (
  delete from public.score_drafts
  where owner_user_id = $1 and id = $2 and revision = $3 and expires_at > $4
  returning id, owner_user_id, score_spec, score_spec_version, revision
)
insert into public.scores
  (id, owner_user_id, score_spec, score_spec_version, revision, title, tags, created_at, updated_at)
select id, owner_user_id, score_spec, score_spec_version, revision, $5, $6, $4, $4
from promoted
returning *;
```

- No row returned: `{ status: 'stale' }` (missing, foreign, expired at `now`,
  other revision, or already promoted); nothing changed.
- Any failure (for example a saved score with this ID already exists) rolls
  the whole statement back: the draft is intact (ADR-006).
- On the user path, RLS limits both the delete and the insert to the
  owner's rows: run on another user's draft, it promotes nothing (RLS-03).
- Two statements (delete ... returning, then insert) in the same user-path
  transaction are equivalent; #22 may split them to inject a failure between
  the steps (DRAFT-04).

A client-callable promotion function was rejected: it would take a
caller-supplied instant and let a user promote a draft that is already
expired, and it would add an exposed surface for no benefit.

## 5. Expired-draft cleanup

`private.cleanup_expired_drafts(p_now timestamptz, p_batch_size integer)`
deletes at most `p_batch_size` drafts with `expires_at <= p_now`, oldest first,
and returns the number deleted. A null instant or a batch size below 1 raises
`22023`.

- The boundary is the DraftExpiryPolicy's: a draft is dead from `expires_at`
  on, so cleanup never removes a draft the application still treats as live.
  Saved scores are never touched. Running it again is harmless.
- Rows locked by an in-flight edit or promotion are skipped
  (`for update skip locked`); a row refreshed by a concurrent edit is
  re-evaluated on its latest version and the delete re-checks `expires_at`,
  so a refreshed draft survives. If cleanup deletes first, the edit's
  compare-and-swap matches nothing and reports `stale`.
- Schedule: a pg_cron job `sheet-music-cleanup-expired-drafts`
  (`20260928210300_schedule_maintenance.sql`) runs
  `select private.cleanup_expired_drafts(now(), 1000)` at minute 17 of every
  hour, as the table owner. A backlog drains over the next runs; expired drafts
  are unreachable anyway. The cleanup is a database job, not an HTTP route
  (TEST_PLAN, #22): nothing outside the database can trigger it.
- Where pg_cron is not available (local and CI PostgreSQL), the schedule
  migration only raises a notice; DRAFT-03 (#22) calls the function directly.

## 6. Rate-limit store (#24)

`private.rate_limit_hit(p_key text, p_window_ms bigint, p_now timestamptz)`
implements the structural `RateLimitStore` contract shared by `server-common`
and `persistence-postgres` (neither imports the other):

```ts
interface RateLimitStore {
  hit(
    key: string,
    windowMs: number,
    now: Date,
  ): Promise<{ count: number; windowStartedAt: Date; resetAt: Date }>;
}
```

```sql
select count, window_started_at, reset_at from private.rate_limit_hit($1, $2, $3);
```

- Fixed windows aligned on the Unix epoch:
  `window_started_at = floor(now_ms / window_ms) * window_ms`,
  `reset_at = window_started_at + window_ms`.
- The increment is one `insert ... on conflict do update` on the primary key
  `(key, window_started_at)`: concurrent hits from any number of instances
  serialize on the row and each gets its own post-increment count.
- Each hit deletes the key's ended windows, so an active key keeps one row.
- An idle key keeps its last, ended row until the global prune:
  `private.prune_rate_limit_windows(p_now, p_batch_size)` deletes at most
  `p_batch_size` windows of any key with `reset_at <= p_now`, oldest first,
  skipping rows locked by a concurrent hit, and returns the number deleted (a
  null instant or a batch below 1 raises `22023`). An ended window no longer
  counts, so pruning never changes a decision. The pg_cron job
  `sheet-music-prune-rate-limit-windows` runs it every minute with a batch of
  10000, as the table owner, so per-IP keys (one per client address, IPv6
  rotation included) cannot grow the table without bound; an index on
  `reset_at` serves it.
- `p_window_ms` is a `bigint`: every window server-common's `checkRule`
  accepts works (30 days is 2,592,000,000 ms, past `int4`). Only windows
  beyond the JavaScript `Date` range (about 8.6e15 ms, 273,000 years) would
  come back as invalid dates.
- A key must always be used with the same window length; callers namespace
  keys by limit (for example `mcp:<user id>`). A zero window raises
  (division by zero) and a negative one violates `reset_at > window_started_at`.
- Privileged path only: neither the table nor the functions are reachable by
  `anon`, `authenticated`, `service_role` or `score_owner`. The table has RLS
  enabled with no policy as a second barrier.

## 7. Test harness

`@sheet-music/persistence-postgres/testing` (`packages/persistence-postgres/testing/`)
is shared by every database integration suite (#9, #22, #27, #18, apps). Test
code only.

| Export                                 | Does                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createTestDatabase(name?)`            | refuses names outside `^sheet_music_[a-z0-9_]{1,51}$`; drops (`with (force)`) and creates the database on the `TEST_DATABASE_URL` server; applies the bootstrap then every migration in order; returns `TestDatabase`                |
| `TestDatabase`                         | `{ name, url, admin: Pool, close() }`: `admin` is the privileged pool (bypasses RLS); `url` is the database URL for an app under test; `close()` ends the pool                                                                       |
| `testDatabaseNameFromEnv()`            | the database named in `TEST_DATABASE_URL` (the default of `createTestDatabase`)                                                                                                                                                      |
| `assertTestDatabaseName(name)`         | the name guard                                                                                                                                                                                                                       |
| `withRole(pool, role, settings, work)` | one transaction as `score_owner`, `anon` or `authenticated`, with `settings.claims` (`request.jwt.claims`) and/or `settings.ownerId` (`sheet_music.owner_id`); commits when `work` resolves, rolls back and rethrows when it rejects |
| `asScoreOwner(pool, userId, work)`     | the server's user path: `withRole` as `score_owner` with `ownerId: userId`                                                                                                                                                           |
| `asUser(pool, userId, work)`           | a Data API request with the user's own token: `withRole` as `authenticated` with `authenticatedClaims(userId)` (`sub`, `role`, `aud`)                                                                                                |
| `asAnon(pool, work)`                   | `withRole` as `anon`                                                                                                                                                                                                                 |
| `TEST_USER_A`, `TEST_USER_B`           | F12 users: fixed UUIDs and `@example.test` emails                                                                                                                                                                                    |
| `seedTestUsers(pool, users?)`          | inserts A and B (or `users`) into `auth.users`                                                                                                                                                                                       |

```ts
let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase(); // the TEST_DATABASE_URL database, rebuilt
  await seedTestUsers(db.admin);
});
afterAll(() => db.close());

await asScoreOwner(db.admin, TEST_USER_A.id, (client) =>
  client.query('select id from public.scores'),
);
```

`testing/supabase-bootstrap.sql` makes plain PostgreSQL look like Supabase to
the migrations: it creates `anon`, `authenticated` and `service_role` only if
missing (roles are cluster-wide: never altered or dropped), the `auth` schema
with a minimal `auth.users`, `auth.uid()` and `auth.jwt()` exactly as Supabase
defines them (they read `request.jwt.claim.sub` / `request.jwt.claims`), and
Supabase's default privileges on `public` (ALL to the API roles), so a missing
`revoke` in a migration fails the tests as it would leak in the cloud. The
migration itself creates `score_owner` when it is missing (a NOLOGIN role
without privileges outside the `sheet_music_*` databases).

Rules: integration files run serially in one worker, so several files may
rebuild the same database one after the other; each file calls `close()` in
`afterAll`; only `sheet_music_*` databases are ever created or dropped.

## 8. Tests owned here (#27)

`packages/persistence-postgres/test/rls/`, all through the real migrations and
the real limited roles (the user path `score_owner` for A/B, and the API roles
`authenticated` with A's own token and `anon`); the privileged pool only seeds
and checks the stored data.

| Test   | File                                  | Covers                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS-01 | `rls-01-read.int.test.ts`             | RLS enabled, exact policy, grant and `score_owner` role inventory (no API role can switch to it); own rows by exact ID, list, count, title/tag aggregates; B and no owner see nothing; the owner's own token and anon are denied; planner statistics hidden; no view                                                                              |
| RLS-02 | `rls-02-write.int.test.ts`            | own insert/edit/delete; forged owner, reused ID, cross-user edit/delete, upsert over a foreign row, transfer, ID change, rename and delete of saved scores: all fail with data unchanged; the owner's own token (never-expiring draft, expiry extension, direct saved insert, squatting B's draft ID) and anon: denied; each identity layer alone |
| RLS-03 | `rls-03-functions-claims.int.test.ts` | no RPC in `public`; `private` functions SECURITY INVOKER with fixed `search_path`, only `current_owner_id` executable (by `score_owner`), calls denied; promotion on the user path; claims, stored metadata or an empty owner grant nothing on the user path; API roles denied whatever their claims                                              |
| guard  | `test-database-guard.test.ts` (unit)  | the harness refuses non-test database names before connecting                                                                                                                                                                                                                                                                                     |

Reused, not repeated: storage round-trip, search and compare-and-swap on the
real adapter (DB-01..04, #9); cleanup semantics and races, promotion rollback
and races (DRAFT-02..04, #22); limiter behavior (SEC-03, #24); route-level
owner isolation (ACCESS-01, #18); JWT verification (#26).

## 9. Known limits

- The Data API and GraphQL cannot reach `public.score_drafts` or
  `public.scores` with any user token (§3.1). Exposing `public` through the
  Data API therefore reveals the table names in the OpenAPI/GraphQL schema of
  a role at most, never rows; turning the Data API off for `public` (#16)
  remains a hardening option, not a requirement.
- `pg_class.reltuples` and the `pg_stat_*` views show approximate total row
  counts of any table to any role; no content, owner or ID. `pg_stats` (most
  common values) is hidden from the user path (RLS-01) and needs a table
  privilege the API roles do not have.
- On the user path, inserting a row with an existing ID fails with a unique
  violation, which confirms that the ID exists. IDs are server-generated and
  random, and the API never lets a client choose one.
- The two tables share one ID space by construction only (server-generated
  IDs, promotion keeps the ID); no constraint spans both tables. No client can
  write either table, so no caller can take another user's ID.
- The pg_cron jobs themselves run only on Supabase; locally the guarded
  migration is a no-op.
- `score_owner` is a cluster-wide role: creating it is part of the first
  migration, and on a shared local PostgreSQL it is reused by every
  `sheet_music_*` database.

## 10. Postgres adapter (#9, #22)

`@sheet-music/persistence-postgres` implements the application ports on the
schema above. Nothing outside this package sees a `pg` type: the ports take
and return application records.

### 10.1 Exported API

| Export                               | What it is                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `createPostgresPersistence(config)`  | what a composition root wires: `{ drafts, saved, promotion, rateLimits, close() }` over one new pool                          |
| `PostgresPersistence`                | `drafts: ScoreDraftRepository`, `saved: SavedScoreRepository`, `promotion: ScorePromotion`, `rateLimits: RateLimitStore`      |
| `createPostgresPool(config)`         | the pool alone (`pg.Pool`), for the lower-level factories below                                                               |
| `PostgresPoolConfig`                 | `connectionString` (required), `max` (5), `ssl`, `connectionTimeoutMillis` (5000), `idleTimeoutMillis` (10000), `onIdleError` |
| `createScoreDraftRepository(pool)`   | `ScoreDraftRepository` over `public.score_drafts` (user path)                                                                 |
| `createSavedScoreRepository(pool)`   | `SavedScoreRepository` over `public.scores` (user path)                                                                       |
| `createScorePromotion(pool)`         | `ScorePromotion` (user path, one transaction)                                                                                 |
| `createExpiredDraftCleanup(pool)`    | `{ run(now, batchSize): Promise<number> }`: calls `private.cleanup_expired_drafts` (privileged path)                          |
| `createPostgresRateLimitStore(pool)` | `RateLimitStore` over `private.rate_limit_hit` (privileged path)                                                              |
| `RateLimitStore`, `RateLimitWindow`  | the structural contract of §6, declared here and in server-common; neither package imports the other                          |
| `PersistenceError`                   | every storage failure: `{ name: 'PersistenceError', operation, code? (SQLSTATE), cause }`                                     |

`createPostgresPersistence(...)` satisfies `ScoreStores` of `apps/mcp`
(`createMcpUseCases(persistence)`), and `persistence.rateLimits` is what the
server-common rate-limit middleware takes. `close()` stops handing out
connections, waits for calls in progress, ends the pool, and may be called
more than once; later calls reject with a `PersistenceError`.

### 10.2 Connections (Supabase cloud)

- `DATABASE_URL` is a server secret (never in the repository or a client
  bundle). The login role must own the tables (the privileged path) and be a
  member of `score_owner` (the user path): Supabase's `postgres` role, through
  the pooler user `postgres.<project-ref>`, when it is also the role that ran
  the migrations.
- Serverless instances (Vercel) use the **Supavisor transaction pooler**
  (`...pooler.supabase.com:6543`): each port call borrows a server connection
  for one transaction only. This is safe because every setting the adapter
  makes is transaction-local (`set_config(..., true)`), and node-postgres uses
  unnamed statements (the adapter never passes a statement `name`), which the
  transaction pooler supports. Keep `max` small (1-3 per instance): the pooler
  multiplexes.
- A long-running server may use the direct connection (`db.<ref>.supabase.co:5432`,
  IPv6 unless the IPv4 add-on is enabled) or the session pooler (port 5432 on
  the pooler host); the adapter behaves the same on all three.
- TLS: set by `DATABASE_CA_CERT` only (`src/tls.ts`, validated by both
  servers' configuration at start). With it, the pool passes
  `ssl: { ca, rejectUnauthorized: true }`: every connection is TLS and the
  server certificate and host name are verified against that CA (on
  Supabase, the project's root certificate, Database Settings > SSL
  Configuration); a server without TLS or with another certificate is
  refused, never used in plaintext. `DATABASE_URL` must carry no TLS
  parameter (`sslmode`, `sslrootcert`, ...), since URL parameters override
  `ssl` in node-postgres; the configuration refuses one. Without
  `DATABASE_CA_CERT` only a loopback database (local development and tests)
  is accepted. Supabase's "Enforce SSL on incoming connections" refuses
  plaintext clients on the server side as well.
- Errors of idle connections (server restart, network drop) go to
  `onIdleError` instead of crashing the process; the pool has already dropped
  the connection. A connection lost during a call rejects that call and is
  discarded, not returned to the pool.

### 10.3 User path in the adapter

Each owner-scoped call (`drafts.*`, `saved.*`, `promotion.promote`) is one
transaction on one pooled connection:

```sql
begin;
select set_config('role', 'score_owner', true),                 -- = set local role
       set_config('sheet_music.owner_id', $1, true);            -- owner
-- the call's statements, each with owner_user_id = $owner
commit;                                                          -- or rollback on any failure
```

Both values are set at the start of every call, so a value left on a shared
connection can never stand in for the owner. A `UserId` that is not a UUID
makes PostgreSQL reject the call
(`22P02`), which the use cases report as `DEPENDENCY_UNAVAILABLE`; Supabase
subjects are always UUIDs. The privileged path (`rateLimits.hit`, the cleanup
runner) is a single statement as the login role.

### 10.4 Reads, writes and failures

- Documents are written as `JSON.stringify(spec)` with `score_spec_version =
spec.version` and `revision = spec.revision`, and read back through
  `validateScoreSpec`. A document it rejects (unknown version, invalid
  version-1 document) throws `StoredScoreUnreadableError` (the use cases report
  `INTERNAL`) and the row is never rewritten; the cause (table, ID, domain
  error) is kept for logs only. ScoreSpec v1 is the only version, so there is
  no read-upgrade step yet: the next version adds it here, with a test that
  reads a stored v1 row.
- `update` is one conditional statement
  (`... where owner_user_id = $1 and id = $2 and revision = $3`); one row
  changed is `'updated'`, none is `'stale'`. Drafts write the document,
  revision, `updated_at` and `expires_at`; saved scores write the document,
  revision and `updated_at` only (title, tags, `created_at` and the identity
  never change in MVP).
- Every infrastructure failure rejects with `PersistenceError` (the use cases
  report `DEPENDENCY_UNAVAILABLE`): refused or lost connection, pool timeout,
  SQL or constraint error, failed `COMMIT`, a pool already closed. Its message
  never quotes the driver's message or detail (which can contain row values);
  the SQLSTATE is in `code` and the driver error in `cause`. A failure is
  never turned into `null`, `'stale'` or an empty page.

### 10.5 Search semantics

This is the one normative description of library matching (APPLICATION_LAYER
§3.5); MCP and REST reuse it without repeating the matrix. Inputs are already
normalized by the application (NFC, whitespace, case-insensitive tag
de-duplication, §8 of APPLICATION_LAYER).

| Aspect | Rule                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scope  | the caller's rows of `public.scores` only: never drafts, never another owner, never ScoreSpec `metadata.title`/`metadata.tags`                                |
| `text` | `title ILIKE %text%` or one tag `ILIKE %text%`; never across two tags. `%`, `_` and `\` in the text are escaped (`\` is the escape), so they match themselves |
| `tags` | the score carries every filter tag: `lower(tag) = lower(filter)` on whole tags, no wildcard                                                                   |
| case   | case-insensitive with PostgreSQL's `lower()`/`ILIKE` under the database locale (Unicode-aware under ICU or a UTF-8 libc locale: `ÉTUDE` finds `Étude`)        |
| order  | `updated_at desc`, then `id` ascending in byte order (`collate "C"`), whatever the database collation, so ties are stable across pages                        |
| page   | `limit`/`offset` as given; `total` counts every match of the owner, from the same statement (snapshot) as the page, also when the page is empty               |

All user values reach SQL as bound parameters. No accent folding: `etude`
does not find `Étude`.

### 10.6 Promotion as implemented

`promote` runs the §4 contract as three statements in one user-path
transaction, so that DRAFT-04 can fail it between the two writes:

1. `select score_spec ... where owner_user_id = $1 and id = $2 and revision = $3
and expires_at > $4 for update`: no row is `{ status: 'stale' }`; the
   document is validated (an unreadable draft is never promoted);
2. `insert into public.scores ... select ... from public.score_drafts` (the
   document is copied in SQL, bit for bit), with the confirmed title and tags
   and `created_at = updated_at = now`;
3. `delete from public.score_drafts ...`; both statements must affect exactly
   one row, otherwise the transaction rolls back.

The row lock of step 1 orders every concurrent writer: an edit or a second
save waits, then finds the draft gone (`'stale'`); cleanup skips the locked
draft; a save that arrives while an edit or cleanup holds the draft waits and
then finds the new revision or no draft (`'stale'`).

## 11. Tests owned here (#9, #22)

`packages/persistence-postgres/test/`, integration project, real migrations,
the production adapter and, where a flow is involved, the production use
cases. Races are coordinated in the database, never with sleeps: a temporary
row trigger waits on an advisory lock the test holds, the test observes lock
waits in `pg_stat_activity`, then releases (`test/support/coordination.ts`).

| Test     | File                                  | Covers                                                                                                                                                                                                 |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DB-01    | `db-01-round-trip.int.test.ts`        | rich fixture stored as exactly its canonical document and read back (draft, edit, promotion, saved edit); unreadable version/document rejected, never rewritten or promoted                            |
| DB-02    | `db-02-search.int.test.ts`            | the §10.5 table on an A/B dataset with drafts: title, tags, combined, no match, empty query, ties, page boundaries, totals, quote/wildcard-shaped input                                                |
| DB-03    | `db-03-compare-and-swap.int.test.ts`  | two instances race on one revision (drafts and saved): one `updated`, one `stale`, one increment, stored revision = document revision; stale writes change nothing                                     |
| DB-04    | `db-04-failures.int.test.ts`          | constraint and duplicate failures, failed `COMMIT`, connection killed mid-call: previous row intact, pool recovers; every call rejects when the store is down; no call bypasses the user path          |
| DRAFT-02 | `draft-02-durability.int.test.ts`     | create on one instance, dispose it, get/edit on a fresh one, read on a third                                                                                                                           |
| DRAFT-03 | `draft-03-cleanup.int.test.ts`        | expired draft unreachable before cleanup; cleanup deletes exactly the expired drafts, batch-bounded, repeatable; refresh-vs-cleanup interleavings both ways                                            |
| DRAFT-04 | `draft-04-promotion.int.test.ts`      | promotion result and rows; stale cases; failure between insert and delete and insert failure roll back; save vs edit, save vs save, save vs cleanup both ways                                          |
| SEC-03   | `sec-03-rate-limit-store.int.test.ts` | the shared store (#24): epoch-aligned windows per key and reset; 30-day and one-year windows; no lost increment across two instances; prune of idle keys' ended windows, boundary, batches, repeatable |

DRAFT-01 (the expiry policy) is a unit test of music-application. The
limiter's decisions and middleware are SEC-03 in server-common (#24); the stale-to-`REVISION_CONFLICT`
mapping of transports is #13; route-level ownership is ACCESS-01 (#18).
