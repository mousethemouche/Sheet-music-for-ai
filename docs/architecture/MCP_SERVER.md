# MCP server and MCP Apps View

The MCP inbound adapter of issue #11 (`apps/mcp`): HTTP transport, the five
product tools, the `ui://` View resource and the View shell. ADR-003 (MCP is
an inbound adapter over the shared use cases, never a REST proxy) and
[APPLICATION_LAYER.md](APPLICATION_LAYER.md) (use cases, ports, contracts,
error codes) remain the references. Pinned versions:
`@modelcontextprotocol/sdk` 1.30.1 and `@modelcontextprotocol/ext-apps` 1.7.5
(MCP Apps spec 2026-01-26).

| Module (`apps/mcp/src`) | Role                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `app.ts`                | Express app: `POST /mcp`, 405 for other methods, middleware slots    |
| `protection.ts`         | `mcpRequestProtection`: correlation, Origin/CORS, body cap (#19/#24) |
| `server.ts`             | `createMcpServer(deps)`: one `McpServer` with the tools and the View |
| `tools.ts`              | tool registration, visibility, result and error serialization        |
| `tool-descriptions.ts`  | model-facing descriptions (ScoreSpec, operations, limits, consent)   |
| `view-resource.ts`      | `ui://sheet-music/score-view`, CSP metadata, asset origin check      |
| `use-cases.ts`          | the five use cases over the store ports, system clock, score IDs     |
| `principal.ts`          | `authInfo` -> `AuthenticatedPrincipal`                               |
| `main.ts`               | process composition root (see §7)                                    |

## 1. HTTP surface

- **`POST /mcp`**, Streamable HTTP in stateless mode: no `Mcp-Session-Id`, and
  a new `McpServer` + `StreamableHTTPServerTransport` per request, both closed
  when the response closes. Nothing survives between requests (ADR-006).
- **JSON responses** (`enableJsonResponse`): each POST is answered with one
  JSON body, no SSE stream. The server sends no progress or log notifications,
  so nothing is lost, and plain responses suit serverless hosting (#16).
- **Body.** The transport reads the raw body itself, capped at
  `maxRequestBodyBytes` (default `PAYLOAD_LIMITS.requestBodyBytes`, 512 KiB;
  over the cap: 413 before parsing). Malformed JSON and JSON that is not a
  JSON-RPC message are a 400 JSON-RPC parse error (`-32700`, `id: null`); the
  process never crashes on a body. A wrong `Accept` or `Content-Type` is the
  SDK's 406/415.
- **Other methods.** `GET` (standalone SSE stream) and `DELETE` (session end)
  have no meaning without sessions. Every method but POST, `OPTIONS` included,
  is `405` with `Allow: POST` and a JSON-RPC error body, once request
  protection has let it through (below).
- **Protection slot, every method.** `createMcpHttpApp({ protection })` runs
  the given handlers, in order, for every method on `/mcp` before the POST
  route and the 405 fallback. Production passes `mcpRequestProtection()`
  (`protection.ts`, ERRORS_AND_SECURITY.md §3): the correlation ID, the Origin
  policy (a request carrying an `Origin` outside `MCP_ALLOWED_ORIGINS`,
  `null` included, is 403 on every method, as the Streamable HTTP transport
  requires against DNS rebinding; a CORS preflight from an allowed origin is
  204; MCP host backends send no `Origin`) and the body cap (declared body
  over 512 KiB: 413; chunked: 411), all before an MCP server is built. The
  per-IP rate limit joins this slot when the Postgres store is wired.
- **POST slot.** `createMcpHttpApp({ middleware })` runs the given handlers,
  in order, before `POST /mcp` only, after the protection slot:
  authentication (#26) and the per-owner rate limit. The auth middleware
  verifies the bearer token and sets `req.auth` (SDK `AuthInfo`) with the
  verified subject in `auth.extra.userId`. The transport hands it to every
  handler as `extra.authInfo`, and `principalFromAuthInfo` turns it into the
  `AuthenticatedPrincipal`. Without it the use cases get no principal
  (reported as `INTERNAL`, §5).
- An unexpected exception in the HTTP layer is a 500 JSON-RPC internal error
  (`-32603`) without details.
- No other route: there is no separate health endpoint. An MCP `ping`, which
  touches no store, checks that the server answers; the API's `/health` (#21)
  covers the shared dependencies.

## 2. Composition API

```ts
createMcpServer({
  useCases,          // McpUseCases: createScore, editScore, saveScore, getScore, searchScores
  resolvePrincipal,  // (authInfo?: AuthInfo) => AuthenticatedPrincipal | null
  logger,            // server-common Logger: use-case failures and bugs (#19)
  config,            // { viewHtml: string; assetOrigin?: string }
}): McpServer;

createMcpHttpApp({ createServer, protection?, middleware?, maxRequestBodyBytes? }): Express;
mcpRequestProtection({ allowedOrigins?, maxRequestBodyBytes? }): RequestHandler[];
createMcpUseCases(stores, { clock?, ids?, expiry? }): McpUseCases;
```

`createMcpUseCases` wires the real use cases over any `ScoreStores`
(`drafts`, `saved`, `promotion`); production score IDs are `scr_` + a random
UUID and the draft TTL is the application default.

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

- `csp.connectDomains` and `csp.resourceDomains`: the configured asset origin
  only (SoundFont fetch needs `connect-src`, fonts need `font-src`); empty when
  none is configured, which is the spec's no-network default;
- `prefersBorder: true`.

The asset origin comes from `MCP_ASSET_BASE_URL` and must be https (http only
on a loopback host). The built View is about 700 kB (190 kB gzip) before the
renderer and synth are added.

**Shell** (`apps/mcp/view/src`):

- `host-bridge.ts` uses the official ext-apps `App` (postMessage to the
  parent, `autoResize` on). Listeners for `toolresult`, `toolcancelled` and
  `hostcontextchanged` are registered before the handshake so no result is
  missed. The host context applied is the theme (`data-theme`, color-scheme),
  host style variables, host fonts, `displayMode` (data attribute) and
  `containerDimensions` (fixed or maximum width/height of the root). A host
  teardown unmounts the score first, so the player can stop its audio.
- `tool-result.ts` (MCP-U01) accepts a result only when
  `structuredContent.artifact` passes the music-contracts artifact schema, its
  `score` passes `validateScoreSpec` (so version 1 only), and `scoreId` /
  `revision` equal the document's `id` / `revision`. An `isError` result is
  read as the error envelope of §5.
- `view-state.ts` keeps the last valid artifact. The first valid artifact binds
  the View to its score ID; a higher revision of that ID replaces it; the same
  or a lower revision, or another score ID, is ignored. A rejected call, an
  unreadable result or a cancellation keeps the score and shows a recoverable
  notice (`role="alert"`).
- `ScoreView.tsx` mounts `ScoreMount` only with an accepted artifact, keyed by
  score ID, so newer revisions reach the same instance. **Mount point:** the
  `ScoreMount` prop (`ScoreMountProps = { artifact }`, `score-mount.ts`). It
  defaults to a text summary; the next phase passes the shared ScorePlayer of
  `packages/score-ui` (#7), which applies P-01 on a new revision (stop the old
  audio, load at tick 0, stay paused). The View does not import score-ui yet.

## 7. Process composition (`main.ts`)

Environment: `PORT` (default 3001), `MCP_VIEW_HTML_PATH` (default: the View
built next to the bundle, `dist/view/index.html`), `MCP_ASSET_BASE_URL`
(optional), `MCP_ALLOWED_ORIGINS` (optional comma-separated browser origins
allowed to call `/mcp`; default none). The HTML is read once at startup; a
missing build fails fast. Logs are JSON lines on stdout (server-common).

Phase note: the Postgres stores (#9/#22), the auth middleware (#26) and the
rate limits (#24) are wired in the next phase. Until then no request carries a
principal: every tool call fails before any store access (the use case
answers `UNAUTHENTICATED`, logged, and served as `INTERNAL` because that code
belongs to the HTTP layer), and the placeholder stores only reject.
Discovery, the View resource and request protection already behave as in
production. `pnpm --filter @sheet-music/mcp dev` builds the View, then runs
the sources with `tsx`.

## 8. Tests

| Test    | File                                                                        | Covers                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP-P01 | `apps/mcp/test/mcp-p01-setup-discovery.int.test.ts`                         | initialize at the latest protocol version, ping, the reviewed manifest (§3), resources/list and read of the built View                                                                 |
| MCP-P02 | `apps/mcp/test/mcp-p02-boundary-failures.int.test.ts`                       | parse errors, 405 methods, unknown method/resource/tool, closed input as `INVALID_INPUT`, no write, next call succeeds                                                                 |
| SEC-02  | `apps/mcp/test/sec-02-request-protection.int.test.ts`                       | #24 on this app: forbidden/`null` Origin 403 on POST, GET, DELETE, OPTIONS; allowed preflight 204; allowed and no-Origin POST served; 413/411 before any MCP work; no write            |
| ERR-I01 | `apps/mcp/test/err-i01-dependency-failure.int.test.ts`                      | #19 on this app: the Postgres adapter on a missing database; `DEPENDENCY_UNAVAILABLE` tool error with the header's correlation ID, one correlated error log line, no password anywhere |
| MCP-U01 | `apps/mcp/view/test/mcp-u01-view-payload.test.ts`, `...score-view.test.tsx` | parser acceptance/rejection, stale/duplicate/other-score results, notices, mount only after validation                                                                                 |

The integration files run the real Express app with the production request
protection, SDK server and client over loopback HTTP, and the real use cases
over in-memory stores (`apps/mcp/test/support`; ERR-I01 uses the Postgres
adapter); P01 builds the View with `vite.view.config.ts` into
a temporary directory, so it serves the current sources' production bundle
without a prior build. Not covered here, by design: tool behavior on Postgres
(#12-#14, FLOW-01/ACCESS-01 #18), auth (#26), rate limits (SEC-03 wire, with
the Postgres store), the error mapping table (#19, ERR-01), and the browser
suite MCP-UI-01..03 (real AppBridge,
sandboxed iframe, player), which comes with the ScorePlayer.
