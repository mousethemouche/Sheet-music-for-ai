# HTTP API (apps/api)

The NestJS HTTP adapter of issue #21, with the REST halves of #26 (session
token guard), #19 (error filter, correlation, redacted logs) and #24
(request protection). It is a thin composition root over the shared use
cases (ADR-003): it has no business rule, no write route, and never goes
through the MCP server. Contracts:
[APPLICATION_LAYER.md](APPLICATION_LAYER.md) §5.4, §5.5 and §7.2; errors and
protection: [ERRORS_AND_SECURITY.md](ERRORS_AND_SECURITY.md); tokens:
[AUTH_MCP_OAUTH.md](AUTH_MCP_OAUTH.md) §3.1 and §6.3.

## 1. Routes

| Route             | Auth          | Success                                                                    | Failures                                                                                  |
| ----------------- | ------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /scores`     | session token | 200 `ListScoresResponse`: summaries of the caller's saved scores, one page | 400 invalid query, 401, 403 origin, 413/411 body, 429, 503                                |
| `GET /scores/:id` | session token | 200 `SavedArtifact`: the caller's saved score, full content                | 400 malformed ID, 401, 403, 404 missing, foreign or draft (same bytes), 413/411, 429, 503 |
| `GET /health`     | public        | 200 `{ "status": "ok" }`                                                   | 403 forbidden Origin                                                                      |
| `GET /version`    | public        | 200 `{ "service": "sheet-music-api", "version": "<package version>" }`     | 403 forbidden Origin                                                                      |
| any other         | -             | -                                                                          | 404 `NOT_FOUND` "No route matches this method and path." (JSON envelope, no route echo)   |

- `GET /scores` reads `query`, repeated `tags`, `limit`, `offset` with
  `listScoresQuerySchema` (music-contracts), so it shares the normalization,
  bounds and defaults of `search_scores`. Any other parameter (for example
  `ownerId`) is 400 `UNKNOWN_FIELD`. No match is 200 with an empty page.
  Drafts are never listed. Sorting and matching are #9's.
- `GET /scores/:id` validates `id` with `savedScoreParamsSchema` and runs
  `GetSavedScore`: an own draft is not a saved-route result and answers the
  same 404 as a missing or foreign ID. A path with an invalid
  percent-encoding is 400 "The request is malformed.".
- Reads write nothing: no revision, `updatedAt` or draft TTL changes.
- Health and version have no token, no rate limit and no database access:
  a store outage never makes the process look dead. They hold no
  configuration, secret or user data. Neither is cached (`no-store`).
- Methods other than GET (and HEAD, which Express answers from GET) have
  no route: 404. There is no metadata write route (APPLICATION_LAYER.md §5.3).

## 2. Request pipeline

```
correlation -> nosniff -> Origin policy / CORS preflight -> body cap      (every path)
  -> per-IP rate limit                                                     (/scores only)
  -> SessionAuthGuard -> OwnerRateLimitGuard                              (Nest guards, protected routes)
  -> ContractPipe (query / path) -> controller -> runUseCase -> use case
  -> ApiExceptionFilter -> sendError                                       (every failure)
```

- **Express middleware** (mounted on the Express instance before Nest adds
  its routes, so they answer before any 404): server-common's
  `correlationMiddleware`, `X-Content-Type-Options: nosniff`, `originPolicy`
  (methods `GET`; request headers `authorization`, `x-correlation-id`;
  exposed `www-authenticate`, `x-correlation-id`, `retry-after`),
  `bodySizeLimit` (512 KiB declared, 413; chunked, 411), then the per-IP
  `rateLimit` on `/scores`. Nest's body parser is disabled: the API reads no
  request body.
- **SessionAuthGuard** (global, default-deny; `@Public()` opens health and
  version): `readBearerToken`, then auth-jwt's verifier built by
  `createSessionVerifier(SUPABASE_URL)` = issuer and JWKS URL from
  `supabaseAuthEndpoints`, keys from `createRemoteJwks`, audience
  `authenticated`, client binding `session` (a token carrying `client_id`,
  such as an MCP OAuth token, is refused). The principal is the token's
  `sub` only, kept per request in a WeakMap and read by
  `@CurrentPrincipal()`.

  | Token               | Answer                                                                                   |
  | ------------------- | ---------------------------------------------------------------------------------------- |
  | missing             | 401 `UNAUTHENTICATED`, `WWW-Authenticate: Bearer`                                        |
  | any other rejection | 401 `UNAUTHENTICATED`, `Bearer error="invalid_token", error_description="..."` (generic) |
  | keys unavailable    | 503 `DEPENDENCY_UNAVAILABLE`, no challenge, error log `auth.keys_unavailable`            |

  The reason is logged at info (`auth.rejected`), never the token. The API
  is not an OAuth protected resource: its challenge has no
  `resource_metadata`.

- **OwnerRateLimitGuard**: server-common's `consumeRateLimit` on the
  verified UserId; 429 `RATE_LIMITED` with `Retry-After`, 503 when the store
  fails; the handler never runs.
- **Errors**: `ApiExceptionFilter` sends every failure through
  server-common's `sendError` (status from `ERROR_MAPPING`, envelope with the
  correlation ID, JSON, `no-store`, `nosniff`). Nest's own 404/400 become
  safe envelopes without Nest's message (it quotes the request); anything
  else thrown is logged (`http.unexpected_error`) and answered `INTERNAL`.
  Use cases run through `runUseCase`, which logs `DEPENDENCY_UNAVAILABLE`
  and `INTERNAL` with their redacted cause.

### 2.1 Caching and headers

- Protected answers: `Cache-Control: private, no-store` and
  `Vary: Authorization` (set by the auth guard), so no shared cache stores
  or reuses one principal's answer for another. Error answers are
  `no-store`. Express ETags are disabled.
- Every answer: `x-correlation-id` (server-generated UUID),
  `X-Content-Type-Options: nosniff`, `Vary: Origin`; no `X-Powered-By`.

### 2.2 Rate limits

| Rule        | Subject                 | Default        | Where                   |
| ----------- | ----------------------- | -------------- | ----------------------- |
| `api-ip`    | client address (req.ip) | 300 per minute | `/scores*`, before auth |
| `api-owner` | verified UserId         | 120 per minute | after the auth guard    |

Counters live in the shared Postgres store (`private.rate_limit_windows`),
so they hold across instances. Behind a proxy (Vercel, #16) pass
`trustProxy` (the proxy hops) to `createApiApp`, otherwise every client
shares one per-IP counter. Limits are wiring defaults, to tune against real
use.

## 3. Configuration and bootstrap

Environment (`apps/api/.env.example`), parsed by `loadApiConfig`:

| Variable              | Required | Meaning                                                                                         |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`        | yes      | project URL `https://<ref>.supabase.co` (http only on loopback); issuer and JWKS derive from it |
| `DATABASE_URL`        | yes      | postgres URL of the server login role (member of `score_owner`). Secret                         |
| `API_ALLOWED_ORIGINS` | no       | comma-separated exact web origins; empty = no browser origin (warned at start)                  |
| `PORT`                | no       | default 3000                                                                                    |

An invalid configuration fails before anything starts:
`api.config_invalid` lists the faulty variables and rules, never a value,
and the process exits 1. Any other startup failure is `api.start_failed`
(redacted) and exit 1, after releasing the pool.

| Function                           | Use                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createApiApp(options)` (`app.ts`) | builds and initializes the Nest app, does NOT listen. Options: `supabaseUrl`, `stores: { saved, rateLimits }`, `allowedOrigins?`, `logger?`, `rateLimits?`, `trustProxy?`, `onClose?` |
| `bootstrapApi(config, logger?)`    | production composition (`composition.ts`): Postgres persistence from `DATABASE_URL`, pool ended when the app closes                                                                   |
| `main.ts`                          | `loadApiConfig(process.env)` -> `bootstrapApi` -> `listen(PORT)`, graceful shutdown on SIGTERM/SIGINT (below)                                                                         |

A serverless handler (#16) calls `bootstrapApi(loadApiConfig(process.env))`
once per instance and hands `app.getHttpAdapter().getInstance()` (the
Express app) to the platform. Tests call `createApiApp` through
`apps/api/test/support/api-harness.ts` (below). There is no test-only path
in production code: tests pass the served test issuer's project URL as
`supabaseUrl`, and the production verifier fetches its JWKS.

**Graceful shutdown.** On SIGTERM or SIGINT, `main.ts` logs `api.stopping`
and calls `app.close()`: the server stops accepting connections, idle
keep-alive connections are closed, in-flight requests finish (connections
still open after 10 s are closed), then the shutdown hook ends the Postgres
pool. `api.stopped` is logged once that is done and the process exits 0
(`api.stop_failed` and exit 1 if closing fails). The signal is handled in
`main.ts` instead of Nest's `enableShutdownHooks`, which re-raises it after
closing (exit 143, nothing logged).

Nest's own log calls go through the same JSON logger (`nest.log`; framework
chatter at debug).

## 4. Tests

Integration files run serially against the database `sheet_music_test_api`
(each file recreates it), with tokens from `startTestIssuer()`
(`@sheet-music/auth-jwt/testing`).

| Test                 | File                                                     | Covers                                                                                                                                                          |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP-LIST-01         | `apps/api/test/http-routes.int.test.ts`                  | query + tag + pagination mapping with normalization, repeated tags, default list without drafts, no-match 200, invalid query 400 before the use case            |
| HTTP-GET-01          | same                                                     | saved score 200 with private caching, own draft 404 = missing 404, reads write nothing, malformed ID 400 (pattern, length, percent-encoding)                    |
| HTTP-SYS-01          | same                                                     | `/health`, `/version` exact payloads, no token, no store access, no secret; unknown route, unsupported method and a write attempt: safe JSON 404, no change     |
| OAUTH-02 (REST wire) | `apps/api/test/oauth-02-api-auth.int.test.ts`            | missing token per protected route (401 `Bearer`, no read), MCP OAuth token refused (`invalid_token`, reason logged, token not), session accepted, JWKS down 503 |
| ERR-I01 (Nest)       | `apps/api/test/err-i01-dependency-failure.int.test.ts`   | real store outage (missing database, 3D000) on both routes: 503 envelope with the header's correlation ID, one correlated error log, no password anywhere       |
| SEC-02 (api)         | `apps/api/test/sec-02-sec-03-api-protection.int.test.ts` | foreign and `null` Origin 403 before any work (also preflight and public route), web-origin preflight 204, CORS on answers, no-Origin call served, 413/411      |
| SEC-03 (wire)        | same                                                     | per-owner 429 with `Retry-After` without running the handler, other owner independent, reset at the next window; per-IP 429 before authentication               |
| config               | `apps/api/test/api-config.test.ts` (unit)                | env parsing, defaults, every faulty variable named, values never echoed                                                                                         |

`apps/api/test/support/`: `api-harness.ts` (`startApi` on a loopback port
with captured logs and `logsOf(correlationId)`, `countingStores` /
`apiStores` to prove that a rejected request did no work), `seed.ts`
(`seedDraft`, `seedSaved` through the production adapters: create then
promote), `raw-request.ts` (exact headers, no body). FLOW-01 and ACCESS-01
(#18) reuse `startApi`.

Reused, not repeated: success schemas of the full create/save/reopen flow
(FLOW-01) and foreign-owner isolation of both routes (ACCESS-01), search
semantics (#9 DB-02), the token matrix (OAUTH-01), the error mapping table
(ERR-01), limiter arithmetic (SEC-03 unit) and the store (SEC-03 store).
