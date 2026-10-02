# Cross-app acceptance suites and the public-surface inventory

Issue #18 (FLOW-01, ACCESS-01, the HARNESS-01 route/tool list) and #17
(CI-04). These are the only suites that boot BOTH public applications; they
do not repeat the child suites (TEST_PLAN.md §3, §5, §7). Shared harness
pieces (test issuer, fixtures, test database) are described in
[HARNESS.md](HARNESS.md).

| Test           | File                                                     | Project       | Owns                                                                           |
| -------------- | -------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| FLOW-01        | `tests/acceptance/flow-01-public-lifecycle.int.test.ts`  | `integration` | the public happy path, MCP + REST, one rich score                              |
| ACCESS-01      | `tests/acceptance/access-01-route-ownership.int.test.ts` | `integration` | route-level owner isolation, five tools + two saved routes, users A/B          |
| CI-04 surface  | `tests/acceptance/ci-04-exposed-surface.int.test.ts`     | `integration` | exposed MCP tools/resources/prompts and HTTP routes equal the manifest         |
| CI-04 manifest | `tools/inventory/ci-04-manifest.test.ts`                 | `unit`        | every manifest entry references existing tests; the checks fail when they must |

## 1. Running

```sh
pnpm test:integration                                  # every integration suite, these included
pnpm exec vitest run --project integration tests/acceptance
pnpm exec vitest run --project unit tools/inventory    # no database
pnpm exec tsc -p tests/acceptance/tsconfig.json        # typecheck of the suites
```

- Database: `sheet_music_test_flow` on the server of `TEST_DATABASE_URL`
  (default `postgres://user@localhost:5432/sheet_music_test`). Each file
  drops and recreates it in `beforeAll` (files run one at a time in one
  worker), so do not run these files from two processes at once.
- No network beyond loopback: the issuer, the MCP server and the API listen
  on `127.0.0.1`, port 0. No Supabase cloud project, no real account.
- Every file closes its clients, the API, the MCP server, the issuer and the
  pools in `afterAll`.

## 2. The stack (`tests/acceptance/support/stack.ts`)

`startAcceptanceStack({ clock, ids })` starts, in this order:

1. `openMcpTestBackend('sheet_music_test_flow')` (apps/mcp harness): a fresh
   database with every migration, users A and B, the production Postgres
   adapters;
2. one served test issuer (`startTestIssuer`), the stand-in Supabase
   project trusted by both apps;
3. the MCP server through `startMcpApp` (apps/mcp harness): the production
   composition `createMcpApp` with its request protection, rate limits,
   bearer guard, SDK server, tools and use cases, on the shared stores, with
   the given test clock and `SequentialScoreIds`;
4. the API through `startApi` (apps/api harness): the production Nest
   bootstrap `createApiApp` with `supabaseUrl = issuer.projectUrl`.

A user holds two tokens with the same `sub`: an MCP OAuth token
(`aud` = the MCP resource, `client_id`) for the MCP server and a web session
token (`aud: authenticated`) for the API, both checked by the production
verifiers through the production remote JWKS key source. Rate limits are set
out of reach (SEC-03 owns them). `mcpClient(userId)` returns an initialized
SDK client after `tools/list`, so the SDK checks every `structuredContent`
against the published output schema; `apiGet(userId, path)` sends a session
token.

**Why `tests/` is outside the workspace.** Cross-app code cannot live in an
app (apps never import each other) or a package (packages never import
apps). `tests/acceptance` is not a pnpm workspace package, so bare
`@sheet-music/*` specifiers do not resolve there: `support/workspace.ts`
imports each package through the file its `exports` names (the same module
the apps load) and re-exports what the suites use. Its own `tsconfig.json`
enables what the apps' sources need (NestJS decorators, the MCP SDK's
`exactOptionalPropertyTypes: false`); `pnpm typecheck` does not include it,
CI runs the `tsc -p tests/acceptance/tsconfig.json` step.

## 3. FLOW-01 — public lifecycle

User A, the rich wire fixture (TEST_PLAN §4), the test clock set per step.
The flow runs once in `beforeAll` and keeps every real response and three
row snapshots; each test asserts one step. Expected values are written by
hand from the fixture, the requested edits and the clock; every body is
parsed with its music-contracts schema (closed objects).

| Step          | Request                                                       | Asserted                                                                                                 |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| create        | `create_score` (rich fixture)                                 | draft artifact: server ID, revision 1, the fixture unchanged, 7-day expiry; one draft, no saved row      |
| get           | `get_score`                                                   | the same draft, no TTL renewal                                                                           |
| edit draft    | `edit_score` same ID, rev 1: `set_tempo`, `set_fingering`     | revision 2, both edits, every other layer and inner ID kept, TTL renewed                                 |
| before save   | row counts, `search_scores`, `GET /scores`, `GET /scores/:id` | no saved row, empty pages on both transports, the draft is 404 on REST                                   |
| save          | `save_score` rev 2, title, tags                               | `outcome: saved`, same ID and revision, edited score; exactly one saved row (same content), no draft     |
| search / list | `search_scores`, `GET /scores`                                | the same single summary on both transports                                                               |
| reopen        | `GET /scores/:id`                                             | the saved artifact exactly as `save_score` returned it, `private, no-store`                              |
| edit saved    | `edit_score` rev 2: `set_title`, `add_annotation`             | revision 3, still saved; library title, tags and `createdAt` kept; canonical color; stored row; no draft |
| get saved     | `get_score`, `GET /scores/:id`, `GET /scores`                 | revision 3 everywhere                                                                                    |
| inner IDs     | the final document                                            | every inner ID of the fixture, plus only the new annotation                                              |

This is the happy-path evidence of #8/#10/#12-#14/#21. Focused failures
stay with their owners (MCP-CREATE/EDIT/LIB/SAVE/GET/SEARCH, HTTP-LIST/GET).

## 4. ACCESS-01 — route ownership

Each user creates one draft and one saved score through the tools; both
saved scores share their title and tag. A is the caller.

| Group                  | Cases                                                                                                                 | Expected                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| foreign exact IDs      | `get_score`, `edit_score`, `save_score`, `GET /scores/:id` on B's draft and on B's saved score                        | the answer for an ID nobody owns (NOT_FOUND tool error / 404), same body but the correlation ID |
| forged owner arguments | `ownerId: B` on each of the five tools; `GET /scores?ownerId=B`; `GET /scores/<B's id>?ownerId=B&userId=B`            | `INVALID_INPUT` / `UNKNOWN_FIELD` at `ownerId` (400 on REST), or the missing-ID 404             |
| searches and lists     | `search_scores` and `GET /scores` as A and as B; a query matching both users' title and tag                           | only the caller's saved score, never a draft, `total: 1`                                        |
| overlapping requests   | A and B at the same time: `get_score`, `search_scores`, `GET /scores`, `GET /scores/:id` (4 rounds) and one edit each | every answer belongs to its caller; each edit lands on its caller's own draft                   |

After every failed write, all stored rows and both owners' counts are
re-read and compared with their state before the attempt; at the end B
re-reads its items and gets exactly what it got before. A mutation check
(a module-level "last principal" instead of the per-request map in
apps/api's auth guard) fails the overlapping-requests case and nothing else.
Direct database authorization (RLS) is #27.

## 5. CI-04 — public-surface inventory (`tools/inventory`)

`tools/inventory/public-surface.json` lists every public entry point, per
group, with the tests covering it:

```json
"mcp.tools": {
  "create_score": {
    "tests": [{ "file": "apps/mcp/test/mcp-create-score.int.test.ts", "ids": ["MCP-CREATE-01"] }]
  }
}
```

| Group                   | Discovered from                                                             |
| ----------------------- | --------------------------------------------------------------------------- |
| `mcp.tools`             | `tools/list` over the wire (authenticated client, production composition)   |
| `mcp.resources`         | `resources/list`                                                            |
| `mcp.resourceTemplates` | `resources/templates/list`                                                  |
| `mcp.prompts`           | `prompts/list`, when the server declares the capability (it does not)       |
| `mcp.http`              | the Express router of `createMcpApp`, composed like `main.ts` (with assets) |
| `api.http`              | the Express router of the booted Nest application                           |

HTTP keys are `METHOD path`; a route on every method (`app.all`) is `ALL`.
A mounted router (`app.use(router)`, the View assets) keeps no path in
Express 5, so its entry carries a `mount` path the router answers
(`"mount": "/assets"`); an unrecognized mounted router is reported and fails.
Plain middleware (protection, error handlers) is not an entry point.

Rules, checked by the two CI-04 files:

- every exposed entry is listed, and every listed entry is exposed;
- every entry has at least one reference; each reference is a test file
  (`*.test.ts(x)`, `*.int.test.ts(x)`, `*.mcpui.test.ts(x)`) that exists and
  contains each of its `ids` (test IDs or describe titles);
- every entry has at least one integration-level reference (`*.int.test.*`
  or `*.mcpui.test.*`): a public entry point is exercised through its real
  transport.

Adding an entry point: add its tests, then its manifest entry, in the same
change. The inventory proves no entry point is forgotten, not that a listed
one is correct: that is the referenced tests' job. Web SPA routes are not
listed (optional in #18; they are not a server surface).

## 6. Reused, not repeated

MCP protocol and discovery (#11 MCP-P01/P02), the three MCP-UI scenarios
(#11), tool failure cases (#12-#14), REST query/path errors and system routes
(#21), token matrix and wire auth (#26 OAUTH-01/02), request protection and
rate limits (#24 SEC-02/03), error mapping and outage wiring (#19
ERR-01/ERR-I01), database search, CAS, promotion and RLS (#9, #22, #27).
