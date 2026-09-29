# Integration test harness (HARNESS-01)

Shared pieces every integration suite builds on (issue #18, HARNESS-01 part;
TEST_PLAN.md §3-§5). This page says what exists, how a suite uses it, and
which database each suite owns. The suites themselves (FLOW-01, ACCESS-01,
the app wiring suites of #12-#14, #21, #24, #26) live with their owners.

## 1. The pieces

| Module                                      | Gives                                                                                                  | Reference                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `@sheet-music/persistence-postgres/testing` | test databases, users A/B in `auth.users`, limited-role helpers                                        | [DATABASE.md §7](../architecture/DATABASE.md)                    |
| `@sheet-music/auth-jwt/testing`             | a local ES256 test issuer: JWKS (in memory or loopback HTTP), tokens, production verifier configs      | §3 below, [AUTH_MCP_OAUTH.md](../architecture/AUTH_MCP_OAUTH.md) |
| `@sheet-music/test-fixtures`                | F01-F11 ScoreSpec fixtures and oracles, `RICH_WIRE_FIXTURE`, F12 (users, clock, IDs, draft/saved data) | TEST_PLAN.md §4, §4 below                                        |
| `@sheet-music/music-contracts`              | `errorEnvelopeSchema`: parses every error body (use-case AND transport codes)                          | §5 below                                                         |

Rules for all of them:

- **Test code only.** Never import a `/testing` entry point or
  `test-fixtures` from production code. `test-fixtures` is enforced by
  `pnpm check:arch`; the two `/testing` entry points are not (their files
  are outside `test/`), so review catches it.
- **Real code paths.** Suites boot the production app factories, guards,
  validators, filters and use cases. No always-allow guard, no mocked
  handler, no token that skips verification: tokens come from the test
  issuer and are checked by the production verifier.
- **Local only.** Local PostgreSQL (`TEST_DATABASE_URL`, default
  `postgres://user@localhost:5432/sheet_music_test`) and the local test
  issuer. Never the Supabase cloud project, never a real tester account.
- **Close everything** in `afterAll`, in reverse order of creation (§6).

## 2. Database

1. `createTestDatabase(name)` drops (`with (force)`) and recreates a
   database named `sheet_music_*` on the server of `TEST_DATABASE_URL`,
   applies the Supabase compatibility bootstrap and every migration, and
   returns `{ name, url, admin, close }`. Without `name` it uses the
   database of `TEST_DATABASE_URL`. Any other name is refused.
2. `seedTestUsers(db.admin)` inserts users A and B into `auth.users`
   (`TEST_USER_A`, `TEST_USER_B`). Rows referencing a user need this first.
3. The app under test connects with `db.url` (for example
   `createPostgresPersistence({ connectionString: db.url })`). `db.admin`
   is the privileged pool: seed and inspect with it, never exercise the
   product through it.

**Users: one source.** For database suites, `TEST_USER_A`/`TEST_USER_B`
of `@sheet-music/persistence-postgres/testing` are the source of truth
(they are what `seedTestUsers` inserts). `F12_USER_A`/`F12_USER_B` of
`test-fixtures` hold the same IDs and emails for code that cannot import an
adapter (pure packages, component tests). If one changes, change both.

### 2.1 Per-suite database names

Integration files run one at a time in one worker, but separate processes
(a second terminal, parallel agents) can run at the same time against the
same server, and `createTestDatabase` drops what it is given. So every
app passes its OWN name below; only the persistence-postgres suites use the
default.

| Database                          | Used by                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the database of TEST_DATABASE_URL | `packages/persistence-postgres/test`: DB-01..04, DRAFT-02..04, RLS-01..03, SEC-03 store (#9, #22, #27); `sheet_music_test` when the variable is unset                                    |
| `sheet_music_test_mcp`            | every apps/mcp integration file (`MCP_TEST_DATABASE` of `apps/mcp/test/support/backend.ts`): MCP-P01/P02, MCP-CREATE/EDIT/LIB, OAUTH-02 (MCP wire), SEC-02/SEC-03 (MCP), ERR-I01 (MCP) |
| `sheet_music_test_mcpui`          | MCP-UI-01..03 (`MCP_UI_DATABASE` of `apps/mcp/test/mcp-ui/protocol.ts`)                                                                                                                  |
| `sheet_music_test_api`            | every apps/api integration file: HTTP routes, OAUTH-02 (REST wire), SEC-02/SEC-03 (api), ERR-I01 (Nest)                                                                                  |
| `sheet_music_test_flow`           | `tests/acceptance` (`ACCEPTANCE_DATABASE` of `support/stack.ts`): FLOW-01, ACCESS-01, CI-04                                                                                            |
| `sheet_music_missing_database`    | never created: failure injection (ERR-I01 MCP and Nest, DB-04). Do not pass it to `createTestDatabase`                                                                                   |
| `sheet_music_unreachable`         | never created: failure injection (DB-04)                                                                                                                                                 |

Files of one app share its database: the `integration` project runs one
file at a time, and each file recreates the database in its `beforeAll`.
A new app-level suite reuses its app's name, or adds a row here in the same
change when it needs its own.

The same name in two processes at once still collides; run a suite from one
place at a time. `createTestDatabase` keeps the database after the run for
inspection; the next run drops it.

## 3. Identity: the local test issuer

`@sheet-music/auth-jwt/testing` stands in for Supabase Auth. Nothing in it
accepts a token; it only mints them and describes the production verifier
configuration for its keys.

| Export                                                                                                          | What                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTestIssuer(options?)`                                                                                    | ES256 key pair in memory; project URL `TEST_PROJECT_URL` (`https://auth.example.test`), issuer `https://auth.example.test/auth/v1`; verifier configs use the in-memory key source. No network |
| `startTestIssuer(options?)`                                                                                     | same keys model, plus a loopback server on `127.0.0.1`, port 0, serving the JWKS at `<projectUrl>/auth/v1/.well-known/jwks.json`; verifier configs use `createRemoteJwks(jwksUrl)`            |
| `TestIssuerOptions`                                                                                             | `{ kid?, now? }`: key ID (default `TEST_KEY_ID`) and the clock of default `iat`/`exp` and of the verifier configs (default system time)                                                       |
| `TestIssuer`                                                                                                    | `{ issuer, projectUrl, kid, jwks, keys, now(), mint(), sessionToken(), mcpToken(), sessionVerifierConfig(), mcpVerifierConfig() }`                                                            |
| `ServedTestIssuer`                                                                                              | `TestIssuer` plus `{ jwksUrl, stop() }` (`projectUrl` is `http://127.0.0.1:<port>`); `stop()` is idempotent                                                                                   |
| `issuer.sessionToken(userId, options?)`                                                                         | a first-party web session token (apps/api): `aud: "authenticated"`, `role: "authenticated"`, no `client_id`, one hour                                                                         |
| `issuer.mcpToken(userId, resource, options?)`                                                                   | an OAuth token for the MCP: `aud: ["authenticated", <canonical resource>]` (the Custom Access Token Hook of AUTH_MCP_OAUTH.md §4), `client_id: TEST_OAUTH_CLIENT_ID`                          |
| `issuer.mint(options)`                                                                                          | any token: `MintOptions` below                                                                                                                                                                |
| `issuer.sessionVerifierConfig()`                                                                                | apps/api: `{ issuer, audiences: ["authenticated"], client: { kind: "session" }, keys, now }`                                                                                                  |
| `issuer.mcpVerifierConfig(resource, { allowedClientIds? })`                                                     | apps/mcp, resource-bound default: `{ issuer, audiences: [canonicalResourceUri(resource)], client: { kind: "oauth", allowedClientIds? }, keys, now }`                                          |
| `SESSION_AUDIENCE`, `TEST_OAUTH_CLIENT_ID`, `TEST_KEY_ID`, `TEST_TOKEN_LIFETIME_SECONDS`, `TEST_PROJECT_URL`    | `"authenticated"`, `"test-mcp-client"`, `"test-es256-key"`, `3600`, `"https://auth.example.test"`                                                                                             |
| types `MintOptions`, `TokenOptions` (= `MintOptions` without `sub`), `McpVerifierOptions`, `TestTokenAlgorithm` | option types of `mint`, `sessionToken`/`mcpToken` and `mcpVerifierConfig`; `TestTokenAlgorithm` is `'ES256' \| 'HS256' \| 'none'`                                                             |

`MintOptions`: `sub` (required), `iss`, `aud` (string or list), `role`,
`clientId`, `iat`/`exp`/`nbf` (epoch seconds), `expiresInSeconds` (default
3600; negative = already expired), `kid`, `alg` (`'ES256'` default,
`'HS256'` with a random secret, `'none'` unsecured), `signingKey`
(`'untrusted'` = a key absent from the JWKS under the trusted `kid`), and
`claims` (extra or replacement claims; `undefined` removes one). Every
token also carries `is_anonymous: false`, like Supabase's.

Deliberately bad tokens and what the production verifier answers
(AUTH_MCP_OAUTH.md §3; proven in
`packages/auth-jwt/testing/harness-01-test-issuer.test.ts`):

| Token                                                             | Reason                   |
| ----------------------------------------------------------------- | ------------------------ |
| `{ signingKey: 'untrusted' }`, or a payload edited after signing  | `BAD_SIGNATURE`          |
| `{ kid: 'other' }`                                                | `UNKNOWN_KEY`            |
| `{ alg: 'HS256' }`, `{ alg: 'none' }`                             | `ALGORITHM_NOT_ALLOWED`  |
| `{ expiresInSeconds: -3600 }`                                     | `EXPIRED`                |
| `{ nbf: <now + 3600> }`                                           | `NOT_YET_VALID`          |
| `{ iss: 'https://other.example.test/auth/v1' }`                   | `WRONG_ISSUER`           |
| `{ role: 'anon' }`                                                | `INVALID_CLAIMS`         |
| a session token at the MCP, or an MCP token of another resource   | `WRONG_AUDIENCE`         |
| an MCP token at the REST API                                      | `CLIENT_NOT_ALLOWED`     |
| any token once a served issuer is stopped, before keys are cached | `KEYS_UNAVAILABLE` (503) |

Each of these reaches the client as the same generic 401 challenge; only
`KEYS_UNAVAILABLE` is a 503. The token matrix is OAUTH-01's (#26): an app
suite sends one missing and one bad token per protected entry point, not
this whole table per tool (TEST_PLAN.md §5).

**Wiring an app to the issuer.** Production derives everything from the
Supabase project URL: `supabaseAuthEndpoints(projectUrl)` gives the issuer
and the JWKS URL, and the verifier uses `createRemoteJwks(jwksUrl)`. A suite
therefore starts a served issuer and gives the app `issuer.projectUrl`
wherever production reads the Supabase URL. When an app factory takes a
verifier (or its config) instead, pass
`createAccessTokenVerifier(issuer.mcpVerifierConfig(resource))` or
`issuer.sessionVerifierConfig()`. Requests carry
`Authorization: Bearer <token>`; for the MCP SDK client:

```ts
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
```

**Clocks.** Token times use the issuer clock, which is system time unless
`now` is given; an app composed from its environment verifies with system
time. A `TestClock` injected into the use cases therefore never affects
token validity. Only unit tests that build the verifier from
`issuer.*VerifierConfig()` share a fixed `now` with the issuer.

## 4. F12 data (`@sheet-music/test-fixtures`)

| Export                      | What                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `F12_USER_A`, `F12_USER_B`  | `{ id, email }`, the same values as `TEST_USER_A`/`TEST_USER_B` (§2)                                                              |
| `F12User`                   | the type of those                                                                                                                 |
| `F12_NOW`                   | `'2026-09-28T12:00:00.000Z'`, the scenario's present                                                                              |
| `F12_DRAFT_TTL_MS`          | `604_800_000` (7 days, written out)                                                                                               |
| `TestClock`                 | `new TestClock(start = F12_NOW)`: `now()`, `set(instant)`, `advance(ms)`; structurally the application `Clock` port               |
| `SequentialScoreIds`        | `newScoreId()`: `scr_00000000-0000-4000-8000-000000000001`, `...0002`, ...; structurally `IdGenerator`. One instance per database |
| `F12_DRAFTS`, `F12DraftRow` | 5 drafts: A live, A live for 1 more ms, A expiring exactly at `F12_NOW`, A expired and not cleaned up, B live                     |
| `F12_SAVED`, `F12SavedRow`  | 5 saved scores: A newest, A two tied on `updatedAt` (listed out of ID order), A older; B tied with A and sharing a title and tag  |
| `F12_EXPECTED`              | hand-written `liveDraftIds`, `expiredDraftIds` (sorted) and `savedOrder` (`updatedAt` desc, then ID in byte order), keyed `A`/`B` |

Rows are plain data: `owner` is a user ID and times are ISO strings. Turn a
row into port records with `new Date(...)` and a fixture carrying the row's
ID and revision, for example
`parseFixture({ ...cloneFixture(F01), id: row.id, revision: row.revision })`.

- Drafts: `persistence.drafts.create(row.owner, { spec, createdAt, updatedAt, expiresAt })`
  (the production repository keeps the given times).
- Saved scores: no port inserts a saved row with chosen timestamps, so seed
  them through `db.admin`:

  ```sql
  insert into public.scores
    (id, owner_user_id, score_spec, score_spec_version, revision, title, tags, created_at, updated_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ```

  or promote a live draft with `promotion.promote(owner, { ..., now })`,
  which sets `createdAt = updatedAt = now`.

The consistency of this data is checked in
`packages/test-fixtures/test/f12-harness-data.test.ts`.

## 5. Error bodies

`errorEnvelopeSchema` (`@sheet-music/music-contracts`) parses every error
body either app sends: the use-case codes (`ERROR_CODES`: domain plus
application codes) and the request-protection codes
(`TRANSPORT_ERROR_CODES`: `FORBIDDEN_ORIGIN`, `LENGTH_REQUIRED`,
`PAYLOAD_TOO_LARGE`, `RATE_LIMITED`). `ENVELOPE_ERROR_CODES` is the union,
`EnvelopeErrorCode` its type. A suite asserts a status AND parses the body
with the schema. Checked in
`packages/music-contracts/test/envelope-01-error-codes.test.ts`.

## 6. A suite, end to end

```ts
import { startTestIssuer, type ServedTestIssuer } from '@sheet-music/auth-jwt/testing';
import {
  type PostgresPersistence,
  createPostgresPersistence,
} from '@sheet-music/persistence-postgres';
import {
  TEST_USER_A,
  TEST_USER_B,
  type TestDatabase,
  createTestDatabase,
  seedTestUsers,
} from '@sheet-music/persistence-postgres/testing';
import { SequentialScoreIds, TestClock } from '@sheet-music/test-fixtures';

let db: TestDatabase;
let issuer: ServedTestIssuer;
let persistence: PostgresPersistence;
let app: RunningApp; // the app's own test harness around its production factory

beforeAll(async () => {
  db = await createTestDatabase('sheet_music_test_flow'); // its row in §2.1
  await seedTestUsers(db.admin);
  issuer = await startTestIssuer();
  persistence = createPostgresPersistence({ connectionString: db.url });
  app = await startApp({
    stores: persistence,
    supabaseUrl: issuer.projectUrl, // production auth wiring against the local issuer
    clock: new TestClock(), // optional: only use-case time, never token time
    ids: new SequentialScoreIds(),
  });
});

afterAll(async () => {
  await app?.close(); // Nest: await app.close(); plain HTTP server: server.close()
  await persistence?.close();
  await issuer?.stop();
  await db?.close();
});

it('A cannot read B', async () => {
  const tokenA = await issuer.mcpToken(TEST_USER_A.id, MCP_RESOURCE);
  const tokenB = await issuer.mcpToken(TEST_USER_B.id, MCP_RESOURCE);
  // ... real requests with Authorization: Bearer <token>
});
```

`startApp` and its options are the owning app's harness (apps/mcp:
`test/support/mcp-harness.ts` `startMcpApp`; apps/api:
`test/support/api-harness.ts` `startApi`; both apps together:
`tests/acceptance/support/stack.ts`). Each boots the production composition
with its production auth wiring against the served issuer. Use `?.` in
`afterAll` so a failed `beforeAll` still releases what it opened.
