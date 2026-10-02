# Errors, logging and request protection

Shared server contract of issues #19 (errors, logging, correlation) and #24
(request protection, input safety). Package: `packages/server-common`, used
by apps/api (NestJS on Express, [API.md](API.md)) and apps/mcp (Express + MCP
SDK, [MCP_SERVER.md](MCP_SERVER.md) §1). Both apps are wired: correlation,
Origin policy, body cap, the two rate limits on the shared Postgres store,
authentication and the error mapping, with wire tests per app (§5, §6).
Authentication itself is in [AUTH_MCP_OAUTH.md](AUTH_MCP_OAUTH.md).

## 1. One error contract

### 1.1 The mapping table (`ERROR_MAPPING`)

| Code                                                                                                      | HTTP | MCP                        |
| --------------------------------------------------------------------------------------------------------- | ---- | -------------------------- |
| `INVALID_INPUT`, `SCORE_VALIDATION_FAILED`, `MVP_LIMIT_EXCEEDED`, `INVALID_OPERATION`, `TARGET_NOT_FOUND` | 400  | tool error                 |
| `UNAUTHENTICATED`                                                                                         | 401  | HTTP only (auth challenge) |
| `FORBIDDEN_ORIGIN`                                                                                        | 403  | HTTP only                  |
| `NOT_FOUND` (missing, foreign or expired: indistinguishable)                                              | 404  | tool error                 |
| `REVISION_CONFLICT`, `ALREADY_SAVED`                                                                      | 409  | tool error                 |
| `LENGTH_REQUIRED`                                                                                         | 411  | HTTP only                  |
| `PAYLOAD_TOO_LARGE`                                                                                       | 413  | HTTP only                  |
| `RATE_LIMITED`                                                                                            | 429  | HTTP only                  |
| `INTERNAL`                                                                                                | 500  | tool error                 |
| `DEPENDENCY_UNAVAILABLE`                                                                                  | 503  | tool error                 |

The first block of codes are the application and domain codes
(APPLICATION_LAYER.md §6). `FORBIDDEN_ORIGIN`, `LENGTH_REQUIRED`,
`PAYLOAD_TOO_LARGE` and `RATE_LIMITED` are transport codes of this package
(`TRANSPORT_ERROR_CODES`), raised before any use case runs.

### 1.2 Envelope

Both transports serialize `{ code, message, details?, correlationId? }`:

- `details` are copies of `code`, `path`, `message` and `ids` only; any other
  property of a detail is dropped, and `details` is omitted when empty;
- `cause` (non-enumerable, APPLICATION_LAYER.md §3.1) and stacks are never
  serialized, so a foreign score and a missing one produce the same bytes;
- messages come from the use cases or this package and never quote request
  text.

music-contracts' `errorEnvelopeSchema` accepts the application and domain
codes and the four transport codes (`ENVELOPE_ERROR_CODES`), so one schema
parses every error body of both apps (docs/testing/HARNESS.md §5).

### 1.3 HTTP

`toHttpError(error, correlationId)` returns `{ status, body }`;
`sendError(res, error, headers?)` writes it with the request's correlation ID
and `Content-Type: application/json; charset=utf-8`, `Cache-Control:
no-store` and `X-Content-Type-Options: nosniff`. An error response is JSON,
never HTML, so user text in it cannot be interpreted by a browser. When the
headers are already sent, the response is destroyed instead of being
completed as a partial success.

`UNAUTHENTICATED` responses also carry the `WWW-Authenticate` challenge built
by auth-jwt (`rejectionResponse`); a key-source outage during verification is
`DEPENDENCY_UNAVAILABLE` (503), not 401.

### 1.4 MCP

- **Tool errors.** A use-case failure inside an authenticated `tools/call` is
  a normal JSON-RPC result:
  `{ isError: true, content: [{ type: 'text', text: <envelope JSON> }] }`
  (`toMcpToolError`). The envelope is deliberately NOT in
  `structuredContent`: the pinned SDK client (1.30.1,
  `Client.callTool`) validates `structuredContent` against the tool's output
  schema even when `isError` is true, so an envelope there would turn a
  readable tool error into a client-side exception. Tool input errors are tool
  errors (`INVALID_INPUT`), as the use cases parse their own input; the SDK
  must not pre-validate tool arguments (APPLICATION_LAYER.md §7.1).
- **HTTP-only codes.** Authentication, origin, body and rate failures are
  answered before JSON-RPC processing, as HTTP responses. If a use case ever
  returned one of them from inside a tool, that is a server fault:
  `toMcpToolError` reports it as `INTERNAL`.
- **Protocol errors** (malformed JSON, invalid JSON-RPC, unknown method or
  tool, unsupported protocol version) are JSON-RPC errors, not envelopes:
  the SDK's own, plus the few apps/mcp answers before the transport
  (non-JSON body 415, malformed JSON `-32700`, JSON-RPC batch `-32600`,
  MCP_SERVER.md §1). This package does not produce or remap them.
- **Anything thrown in the HTTP layer** of either app is the 500 `INTERNAL`
  envelope through `sendError` (with the correlation ID), never a JSON-RPC
  or framework error page.

### 1.5 Running a use case (`runUseCase`)

Both transports call use cases through `runUseCase(logger, operation, fn)`:

- a returned failure passes through unchanged; `INTERNAL` and
  `DEPENDENCY_UNAVAILABLE` are logged at error level with their cause, other
  codes at info level;
- a thrown value is a bug: it is logged and becomes the generic `INTERNAL`
  failure (`internalError`);
- the use case runs exactly once. The logger cannot throw, so a logging
  failure can neither report a committed write as failed nor trigger a retry
  that would repeat it.

## 2. Logging and correlation

### 2.1 Correlation ID

`correlationMiddleware()` is the first middleware of each app. It always
generates the request's correlation ID (a UUID): a caller cannot choose it,
so it cannot file its requests under another request's or another user's ID
(the ID is echoed in response headers and error envelopes, so it is not
secret). A client-supplied `x-correlation-id` that is one value of 8-64
letters, digits, `.`, `_`, `:` or `-` is kept as `clientCorrelationId`
(`readClientCorrelationId`) and logged as a separate field, so a client can
still find its own requests. The middleware echoes the server ID in the
`x-correlation-id` response header and runs the rest of the request in an
`AsyncLocalStorage` context (`runWithRequestContext`), read by the logger and
by `sendError`. Every request has its own context: concurrent requests, of one
user or of several, never share or overwrite it.

### 2.2 Logger (`createLogger`)

One JSON object per line: `time`, `level`, `event`, `correlationId`,
`clientCorrelationId` (when the client sent a valid one), then the redacted
fields (fields cannot override those five). Levels `debug`,
`info`, `warn`, `error`; default threshold `info`. JSON encoding keeps any
newline in a value inside its field, so user text cannot forge log lines.
Logging never throws: an unreadable field yields one `log.unserializable`
line, and a failing output is ignored.

### 2.3 Redaction (`redact`)

- Fields whose name contains `authorization`, `cookie`, `password`,
  `passwd`, `secret`, `token`, `apikey`, `jwt`, `privatekey`, `databaseurl`,
  `connectionstring`, `dsn` or `credential` (case, `-` and `_` ignored) are
  replaced by `[REDACTED]`, at any depth.
- In every string, including error messages and stacks: JWTs, `Bearer` and
  `Basic` credentials, Supabase secret keys (`sb_secret_...`), the whole
  userinfo of a URL (up to the last `@` before the host, as URL parsers and
  `pg` read it, so a raw `@` in a password cannot split it), secret query
  parameters (`password`, `token`, `access_token`, `apikey`, `secret`, the
  OAuth `code`, ...), and the value of `name=value` pairs (libpq keyword DSN,
  ODBC strings, form or environment dumps) and of JSON `"name": "value"`
  members inside a string when the name is sensitive (the field-name rule
  above, plus the exact names `pass` and `pwd`) are masked. Outside a query
  string `code` is not a secret (`code=23505`, `"code":"NOT_FOUND"` stay).
- Errors are logged as `{ name, message, code?, stack?, cause? }`; stacks are
  omitted in production (`NODE_ENV=production`).
- Depth (8), array length (50) and string length (2000) are bounded, cycles
  are cut, and copies have a null prototype so a `__proto__` key stays data.

Handlers log decisions and identifiers (event, operation, error code,
rejection reason, score ID), never request bodies or tokens.

## 3. Request protection

Middleware order in each app: correlation -> Origin policy -> body cap ->
per-IP rate limit -> authentication -> per-owner rate limit -> body parsing
and handler.

### 3.1 Body cap (`bodySizeLimit`)

Mounted before any body parser; it reads nothing. A declared
`Content-Length` above the cap (default `PAYLOAD_LIMITS.requestBodyBytes`,
512 KiB) is answered 413 at once. A body without a declared length
(`Transfer-Encoding: chunked`) is answered 411 `LENGTH_REQUIRED`: Node's
HTTP parser never delivers more bytes than the declared length (and refuses
requests carrying both headers), so every accepted body is within the cap.
Both answers close the connection instead of draining the body. MCP and
browser clients send JSON with a `Content-Length`; if a host streams chunked
request bodies, SEC-02 will show it and this rule must be revisited.

### 3.2 Origin policy (`originPolicy`)

- `Origin` in the allow-list (exact `scheme://host[:port]`, https except on a
  loopback host): the request continues with `Access-Control-Allow-Origin`
  for that origin and `Vary: Origin`; a preflight (OPTIONS with
  `Access-Control-Request-Method`) is answered 204 with the configured
  methods, headers and max age.
- Any other `Origin`, including `null`: 403 `FORBIDDEN_ORIGIN`, no CORS
  header, the request goes no further. This is also the MCP Streamable HTTP
  rule against DNS rebinding.
- No `Origin`: a server-to-server call (MCP host backends, platform checks).
  It continues and still needs authentication wherever the route requires it.

CORS is not authentication: an allowed origin grants nothing by itself, and
no credentialed CORS is offered (tokens travel in `Authorization`).

### 3.3 Rate limiting (`rateLimit`, `consumeRateLimit`)

`RateLimitStore` is a structural contract, implemented by
persistence-postgres; neither package imports the other:

```ts
interface RateLimitStore {
  hit(
    key: string,
    windowMs: number,
    now: Date,
  ): Promise<{ count: number; windowStartedAt: Date; resetAt: Date }>;
}
```

`hit` atomically increments the counter of the fixed window containing `now`
for `key` and returns the post-increment count. Windows are aligned on
multiples of `windowMs` since the Unix epoch:
`[floor(now / windowMs) * windowMs, + windowMs)`. It rejects when the store
is unavailable. The counter lives in the shared database, so the limit holds
across serverless instances; there is deliberately no in-memory store.

- One middleware per rule. Keys are `<rule name>:<subject>`; rule names
  cannot contain `:`, so an owner ID and an IP address never share a counter.
- A request is allowed while `count <= limit`. Over the limit: 429
  `RATE_LIMITED` with `Retry-After` (whole seconds to the window end, at
  least 1), and the handler never runs, so nothing is written.
- Store failure: 503 `DEPENDENCY_UNAVAILABLE` (fail closed) and an error log;
  never an unlimited pass.
- Per-IP subject: `clientAddress(req)` (`req.ip`). Behind Vercel or any proxy
  the app must set Express `trust proxy` to the proxy hops, otherwise all
  clients share one counter. A client rotating IPv6 addresses gets separate
  counters; the per-owner rule is the one that bounds an authenticated user.
- Per-owner subject: the verified `UserId`, after authentication.
- One request, one operation: the API has one use case per route, and
  apps/mcp refuses JSON-RPC batches (400 `-32600`, MCP_SERVER.md §1), so one
  counted `/mcp` request runs at most one tool call. Without that, the pinned
  SDK transport would run up to 100 batched tool calls per counted request.

Limits and windows are wiring configuration, tuned against real use.

## 4. Input safety policy (SEC-01)

Model-generated input reaches the server as untrusted JSON. The rules below
rely on the existing validators; they are not re-implemented here.

- **Colors.** Only `#rgb`, `#rrggbb` and CSS named colors are accepted, and
  the stored form is always lowercase `#rrggbb` (music-domain, P-03).
  `url(...)`, `expression(...)`, `var(...)`, `javascript:`, declarations with
  `;`, markup and surrounding spaces are rejected. Renderers therefore only
  ever receive `#rrggbb`.
- **Closed objects.** Every ScoreSpec and tool-input object rejects unknown
  keys (`UNKNOWN_FIELD`), including `__proto__` and `constructor`, so a
  prototype-shaped payload cannot reach any code that merges objects.
  One observed exception: a `__proto__` key directly at the top of
  `create_score`'s `score` is dropped by the contract's record schema instead
  of being reported. It has no effect on the stored document or on any
  prototype (SEC-01 checks this), but it breaks "never silently ignored";
  music-contracts should reject it.
- **No external assets.** No contract field holds a URL: SoundFont, samples,
  images and fonts come from build and deployment configuration (#23, #16),
  never from a request, so input cannot steer a server or View fetch.
  URL-like keys are `UNKNOWN_FIELD`; a URL inside free text is inert text.
- **Free text.**

  | Field                                                                    | Policy                                                                                                                     |
  | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
  | ScoreSpec text (title, tags, annotation text, labels, roman numerals...) | bounded, not blank; kept verbatim as data; rendered only as text (React text nodes, SVG text), never as HTML (#5, #7, #15) |
  | library title, tags, search text                                         | NFC, whitespace collapsed, control characters rejected, bounded (APPLICATION_LAYER.md §8)                                  |
  | error messages and details                                               | never quote request text                                                                                                   |
  | logs                                                                     | JSON-encoded, redacted (§2)                                                                                                |
  | HTTP error bodies                                                        | JSON with `nosniff` (§1.3)                                                                                                 |

- **Open finding.** ScoreSpec free text accepts control characters,
  including U+0000. PostgreSQL `jsonb` rejects `\u0000`, so storing such a
  score would fail in the repository and be reported as
  `DEPENDENCY_UNAVAILABLE` (a misleading 503 with an error log) instead of a 400. The fix belongs to music-domain (#2: reject `\p{Cc}` in ScoreSpec
  text, as the library metadata already does) or to the repository (#9).

## 5. Wiring (done)

1. Both apps mount `correlationMiddleware()`, `originPolicy(...)`,
   `bodySizeLimit()`, the per-IP `rateLimit(...)`, the auth guard and the
   per-owner `rateLimit(...)`, with `trust proxy` from configuration. The
   chain up to the per-IP limit runs for every method of a route (apps/mcp:
   the `protection` slot), so a preflight or a forbidden Origin is answered
   before any 404/405 fallback. apps/mcp: `createMcpApp`
   (`apps/mcp/src/composition.ts`); apps/api: `createApiApp`
   (`apps/api/src/app.ts`).
2. apps/api: the Nest exception filter sends `toHttpError` through
   `sendError` for every failure, `internalError` for anything thrown
   (`apps/api/src/errors.ts`).
3. apps/mcp: tool handlers call `runUseCase` and return `toMcpToolError`
   with the request's correlation ID; an unexpected throw in the HTTP layer
   is `sendError(internalError(...))`; authenticated answers are
   `Cache-Control: private, no-store`, `Vary: Authorization`, `nosniff`; the
   JSON body is parsed once, capped at the same limit, and batches are
   refused.
4. Wire tests: §6.

## 6. Tests

| Test                                 | File                                                                                                                                                         | Covers                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| ERR-01                               | `packages/server-common/test/err-01-error-mapping.test.ts`                                                                                                   | every code's status and MCP disposition, envelope fields and contract schema, MCP result shape, cause never serialized, INTERNAL |
| ERR-02                               | `packages/server-common/test/err-02-redaction-context.test.ts`                                                                                               | deep redaction, error causes and stacks, unreadable fields, concurrent correlation, header validation, `runUseCase`              |
| SEC-01                               | `packages/server-common/test/sec-01-input-safety.test.ts`                                                                                                    | colors, prototype-shaped payloads, external-asset fields, free-text policy, log forging                                          |
| SEC-03 (unit)                        | `packages/server-common/test/sec-03-rate-limit.test.ts`                                                                                                      | window boundaries with a fake clock, rounding, owner and IP independence, 429 and fail-closed 503 without running the handler    |
| SEC-03 (store)                       | `packages/persistence-postgres/test/sec-03-rate-limit-store.int.test.ts`                                                                                     | the shared Postgres store: windows, long windows, concurrent instances, pruning of idle keys (DATABASE.md §6)                    |
| SEC-02, SEC-03 (wire), ERR-I01 (MCP) | `apps/mcp/test/sec-02-request-protection.int.test.ts`, `apps/mcp/test/sec-03-rate-limit.int.test.ts`, `apps/mcp/test/err-i01-dependency-failure.int.test.ts` | MCP_SERVER.md §8: Origin, body cap, private answers; per-owner and per-IP limits, batch refusal; store outage                    |
| ERR-01 (MCP HTTP last resort)        | `apps/mcp/src/app.test.ts`                                                                                                                                   | a throwing or rejecting handler of the `/mcp` chain gives the correlated 500 `INTERNAL` envelope                                 |
| ERR-I01, SEC-02, SEC-03 (api)        | `apps/api/test/err-i01-dependency-failure.int.test.ts`, `apps/api/test/sec-02-sec-03-api-protection.int.test.ts`                                             | API.md §4                                                                                                                        |
