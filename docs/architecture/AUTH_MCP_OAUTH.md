# Authentication for the MCP resource and the HTTP API

Verifier and identity part of issue #26 (ADR-005). Package:
`packages/auth-jwt`. The HTTP/MCP wiring is in place (§6: `apps/mcp/src/auth.ts`,
`apps/api/src/auth.ts`) with its OAUTH-02 wire tests (§7); the OAUTH-04
provider smoke against the real Supabase project and a real host remains a
release gate. Research below was done on 2026-09-28 (§4.1: 2026-09-29)
against the primary sources listed at the end.

## 1. What Supabase actually issues

| Item                     | Value for the cloud project `https://<ref>.supabase.co`                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `iss`                    | `https://<ref>.supabase.co/auth/v1`                                                                                                                                      |
| `aud`                    | `"authenticated"` (string or array) for every signed-in user, web session or OAuth token alike                                                                           |
| `sub`                    | the user's UUID (`auth.users.id`); stable across email changes                                                                                                           |
| `role`                   | `authenticated` (`anon` and `service_role` exist for keys, never for a user session)                                                                                     |
| `client_id`              | present only in tokens issued by the OAuth 2.1 server, to that OAuth client                                                                                              |
| other claims             | `email`, `user_metadata` (user-editable), `app_metadata`, `session_id`, `aal`, `amr`, `is_anonymous`, `iat`, `exp`                                                       |
| signing                  | asymmetric; our project signs with ES256. JWKS: `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`, cached 10 minutes at Supabase's edge                          |
| authorization server     | issuer `https://<ref>.supabase.co/auth/v1`; RFC 8414 metadata at `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`; OIDC discovery also offered |
| OAuth 2.1 server         | beta; currently **disabled** on our project; enabling it (and dynamic registration) is a later-phase configuration change                                                |
| RFC 8707 `resource`      | **not honored**: tokens are not bound to the requested resource and keep `aud: "authenticated"`                                                                          |
| Custom Access Token Hook | runs before every access token is signed (sign-in, OAuth grant, refresh); `claims.client_id` marks OAuth tokens; the claims it returns are signed, `aud` string or array |

Two open provider issues matter for us (not verified locally; the OAUTH-04
smoke must check them on the real project):

- supabase/auth#2820 (reported 2026-09-20, open): the consent flow's
  `GET /oauth/authorizations/{id}` answers 400 when the authorization request
  carries `resource`, requests `offline_access`, or comes from a public
  client. MCP clients send `resource` on every request (the MCP spec requires
  it), so this can block host connections outright.
- A claude.ai connector report (anthropics/claude-ai-mcp#1038) suspects that a
  host enforcing audience binding drops Supabase tokens whose `aud` is not the
  MCP resource. Unconfirmed.

## 2. What the MCP authorization spec requires of our server

Revision 2025-11-25 and the current revision 2026-07-28 (both read on
2026-09-28) agree on the resource-server side:

- implement RFC 9728 Protected Resource Metadata listing at least one
  authorization server, discoverable through `resource_metadata` in the
  `WWW-Authenticate` header of a 401 and/or at the well-known URL (path
  inserted after the host);
- accept tokens in the `Authorization: Bearer` header only, on every request;
  never from the query string;
- answer 401 to missing, invalid or expired tokens, 403 to insufficient scope,
  400 to a malformed authorization request;
- validate that the token was issued for this server as its audience
  (RFC 8707 §2), accept no other token, and never pass a received token on
  to another service.

## 3. The verifier (`createAccessTokenVerifier`)

```ts
const verifier = createAccessTokenVerifier({
  issuer, // exact iss
  audiences, // token aud must contain one of them
  client, // { kind: 'session' } | { kind: 'oauth', allowedClientIds? }
  keys, // createRemoteJwks(jwksUrl) in production
  algorithms, // default ['ES256']; asymmetric only
  clockToleranceSeconds, // default 30, max 300
  now, // injectable clock
});
const result = await verifier.verify(token);
// { ok: true, principal: { userId } } | { ok: false, reason }
```

A token is accepted only if every check passes, in this order:

1. at most 16 KiB, a compact JWS;
2. header `alg` in the allow-list, checked before any key lookup: `HS*` and
   `none` can never be configured (the constructor throws), and a token
   signed with an allowed-but-unconfigured algorithm is refused;
3. signature verified with the key the key source returns for `kid`; keys the
   token brings itself (`jwk`, `jku`, `x5u`) are ignored;
4. `iss` equals the configured issuer exactly;
5. `aud` contains a configured audience;
6. `sub`, `exp` and `iat` present; `exp`, `nbf` and `iat` consistent with the
   clock within the tolerance (`iat` in the future is refused too);
7. `sub` is a non-blank identifier without whitespace or control characters,
   at most 255 characters; `role` is `authenticated`; `is_anonymous` is not
   `true`;
8. `client_id` matches the client binding (§3.1).

The principal is `Object.freeze({ userId: sub })`. Nothing else in the token
(email, `user_metadata`, `app_metadata`, look-alike claims) and nothing in a
request body is ever read as identity.

Rejection reasons are for server logs only:

| Reason                                                                     | HTTP answer (§5)                           |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| `MISSING_TOKEN`                                                            | 401, challenge without error code          |
| `MALFORMED_TOKEN`, `ALGORITHM_NOT_ALLOWED`, `UNKNOWN_KEY`, `BAD_SIGNATURE` | 401, generic `invalid_token` challenge     |
| `WRONG_ISSUER`, `WRONG_AUDIENCE`, `EXPIRED`, `NOT_YET_VALID`               | 401, generic `invalid_token` challenge     |
| `INVALID_CLAIMS`, `CLIENT_NOT_ALLOWED`                                     | 401, generic `invalid_token` challenge     |
| `KEYS_UNAVAILABLE` (JWKS unreachable, timed out, not 200, malformed)       | 503 `DEPENDENCY_UNAVAILABLE`, no challenge |

A key-source outage is not the caller's fault; answering 401 would send every
MCP host into a re-authorization loop.

### 3.1 Client binding

- `{ kind: 'session' }` (apps/api, used by the web app): the token must NOT
  carry `client_id`. A token that a third-party OAuth client obtained for the
  MCP cannot call the REST API.
- `{ kind: 'oauth' }` (apps/mcp): `client_id` is required, so a first-party
  web session token cannot be replayed at `/mcp`. With pre-registered clients,
  `allowedClientIds` narrows it further. With dynamic client registration
  (what MCP hosts use today) client IDs are not known in advance, so no list
  can be configured.

### 3.2 Keys (`createRemoteJwks`)

jose's remote JWKS resolver with our bounds: cache 10 minutes, at most one
refetch per 30 seconds for an unknown `kid` (a rotated key is picked up; a
flood of forged `kid`s is not turned into a flood of fetches), 5-second
timeout, no redirects, https only (http on a loopback host for the Supabase
CLI). Supabase publishes a new key as a standby key before it signs anything,
so rotation needs no restart. There is no stale-key fallback: after the cache
expires, a fetch failure is `KEYS_UNAVAILABLE`.

## 4. Audience and resource binding: what is enforced

The MCP authorization spec (2025-11-25, "Token Handling" and "Access Token
Privilege Restriction") says MCP servers MUST validate that an access token
was issued specifically for them as its audience, and MUST reject tokens that
do not include them in `aud`. Supabase cannot put the MCP resource in `aud` by
itself (§1), so conformance depends on a Supabase configuration change.

**Default, and the only conformant configuration: resource-bound.** The MCP
verifier uses `audiences: [canonicalResourceUri(MCP_URL)]` and
`client: { kind: 'oauth' }` (plus `allowedClientIds` if clients are
pre-registered). The Custom Access Token Hook of §4.1 adds the canonical MCP
resource URI (for example `https://mcp.example.com/mcp`) to `aud` for tokens
that carry a `client_id`. Web session tokens (the hook leaves them
`aud: "authenticated"`) and any token not minted through that path are
refused. Until the hook is enabled and configured, every real token fails
with `WRONG_AUDIENCE` and gets the 401 challenge: the default fails closed, it
never widens access.

**Release gate (#26, OAUTH-04).** The hook is written and tested locally
(migration `supabase/migrations/20260929092000_mcp_access_token_hook.sql`,
OAUTH-05) but not deployed or enabled on the cloud project yet. No release
that accepts MCP tokens ships until the OAUTH-04 smoke shows, on the real
project, a token from the real OAuth flow carrying the MCP resource in `aud`
and being accepted by the resource-bound verifier, while a web session token
and a token of another audience are refused.

**Interim configuration: not a default, owner sign-off required.**
`audiences: ['authenticated']` with the exact issuer, `role: authenticated`
and `client: { kind: 'oauth' }` violates the MUST above. The wiring may use
it only through an explicit, named override in the deployment configuration
(never a fallback when the resource audience is missing), logged as a warning
at every start, and only after the owner has signed off, in the release
record, on these residual risks:

1. The token is not bound to our resource URI. Any access token this Supabase
   project issues to any of its OAuth clients for a user is accepted at
   `/mcp` for that user. This is bounded because the project serves only this
   product: the MCP server is its only OAuth-protected resource, and every
   such token results from that user's consent to that client.
2. The reverse direction is outside our verifier: a token issued for the MCP
   is also a valid user token for Supabase's own APIs (Data API, Storage,
   Auth). It cannot read or write scores there: the score tables grant
   nothing to the API roles (DATABASE.md §3.1, RLS-01/02).
3. A host that enforces audience binding itself may refuse these tokens
   (§1); OAUTH-04 must show whether connection works at all.

Logout does not revoke access tokens already issued: a stateless access token
stays valid until its `exp` (Supabase default 1 hour). No server mechanism for
instant invalidation exists, and none is claimed.

### 4.1 The Custom Access Token Hook (implementation notes)

What it relies on, read in the Supabase Auth source (`supabase/auth` master,
release v2.197.0); the documentation pages are less precise:

- Auth calls a Postgres hook as `select "<schema>"."<function>"($1)` with
  the event as JSON, as its own role `supabase_auth_admin` (search_path
  `auth`, no BYPASSRLS), inside the token transaction, under a short
  statement timeout (2 s by default). It runs before every access token is
  signed: any sign-in, the OAuth 2.1 server's authorization-code grant
  (`authentication_method: "oauth_provider/authorization_code"`) and every
  refresh (`"token_refresh"`).
- Event: `{ metadata, user_id, claims, authentication_method }`. The OAuth
  client is `claims.client_id` (its UUID), present on the first grant and on
  every refresh of an OAuth session, omitted otherwise; OAuth tokens also
  carry `claims.scope`. The Token Security guide's example reads a top-level
  `client_id`; the Auth source has none. So `client_id`, not
  `authentication_method`, identifies a token issued to an OAuth client.
- Output: `{ "claims": { ... } }`. Auth checks it against a minimal schema
  (required `aud`, `exp`, `iat`, `sub`, `email`, `phone`, `role`, `aal`,
  `session_id`, `is_anonymous`; `aud` a string or an array) and signs the
  returned claims as they are, so `aud` can be changed and extended to an
  array. A hook error or an invalid output fails the token request (HTTP 500)
  for every user, web sign-ins included.
- The `aud` in the event is `"authenticated"` or `["authenticated"]`: Auth's
  JWT library serializes a single audience as an array until the process has
  signed its first token. The hook accepts both.
- Auth's own bearer check (`parseJWTClaims`) does not verify `aud`, so an
  array `aud` keeps `/auth/v1/user` and logout working.

What `auth_hooks.custom_access_token_hook(event jsonb)` does:

1. No non-empty string `claims.client_id`: returns the claims unchanged. Web
   session tokens never gain the MCP audience.
2. Reads `private.app_settings`. `mcp_resource` unset: unchanged (fail
   closed, the resource-bound verifier answers `WRONG_AUDIENCE`).
   `mcp_allowed_client_ids` set and not naming the client: unchanged.
3. Otherwise `aud` becomes the existing audience(s) plus the resource, without
   duplicates: `"authenticated"` -> `["authenticated", "https://mcp.example.com/mcp"]`.
   Every other claim is returned as it came. This is the shape the test
   issuer's `mcpToken` produces (docs/testing/HARNESS.md).

Settings, rows in `private.app_settings` written by the migration role only,
after deployment (supabase/README.md, "Custom Access Token Hook"):

| Key                      | Value                                                                                                                                                             | When absent                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `mcp_resource`           | JSON string, exactly `canonicalResourceUri(MCP_PUBLIC_URL)`; a check constraint refuses a trailing slash, uppercase host, query, fragment, credentials, non-ASCII | the hook binds nothing (fail closed)                                            |
| `mcp_allowed_client_ids` | non-empty JSON array of lowercase OAuth client UUIDs                                                                                                              | every OAuth client of the project is bound (what dynamic registration requires) |

Any other key is refused, so a misspelled key cannot silently leave the hook
off.

Privileges. SECURITY INVOKER with `search_path = ''`, as Supabase recommends
for hooks (no SECURITY DEFINER). `supabase_auth_admin` gets USAGE on
`auth_hooks`, EXECUTE on the function, USAGE on `private` and SELECT on
`private.app_settings`, nothing more: it cannot change the settings. `anon`,
`authenticated`, `service_role`, `score_owner` and PUBLIC can neither call the
hook nor read the settings. The function has a schema of its own,
`auth_hooks`, not exposed by the Data API, so the Auth role's USAGE covers
this one function. `private.app_settings` has no Row Level Security: its only
reader has no BYPASSRLS, so a policy-less RLS table would hide every row from
it; grants are the control, and the values (a public URL, client IDs) are not
secret.

Residual risks the hook does not remove:

- The token keeps `authenticated` in `aud`, so it is still a valid user token
  for Supabase's own APIs (risk 2 of the interim list applies here too; the
  score tables grant nothing to the API roles). Dropping `authenticated`
  would narrow this, but only after OAUTH-04 shows that nothing in the host
  flow depends on it.
- With dynamic client registration, every client a user consents to receives
  MCP-bound tokens for that user; `mcp_allowed_client_ids` narrows this once
  clients are pre-registered.

Enabling it is project configuration, not schema: the Management API fields
`hook_custom_access_token_enabled` and `hook_custom_access_token_uri`
(`pg-functions://postgres/auth_hooks/custom_access_token_hook`), or the
Dashboard's Authentication > Hooks page, after the migration is pushed and
its grants checked. Exact steps: supabase/README.md.

## 5. Discovery and challenge builders

- `protectedResourceMetadata({ resource, authorizationServers, ... })` returns
  the RFC 9728 document: canonical `resource`, `authorization_servers` (the
  Supabase issuer), `bearer_methods_supported: ['header']`, optional
  `scopes_supported`, `resource_name`, `resource_documentation`.
- `protectedResourceMetadataUrl(resource)` inserts
  `/.well-known/oauth-protected-resource` between host and path:
  `https://mcp.example.com/mcp` ->
  `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`.
- `rejectionResponse(reason, { resourceMetadataUrl })` gives the answer of
  §3: `Bearer resource_metadata="..."` for a missing token; for every other
  token problem the same generic `error="invalid_token"` with the description
  `INVALID_TOKEN_DESCRIPTION` (the response never says which check failed);
  and `{ status: 503 }` for `KEYS_UNAVAILABLE`.
- `readBearerToken(header)`: no header or another scheme is `MISSING_TOKEN`;
  a Bearer value that is not one RFC 6750 `b64token` is `MALFORMED_TOKEN`.
- Scopes: Supabase's OAuth scopes (`openid`, `email`, `profile`, `phone`)
  only shape ID tokens and do not grant API access, so the challenge carries
  no `scope` by default and no `offline_access` (the spec says resources
  should not ask for it).
- **Deviation from a SHOULD.** The MCP spec (2025-11-25) says servers SHOULD
  include a `scope` parameter in the `WWW-Authenticate` challenge; clients
  otherwise fall back to `scopes_supported` in the metadata, which is absent
  too, and then request no scope. We deliberately send neither until OAUTH-04
  shows which scope requests Supabase's authorization endpoint accepts:
  supabase/auth#2820 reports that the consent flow fails on some
  authorization requests (`offline_access`, `resource`, public clients), and
  a scope we advertise is one every host will request. Once OAUTH-04 settles
  the set (for example `openid email`), the wiring passes the same value to
  `protectedResourceMetadata({ scopesSupported })` and to
  `rejectionResponse(reason, { scope })`; both builders already support it.

## 6. Wiring (done)

What the apps do, and where (MCP_SERVER.md §1-§2, API.md):

1. Configuration from the environment: the Supabase project URL
   (`supabaseAuthEndpoints(url)` derives issuer and JWKS URL) and the public
   MCP URL (`canonicalResourceUri`). No secret is needed to verify tokens.
2. apps/mcp: serve the metadata at `protectedResourceMetadataUrl(resource)`
   (public, GET, no auth) and guard every method of `/mcp`: read the bearer
   token, verify with `audiences: [canonicalResourceUri(MCP_URL)]` and
   `client: { kind: 'oauth' }` (§4; the interim audience only through the
   signed-off override, logged at start), answer
   `rejectionResponse(...)` with an `UNAUTHENTICATED` envelope body (#19) on
   failure, and pass `result.principal` to the tool handlers. Never forward
   the token anywhere. Done in `apps/mcp/src/auth.ts` (`createMcpAuth`,
   `protectedResourceMetadataHandler`, `mcpBearerGuard`), composed by
   `createMcpApp`.
3. apps/api: the same verifier with `client: { kind: 'session' }` on each
   protected route (401 challenge: `WWW-Authenticate: Bearer`). Done in
   `apps/api/src/auth.ts` (`createSessionVerifier`, `SessionAuthGuard`).
4. Log `reason` with the correlation ID; never log the token (#19 redaction
   masks it anyway).

## 7. Tests

| Test            | File                                                                                         | Covers                                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAUTH-01        | `packages/auth-jwt/test/oauth-01-verifier.test.ts`                                           | accepted tokens incl. tolerance edges and resource-bound `aud`; bad signature, swapped payload, embedded attacker key, unknown kid, issuer, audience, expiry, nbf/iat, missing claims, roles, HS256/none/RS256, client binding; configuration; bounded remote JWKS refresh and outage |
| OAUTH-02 (unit) | `packages/auth-jwt/test/oauth-02-discovery.test.ts`                                          | metadata document and URL, canonical resource, challenge per reason, bearer extraction                                                                                                                                                                                                |
| OAUTH-03        | `packages/auth-jwt/test/oauth-03-identity.test.ts`                                           | A/B principals, email/metadata/look-alike claims ignored, email change, frozen principal                                                                                                                                                                                              |
| OAUTH-02 (wire) | `apps/mcp/test/oauth-02-mcp-auth.int.test.ts`, `apps/api/test/oauth-02-api-auth.int.test.ts` | 401 + reachable metadata on the real `/mcp`, one expired/wrong-resource request, one missing-token check per protected REST route                                                                                                                                                     |
| OAUTH-05        | `packages/persistence-postgres/test/hook/oauth-05-access-token-hook.int.test.ts`             | the hook of §4.1 run as `supabase_auth_admin`: OAuth token (string or array `aud`, grant or refresh) bound, session tokens unchanged, fail closed without the setting or outside the allow-list, privileges, settings validation                                                      |
| OAUTH-04        | release smoke (release gate, §4)                                                             | real Supabase OAuth flow with a real host; the access token carries the MCP resource in `aud` (hook) and is accepted, session and foreign-audience tokens refused; the issues of §1; the scope set of §5                                                                              |

## Sources

- Supabase, OAuth 2.1 Server: <https://supabase.com/docs/guides/auth/oauth-server>
- Supabase, Getting Started with OAuth 2.1 Server: <https://supabase.com/docs/guides/auth/oauth-server/getting-started>
- Supabase, MCP Authentication: <https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication>
- Supabase, Token Security & RLS: <https://supabase.com/docs/guides/auth/oauth-server/token-security>
- Supabase, JWT Claims Reference: <https://supabase.com/docs/guides/auth/jwt-fields>
- Supabase, JWT Signing Keys: <https://supabase.com/docs/guides/auth/signing-keys>
- Supabase, Auth Hooks: <https://supabase.com/docs/guides/auth/auth-hooks>
- Supabase, Custom Access Token Hook: <https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook>
- Supabase Auth source, release v2.197.0 (read 2026-09-29): `internal/tokens/service.go` (`GenerateAccessToken`, `MinimumViableTokenSchema`), `internal/hooks/v0hooks/v0hooks.go` (`CustomAccessTokenInput`), `internal/hooks/hookspgfunc/hookspgfunc.go`, `internal/api/oauthserver/handlers.go`: <https://github.com/supabase/auth>
- Supabase Management API, `PATCH /v1/projects/{ref}/config/auth`: <https://api.supabase.com/api/v1>
- supabase/auth#2820: <https://github.com/supabase/auth/issues/2820>
- anthropics/claude-ai-mcp#1038: <https://github.com/anthropics/claude-ai-mcp/issues/1038>
- MCP Authorization 2025-11-25: <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
- MCP Authorization 2026-07-28 (current): <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>
- RFC 9728 Protected Resource Metadata, RFC 8707 Resource Indicators, RFC 6750 Bearer Token Usage
