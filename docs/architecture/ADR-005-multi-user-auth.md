# ADR-005 — Multi-user authentication with Supabase Auth and OAuth 2.1 for MCP

- **Status:** Accepted for MVP
- **Date:** 2026-09-28
- **Scope:** MVP v1

## Context

The MVP will be shared with external testers. It therefore requires real multi-user identity from the first testable release:

- sign up;
- sign in;
- sign out;
- password recovery / account recovery;
- user-isolated saved scores;
- authenticated remote MCP access from compatible AI hosts.

A single-user or hard-coded-owner implementation is rejected.

The same user must be identifiable consistently from the web application, NestJS HTTP adapter, persistence layer, and MCP server.

## Decision

Use **Supabase Auth** as the MVP identity provider.

Use:

1. standard Supabase Auth for the web application's user registration/session flows;
2. Supabase OAuth 2.1 / OIDC server capabilities as the upstream authorization server for the remote MCP;
3. JWT validation at the HTTP/MCP boundary;
4. a provider-neutral application identity type internally.

Supabase Auth is an infrastructure adapter. Domain/application code MUST NOT depend on Supabase SDK types.

## Identity boundary

Application use cases receive a neutral principal:

```ts
type UserId = string

type AuthenticatedPrincipal = {
  userId: UserId
}
```

Inbound adapters are responsible for converting provider identity into this value.

```text
Web session -----------\
NestJS Bearer token ----+--> Auth adapter --> UserId --> Application use case
MCP OAuth token --------/
```

No application use case accepts a client-supplied owner ID as authority.

## Web authentication

MVP requires:

- email/password sign-up;
- email/password sign-in;
- sign-out;
- session restoration;
- password-reset flow;
- basic authenticated-route protection.

Social login is not required for MVP unless essentially free after the base flow works.

## MCP authorization model

The remote MCP server is an OAuth-protected resource.

Expected flow:

```text
AI/MCP host
    |
    | request /mcp
    v
MCP resource server
    |
    | unauthenticated => HTTP 401 + WWW-Authenticate
    v
Protected Resource Metadata
    |
    v
Supabase OAuth 2.1 authorization server
    |
    v
User login + consent
    |
    v
OAuth code + PKCE -> access token
    |
    v
MCP request with Bearer token
    |
    v
JWT validation -> UserId
```

The MCP server MUST:

- expose OAuth Protected Resource Metadata required by the MCP authorization flow;
- advertise Supabase as the authorization server;
- return HTTP 401 for unauthenticated protected MCP access, rather than a tool-level auth error;
- validate issuer, signature, expiry and intended resource/audience as required by the chosen token configuration;
- use JWKS/asymmetric token validation;
- map the authenticated token subject/user claim to the application's neutral `UserId`;
- pass the authenticated principal to tool handlers/use cases.

## Authorization strategy

For MVP, use **per-server authorization**: the MCP is user-specific and all product tools operate in a user's context.

Therefore every MCP request requires a valid authenticated user.

This is simpler and safer than mixing public and private tools.

## Persistence ownership

Every persisted score MUST be owner-scoped.

Conceptually:

```text
scores
--------------------------------
id
owner_user_id
score_spec JSONB
revision
title
tags
created_at
updated_at
```

Repository operations must always receive the authenticated `UserId`.

A user may never fetch/search/update another user's scores merely by knowing their score IDs.

## Database defense in depth

Use database Row Level Security where supported so ownership is enforced in addition to application-layer checks.

Authorization must not rely only on hidden UI or model behavior.

## User lifecycle

For MVP:

- a new account starts with an empty library;
- deleting an account is not required in the first coding slice but must not be made architecturally impossible;
- scores belong to the stable auth user ID;
- changing email must not change score ownership identity.

## Provider isolation

Create an auth boundary/adapter rather than importing Supabase throughout the codebase.

Allowed:

```text
apps/web -> Supabase browser auth adapter
apps/api -> Supabase JWT/auth adapter
apps/mcp -> Supabase OAuth/JWT adapter
persistence adapter -> Supabase/Postgres infrastructure
```

Forbidden:

```text
music-domain -> Supabase
music-application -> Supabase
ScoreSpec -> auth-provider claims
ScoreOperation -> auth-provider claims
```

If the identity provider changes later, canonical scores and application use cases must remain unchanged.

## Security requirements

- never trust `userId` sent in tool or REST payloads;
- obtain user identity from validated auth context;
- use asymmetric JWT signing/JWKS for OAuth deployment;
- no service-role/server secret in browser bundles or MCP App iframe;
- server-side privileged credentials remain server-only;
- owner filters and/or RLS apply to every saved-score operation;
- auth errors must not leak sensitive provider details.

## Consequences

### Positive

- real multi-user MVP can be shared immediately;
- one user identity works across web + MCP;
- no custom OAuth authorization server needs to be invented;
- Supabase/Postgres ownership and RLS integrate naturally;
- provider-neutral application boundary remains replaceable.

### Trade-offs / risk

- additional UI and authorization work before persistence is complete;
- OAuth consent flow must be tested in actual MCP hosts;
- Supabase OAuth 2.1 server capability is currently a beta-stage dependency and therefore remains isolated behind our auth boundary.

## Acceptance criteria

- [ ] A new tester can create an account.
- [ ] Tester can sign in/out and recover access.
- [ ] Web session maps to a stable application `UserId`.
- [ ] Remote MCP connection initiates a standards-compliant OAuth flow.
- [ ] MCP access token maps to the same stable `UserId`.
- [ ] Unauthenticated MCP access receives the required HTTP auth challenge.
- [ ] User A cannot list/get/update User B's saved scores.
- [ ] RLS/authorization tests prove cross-user isolation.
- [ ] Domain/application packages contain no Supabase auth imports.
