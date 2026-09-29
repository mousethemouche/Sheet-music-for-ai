# MCP server and MCP Apps View

The MCP inbound adapter of issue #11 (`apps/mcp`): HTTP transport, the five
product tools, the `ui://` View resource and the View shell. ADR-003 (MCP is
an inbound adapter over the shared use cases, never a REST proxy) and
[APPLICATION_LAYER.md](APPLICATION_LAYER.md) (use cases, ports, contracts,
error codes) remain the references. Pinned versions:
`@modelcontextprotocol/sdk` 1.30.1 and `@modelcontextprotocol/ext-apps` 1.7.5
(MCP Apps spec 2026-01-26).

| Module (`apps/mcp/src`) | Role                                                                             |
| ----------------------- | -------------------------------------------------------------------------------- |
| `app.ts`                | Express app: `POST /mcp`, 405 for other methods, protection slot, public routes  |
| `protection.ts`         | correlation, Origin/CORS, body cap, per-IP and per-owner rate limits (#19/#24)   |
| `auth.ts`               | MCP verifier per audience mode, RFC 9728 metadata route, bearer guard (#26)      |
| `composition.ts`        | `createMcpApp(deps)`: the production composition used by `main.ts` and the tests |
| `config.ts`             | `loadMcpConfig(env)`: environment validation (§7)                                |
| `server.ts`             | `createMcpServer(deps)`: one `McpServer` with the tools and the View             |
| `tools.ts`              | tool registration, visibility, result and error serialization                    |
| `tool-descriptions.ts`  | model-facing descriptions (ScoreSpec, operations, limits, consent)               |
| `view-resource.ts`      | `ui://sheet-music/score-view`, CSP metadata, asset origin                        |
| `static-assets.ts`      | `createViewAssetsRouter`: the View's public playback assets at `/assets/`        |
| `use-cases.ts`          | the five use cases over the store ports, system clock, score IDs                 |
| `principal.ts`          | `authInfo` -> `AuthenticatedPrincipal`                                           |
| `main.ts`               | process entry: configuration, Postgres pool, listen, graceful shutdown (§7)      |

## 1. HTTP surface

- **`POST /mcp`**, Streamable HTTP in stateless mode: no `Mcp-Session-Id`, and
  a new `McpServer` + `StreamableHTTPServerTransport` per request, both closed
  when the response closes. Nothing survives between requests (ADR-006).
- **JSON responses** (`enableJsonResponse`): each POST is answered with one
  JSON body, no SSE stream. The server sends no progress or log notifications,
  so nothing is lost, and plain responses suit serverless hosting (#16).
- **Body: one JSON-RPC message per POST.** After the protection slot,
  `readJsonRpcMessage` (app.ts) reads the body once, capped at
  `maxRequestBodyBytes` (default `PAYLOAD_LIMITS.requestBodyBytes`, 512 KiB;
  a declared body over the cap is already 413 in the slot), and hands it to
  the transport as `parsedBody`; the transport never reads the stream
  itself. A `Content-Type` other than JSON is 415 (the SDK's rule and
  message); malformed JSON is a 400 JSON-RPC parse error (`-32700`,
  `id: null`); a **JSON-RPC batch** (a JSON array) is 400 Invalid Request
  (`-32600`, "JSON-RPC batches are not supported."). MCP removed batching in
  protocol 2025-06-18, and the pinned SDK transport would still run up to 100
  batched messages of one request, each a tool call that the per-owner rate
  limit counted once. JSON that is not a JSON-RPC message is the SDK's 400
  `-32700`, a wrong `Accept` its 406. The process never crashes on a body.
- **Other methods.** `GET` (standalone SSE stream) and `DELETE` (session end)
  have no meaning without sessions. Every method but POST, `OPTIONS` included,
  is `405` with `Allow: POST` and a JSON-RPC error body, once request
  protection and authentication have let it through (below): without a valid
  token it is the 401 challenge, so no method is a way around the guard.
- **Protection slot, every method.** `createMcpHttpApp({ protection })` runs
  the given handlers, in order, for every method on `/mcp` before the POST
  route and the 405 fallback. The production chain (`createMcpApp`,
  ERRORS_AND_SECURITY.md §3) is:
  1. correlation ID;
  2. Origin policy: a request carrying an `Origin` outside
     `MCP_ALLOWED_ORIGINS`, `null` included, is 403 on every method, as the
     Streamable HTTP transport requires against DNS rebinding; a CORS
     preflight from an allowed origin is 204 (a preflight never carries
     credentials); MCP host backends send no `Origin`;
  3. body cap: declared body over 512 KiB is 413, chunked is 411;
  4. per-IP rate limit (`mcp-ip`, shared Postgres store): 429 over the limit,
     so a flood is stopped before any token verification;
  5. bearer guard (`auth.ts`, AUTH_MCP_OAUTH.md §6): the token is read from
     the `Authorization` header only (never the query string) and checked by
     the production verifier. Missing or refused: 401 with
     `WWW-Authenticate: Bearer resource_metadata="<metadata URL>"` (plus the
     generic `error="invalid_token"` for any token problem) and an
     `UNAUTHENTICATED` envelope; the reason is logged (`auth.rejected`),
     never sent. JWKS unreachable: 503 `DEPENDENCY_UNAVAILABLE`, no challenge.
     Accepted: `req.auth` (SDK `AuthInfo`) carries the verified subject in
     `extra.userId` and nothing else (token and client are not passed on);
     the transport hands it to every handler as `extra.authInfo`, and
     `principalFromAuthInfo` turns it into the `AuthenticatedPrincipal`.
     Tool arguments never carry identity;
  6. per-owner rate limit (`mcp-owner`, keyed by the verified user ID).

  Everything answered here (403, 204, 411/413, 429, 401, 503) is answered
  before the MCP transport runs, and writes nothing.

- **Private answers.** Every answer after the protection slot (tool results,
  protocol errors, the 405) carries `Cache-Control: private, no-store`,
  `Vary: Authorization` and `X-Content-Type-Options: nosniff`, like the API's
  protected routes: `get_score` and `search_scores` return library data of
  one user. Error envelopes carry `no-store` and `nosniff` (`sendError`).

- **Public routes.** `GET /.well-known/oauth-protected-resource/mcp` (the
  path of `protectedResourceMetadataUrl(MCP_PUBLIC_URL)`) serves the RFC 9728
  document: `resource` = `MCP_PUBLIC_URL`, `authorization_servers` = the
  Supabase issuer, `bearer_methods_supported: ["header"]`, `resource_name`;
  no authentication, `Access-Control-Allow-Origin: *`, cached 5 minutes. No
  `scopes_supported` yet (AUTH_MCP_OAUTH.md §5). `/assets/*` serves the
  View's playback assets (`static-assets.ts`). Neither goes through the `/mcp`
  chain.
- An unexpected exception in the HTTP layer (a bug, or an error a guard did
  not expect, such as a verifier error the token classification rethrows)
  is the shared 500 `INTERNAL` envelope with the request's correlation ID,
  `no-store` and `nosniff` (`sendError(internalError(...))`), logged as
  `http.unhandled_error`; the thrown value is never sent. Every POST that
  reaches the transport is logged at debug level (`mcp.request`).
- No other route: there is no separate health endpoint. An MCP `ping`, which
  touches no store, checks that the server answers; the API's `/health` (#21)
  covers the shared dependencies.

## 2. Composition API

```ts
createMcpServer({
  useCases,          // McpUseCases: createScore, editScore, saveScore, getScore, searchScores
  resolvePrincipal,  // (authInfo?: AuthInfo) => AuthenticatedPrincipal | null
  logger,            // server-common Logger: use-case failures and bugs (#19)
  view,              // ScoreViewResource { document, ui }: prepareScoreView({ viewHtml, assetOrigin? })
}): McpServer;

createMcpHttpApp({ createServer, protection?, metadata?, assets?, trustProxyHops?,
                   maxRequestBodyBytes?, logger? }): Express;
mcpRequestProtection({ allowedOrigins?, maxRequestBodyBytes? }): RequestHandler[];
createMcpUseCases(stores, { clock?, ids?, expiry? }): McpUseCases;

// The production composition (composition.ts): main.ts and every integration suite.
createMcpApp({
  config,      // McpAppConfig: publicUrl, supabaseUrl, allowedOrigins, audienceMode, trustProxyHops
  stores,      // McpStores: drafts, saved, promotion, rateLimits (PostgresPersistence fits)
  viewHtml,    // the built single-file View
  logger,
  assets?,     // createViewAssetsRouter(dir)
  clock?,      // use-case and rate-limit time (never token time); default system
  ids?,        // default scr_ + random UUID
  rateLimits?, // default DEFAULT_MCP_RATE_LIMITS
}): { app, resource, metadataUrl };
```

`createMcpUseCases` wires the real use cases over any `ScoreStores`
(`drafts`, `saved`, `promotion`); production score IDs are `scr_` + a random
UUID and the draft TTL is the application default. `createMcpApp` builds the
verifier from `supabaseUrl` (`supabaseAuthEndpoints` -> exact issuer and
`createRemoteJwks(jwksUrl)`), prepares the View resource once with
`new URL(publicUrl).origin` as its asset origin (`prepareScoreView`: a build
without the asset-origin placeholder throws here, at startup, not at every
`resources/read`), and assembles the chain of §1.

**Audience modes** (AUTH_MCP_OAUTH.md §4). `resource` (default): the verifier
accepts `aud` containing the canonical `MCP_PUBLIC_URL` and requires
`client_id`; a web session token, a token without the Custom Access Token
Hook and a token for another resource are 401. `interim-authenticated`:
`aud: "authenticated"`, still `client_id` required; only by the explicit
`MCP_AUTH_AUDIENCE_MODE` value, after the owner sign-off, and logged as a
warning (`auth.interim_audience_mode`) at every start. Any other value stops
the process at start; there is no fallback.

**Rate limits** (`DEFAULT_MCP_RATE_LIMITS`, per minute, fixed windows in the
shared Postgres store): `mcp-ip` 600 requests per client address, `mcp-owner`
120 requests per user. Host backends call from few shared addresses for many
users, so the per-IP rule is a flood bound in front of verification and the
per-owner rule is the one that bounds a user. Tune against real use.

## 3. Tool manifest

| Tool            | Title                 | Shows the View | Visibility | Annotations                                                         |
| --------------- | --------------------- | -------------- | ---------- | ------------------------------------------------------------------- |
| `create_score`  | Create score          | yes            | `model`    | readOnly false, destructive false, openWorld false                  |
| `edit_score`    | Edit score            | yes            | `model`    | readOnly false, destructive true, openWorld false                   |
| `save_score`    | Save score to library | no             | `model`    | readOnly false, destructive false, idempotent true, openWorld false |
| `get_score`     | Get score             | yes            | `model`    | readOnly true, openWorld false                                      |
| `search_scores` | Search saved scores   | no             | `model`    | readOnly true, openWorld false                                      |

- **UI link.** `create_score`, `edit_score` and `get_score` declare
  `_meta.ui.resourceUri = "ui://sheet-music/score-view"` (and the legacy
  `_meta["ui/resourceUri"]`, added by `registerAppTool`). Their results carry a
  score artifact that the View renders. `save_score` and `search_scores` show
  no View: the score is already displayed, and a list has no score to play.
- **Visibility.** Every tool is `["model"]`. The View calls no server tool in
  the MVP (it renders and plays the result it is given), so the host must
  reject any `tools/call` from the iframe. In particular `save_score` stays a
  model call that the host presents to the human for approval; a View save
  button would be a deliberate later change of this row.
- **Schemas.** `inputSchema` is exactly the music-contracts input schema as
  JSON Schema (draft-07, `io: "input"`, closed objects); `outputSchema` is the
  contract output (`io: "output"`). See §4 for validation.
- **Descriptions** teach the model: piano only, about 8 bars by default and
  at most 32, ScoreSpec v1 shape (shared bars, voices that fill their bar,
  events, pitch spelling with middle C = C4, durations, tuplet `groupId`,
  whole-note fractions, stable IDs, layers), at most 4 annotations of about 80
  characters and one teaching color per note (`ANNOTATION_COLOR_CONFLICT`), the
  ScoreOperations v1 list and atomicity, `expectedRevision`, and the error
  format. `save_score` states that it may only be called after the human
  explicitly asked for or approved the save, and that nothing the model writes
  counts as consent (there is no confirmation flag, APPLICATION_LAYER.md §5.3).
  The limits in the text come from `MVP_LIMITS` / `PAYLOAD_LIMITS`.

The ScoreSpec (11 kB) and ScoreOperations (22 kB) JSON Schemas are not
attached to `score` / `operations`: they would add several thousand tokens to
every conversation, and the descriptions plus the structured error paths cover
the same ground. Attaching them later is a documentation-only change.

## 4. Input validation

The pinned SDK validates tool arguments with the registered zod schema before
calling the handler, and reports failures as a plain-text tool error. To keep
one validation path with structured `INVALID_INPUT` details on every transport
(APPLICATION_LAYER.md §1, §7.1), each tool registers a schema that accepts any
JSON object and carries the contract's JSON Schema as zod metadata: discovery
publishes the exact contract, the SDK lets the arguments through, and the use
case parses them with the contract. A call whose `arguments` is not an object
(or is omitted) is still rejected by the SDK with its own text message.

## 5. Results and errors

- **Success.** `structuredContent` is the use case output (the contract output
  schema; the SDK checks it before sending). The text block is concise: score
  ID, revision, bars and staves, draft expiry or library title, and the next
  step. MCP Apps hosts keep `structuredContent` for the View and out of the
  model context, so the text of `get_score` also carries the canonical
  ScoreSpec JSON and the text of `search_scores` the summaries and page: those
  are the tools the model uses to read. `create_score` and `edit_score` do not
  repeat the score the model just wrote; it calls `get_score` when it needs the
  canonical result (for example after a transposition).
- **Expected failure.** Every tool runs its use case through server-common's
  `runUseCase(logger, toolName, ...)` and serializes a failure with
  `toMcpToolError(error, correlationId)` (ERRORS_AND_SECURITY.md §1.4-§1.5):
  `isError: true` and one text block holding the JSON of the envelope
  `{ code, message, details?, correlationId }`, with the request's
  correlation ID. No `structuredContent`: the SDK client validates any
  structuredContent against the output schema, even on errors. The `cause`
  is never serialized. `INTERNAL` and `DEPENDENCY_UNAVAILABLE` are logged at
  error level with the redacted cause and the same correlation ID. A code
  answered at the HTTP layer (`UNAUTHENTICATED`...) cannot legitimately come
  out of a tool and is served as `INTERNAL`.
- **Bug.** A use case that throws is logged (`use_case.threw`) and reported as
  `INTERNAL`; the thrown value stays in the server log.
- **Protocol errors** stay the SDK's: unknown method `-32601`, unknown
  resource `-32602`. An unknown tool name is a tool error result
  (`Tool <name> not found`), which is how SDK 1.30.1 answers it.

## 6. View resource and View shell

**Resource.** `ui://sheet-music/score-view`, MIME type
`text/html;profile=mcp-app`, content = the production-built single-file View
(`apps/mcp/dist/view/index.html`, every script and style inlined by
`vite-plugin-singlefile`), identical for every caller. Its `_meta.ui` (on the
listing and on the read content) is:

- `csp.connectDomains` and `csp.resourceDomains`: the asset origin only
  (the SoundFont fetch needs `connect-src`, the worklet module `script-src`);
  empty when none is configured, which is the spec's no-network default;
- `prefersBorder: true`.

The asset origin is the origin of `MCP_PUBLIC_URL`: the server serves the
View's playback assets itself at `/assets/` (`static-assets.ts`). It must be
https (http only on a loopback host). The document and its metadata are
prepared once at startup (§2). The View itself (build, size, asset origin
injection, what the host CSP must allow, behavior, test hooks) is
[MCP_VIEW.md](MCP_VIEW.md); the current single-file build is 1,692.20 kB
(683.42 kB gzip), MCP_VIEW.md §1.

**View** (`apps/mcp/view/src`): the ext-apps `App` bridge, the MCP-U01
result parser, the last-valid-artifact state and the mounted ScorePlayer of
`packages/score-ui` with the VexFlow renderer and the SpessaSynth engine.
Its behavior (P-01 on a newer revision, notices, theme, width, teardown) is
described in [MCP_VIEW.md](MCP_VIEW.md) §5.

## 7. Process composition (`main.ts`, `config.ts`)

Environment (template: `apps/mcp/.env.example`), read and validated once by
`loadMcpConfig` before anything starts:

| Variable                 | Required | Meaning                                                                                                   |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| `MCP_PUBLIC_URL`         | yes      | canonical public URL of the endpoint = the protected resource; https (http on loopback), path `/mcp`      |
| `SUPABASE_URL`           | yes      | Supabase project origin; issuer `<url>/auth/v1` and JWKS derived with `supabaseAuthEndpoints`             |
| `DATABASE_URL`           | yes      | `postgres(ql)://` URL of the server login role (member of `score_owner`); secret                          |
| `MCP_ALLOWED_ORIGINS`    | no       | comma-separated exact browser origins allowed on `/mcp`; default none                                     |
| `MCP_AUTH_AUDIENCE_MODE` | no       | `resource` (default) or `interim-authenticated` (§2)                                                      |
| `MCP_TRUST_PROXY_HOPS`   | no       | proxy hops for Express `trust proxy` (0-10, default 0), so the per-IP limit sees the client address       |
| `PORT`                   | no       | default 3001                                                                                              |
| `MCP_VIEW_HTML_PATH`     | no       | the built View (default `dist/view/index.html` next to the bundle); its `assets/` directory is `/assets/` |

- **Fails safely.** Every missing or invalid variable is collected and the
  process exits with code 1 after one `config.invalid` log line listing the
  problems by variable name; no value (password, URL) is logged. A missing
  View build (HTML or `assets/`), or a View document without the
  asset-origin placeholder (a foreign or stale build), is
  `server.start_failed`, also exit 1.
- **Pool.** One `pg` pool per process (`createPostgresPersistence`) for the
  score stores and the rate-limit store; idle-connection errors are logged
  (`db.idle_connection_error`), never fatal.
- **Graceful shutdown.** On SIGTERM or SIGINT: stop accepting connections,
  close idle keep-alive connections, let in-flight requests finish (their
  connections are closed after 10 s at most), then close the pool; exit code
  0 (`server.stopping`, `server.stopped`).
- Logs are JSON lines on stdout (server-common), with the correlation ID of
  the request; tokens and connection strings are redacted.

`pnpm --filter @sheet-music/mcp build` then `node dist/server/main.js` with
the variables above runs the production server. `pnpm --filter
@sheet-music/mcp dev` builds the View and runs the sources with `tsx`; it
needs the same variables.

## 8. Tests

| Test                                   | File                                                                        | Covers                                                                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP-P01                                | `apps/mcp/test/mcp-p01-setup-discovery.int.test.ts`                         | initialize at the latest protocol version, ping, the reviewed manifest (§3), resources/list and read of the built View with this server's origin in its CSP                                                                                           |
| MCP-P02                                | `apps/mcp/test/mcp-p02-boundary-failures.int.test.ts`                       | parse errors, 405 methods (with a valid token), unknown method/resource/tool, closed input as `INVALID_INPUT`, no write, next call succeeds                                                                                                           |
| MCP HTTP last resort (ERR-01 wiring)   | `apps/mcp/src/app.test.ts`                                                  | a throwing or rejecting handler of the `/mcp` chain: correlated 500 `INTERNAL` envelope, `no-store`, `nosniff`, one correlated log line, thrown text never sent                                                                                       |
| View resource (unit)                   | `apps/mcp/src/view-resource.test.ts`                                        | origin injection, CSP metadata prepared once, a build without the placeholder fails `createMcpApp` at startup                                                                                                                                         |
| MCP-CREATE-01/02                       | `apps/mcp/test/mcp-create-score.int.test.ts`                                | #12: rich create returns the declared draft artifact, re-read, one draft of the token subject and no saved row; malformed envelope, 33 bars and P-03 conflict are actionable tool errors with no row                                                  |
| MCP-EDIT-01/02/03                      | `apps/mcp/test/mcp-edit-score.int.test.ts`                                  | #13: mixed batch (meter, bar replacement, fingering) keeps ID, revision +1, TTL renewed, persisted; stale replay is `REVISION_CONFLICT` with no second transposition; failed batches change nothing; repair batch passes                              |
| MCP-LIB-01, SAVE-02, GET-02, SEARCH-02 | `apps/mcp/test/mcp-library.int.test.ts`                                     | #14: save/reopen/search successes; invalid metadata, consent flag, stale and expired saves promote nothing; replay rule; missing/expired/unreadable/malformed reads; reads renew no TTL; query+tags+pages, empty, bad pagination                      |
| OAUTH-02 (MCP wire)                    | `apps/mcp/test/oauth-02-mcp-auth.int.test.ts`                               | #26: 401 + `resource_metadata` challenge, public metadata (resource, issuer), valid token reaches tools, expired / other-resource / session / query-string tokens refused, every method guarded, JWKS outage 503, audience modes                      |
| SEC-02                                 | `apps/mcp/test/sec-02-request-protection.int.test.ts`                       | #24 on this app: forbidden/`null` Origin 403 on POST, GET, DELETE, OPTIONS before auth; allowed preflight 204; allowed and no-Origin POST served with private-answer headers; 413/411 before any MCP work; no write                                   |
| SEC-03 (wire)                          | `apps/mcp/test/sec-03-rate-limit.int.test.ts`                               | #24: per-owner 429 with `Retry-After`, no tool run and no write; independent owner quota; reset at the next window; a batch of more calls than the limit is 400 `-32600`, one counted request, no write; per-IP limit counts unauthenticated requests |
| ERR-I01                                | `apps/mcp/test/err-i01-dependency-failure.int.test.ts`                      | #19 on this app: the score stores on a missing database; `DEPENDENCY_UNAVAILABLE` tool error with the header's correlation ID, one correlated error log line, no password anywhere                                                                    |
| MCP-CONFIG-01 (unit)                   | `apps/mcp/test/mcp-config-01.test.ts`                                       | configuration: canonical resource and defaults; missing/invalid variables reported by name without values; no audience fallback                                                                                                                       |
| MCP-U01                                | `apps/mcp/view/test/mcp-u01-view-payload.test.ts`, `...score-view.test.tsx` | parser acceptance/rejection, stale/duplicate/other-score results, notices, mount only after validation                                                                                                                                                |

Every integration file boots the production composition (`createMcpApp`)
through `apps/mcp/test/support/mcp-harness.ts` (`startMcpApp`): real request
protection, rate limits on the shared store, bearer guard, SDK server and
client over loopback HTTP, use cases and the Postgres adapters on the test
database `sheet_music_test_mcp` (`support/backend.ts`: `openMcpTestBackend`,
row inspection through the admin pool). Tokens come from a local ES256 test
issuer served over loopback (`@sheet-music/auth-jwt/testing`), checked by the
production verifier through the production remote JWKS key source;
`MCP_PUBLIC_URL` is the real listening URL. Suites may pass a `TestClock`
(use-case and rate-limit time) and `SequentialScoreIds`. P01 builds the View
with `vite.view.config.ts` into a temporary directory, so it serves the
current sources' production bundle without a prior build. FLOW-01/ACCESS-01
(#18) reuse `startMcpApp`, `openMcpTestBackend` and `support/tool-calls.ts`.
Not covered here, by design: the lifecycle and cross-owner tables (FLOW-01,
ACCESS-01 #18), the verifier token matrix (OAUTH-01), the error mapping table
(ERR-01), and the browser suite MCP-UI-01..03 (MCP_UI_TEST_PROCESS.md).
