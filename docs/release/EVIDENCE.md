# Release evidence

Where each issue of MVP v1 (#2-#27) is proven, and the record of one release.
The issue map below is filled from the repository. A test ID followed by a
test file names a `describe` or test title in that file (a bare file name is
in the directory of the path before it), except where the row names what
stands in for it: BUILD-01/02 are the `quality` job and the Vitest
configuration, BUILD-03 is the CI-02 fixture test, ASSET-02 is the assets
step of MCP-UI-01, and CI-01..06 are the jobs of `ci.yml` that CI.md
describes. The release record at the end is a template, filled once per
release from [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). A listed test is
evidence only when it passed at the release commit: the map says where to
look, not that it passed.

Categories: **unit** and **component** run with `pnpm test`, **integration**
with `pnpm test:integration`, **mcp-ui** with `pnpm test:mcp-ui` (after
`pnpm build`), **arch** with `pnpm check:arch`, **deploy** with
`pnpm check:deploy`, **cloud** with `node tools/release/cloud-smoke.ts`
(opt-in, release only), **human** by a person.

## Issue map

| Issue                             | Owned executable evidence (ID: file, category)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Reused, not repeated                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| #2 ScoreSpec v1                   | SPEC-01..07: `packages/test-fixtures/test/spec-01-schema.test.ts`, `spec-02-structure-limits.test.ts`, `spec-03-rhythm.test.ts`, `spec-04-pitch-labels.test.ts`, `spec-05-references-spans.test.ts`, `spec-06-annotations.test.ts`, `spec-07-feel.test.ts` (unit)                                                                                                                                                                                                                                                                                                                      | MCP-CREATE-02 (#12) propagation                                        |
| #3 ScoreOperations v1             | OPS-01..06: `packages/test-fixtures/test/ops-01-dispatch.test.ts`, `ops-02-batch-revision.test.ts`, `ops-03-structure.test.ts`, `ops-04-references-colors.test.ts`, `ops-05-transposition.test.ts`, `ops-06-semantic-independence.test.ts` (unit); EditScore branches: `packages/music-application/test/edit-score.test.ts` (unit)                                                                                                                                                                                                                                                     | MCP-EDIT-01..03 (#13), DB-03 (#9), DRAFT-04 (#22)                      |
| #4 Monorepo scaffold              | BUILD-01: CI job `quality` (frozen install, typecheck, lint, build); BUILD-02: the disjoint Vitest projects of `vitest.config.ts` (`pnpm test` starts no database or browser); BUILD-03: the CI-02 test `tools/architecture/forbidden-fixture.test.ts` ("architecture rules on the forbidden fixture", arch)                                                                                                                                                                                                                                                                           | CI-01/02 (#17)                                                         |
| #5 VexFlow renderer               | REN-01..03: `packages/renderer-vexflow/test/ren-01-semantic-mapping.test.ts`, `ren-02-identity.test.ts`, `ren-03-lifecycle.test.ts` (unit); REN-I01: `packages/renderer-vexflow/test/ren-i01-vexflow.mcpui.test.ts` (mcp-ui)                                                                                                                                                                                                                                                                                                                                                           | MCP-UI-01 (#11) notation step                                          |
| #6 Playback compiler and engine   | AUDIO-01..07: `packages/playback-core/test/audio-01-pitch-time.test.ts` ... `audio-07-async-resources.test.ts` (unit); engine in Chromium: `packages/playback-spessasynth/test/spessasynth-engine.mcpui.test.ts` (mcp-ui)                                                                                                                                                                                                                                                                                                                                                              | MCP-UI-01/02 (#11); paired slur listening: ASSET-03 (#23, human)       |
| #7 ScorePlayer UI                 | UI-01..05: `packages/score-ui/test/ui-01-controls.test.tsx`, `ui-02-annotations.test.tsx`, `ui-03-revisions.test.tsx`, `ui-04-failures.test.tsx`, `ui-05-lifecycle.test.tsx` (component)                                                                                                                                                                                                                                                                                                                                                                                               | MCP-UI-02 (#11) wiring of P-01                                         |
| #8 CreateScore                    | CREATE-01/02: `packages/music-application/test/create-01-create-score.test.ts`, `create-02-create-score-rejections.test.ts` (unit)                                                                                                                                                                                                                                                                                                                                                                                                                                                     | FLOW-01 create step, MCP-CREATE-01/02 (#12), DRAFT-02 (#22)            |
| #9 Repository and JSONB           | DB-01..04: `packages/persistence-postgres/test/db-01-round-trip.int.test.ts`, `db-02-search.int.test.ts`, `db-03-compare-and-swap.int.test.ts`, `db-04-failures.int.test.ts` (integration)                                                                                                                                                                                                                                                                                                                                                                                             | RLS-01..03 (#27), ACCESS-01 (#18)                                      |
| #10 Save/Get/Search use cases     | LIB-01..03: `packages/music-application/test/lib-01-save-preconditions.test.ts`, `lib-02-reads.test.ts`, `lib-03-metadata.test.ts` (unit)                                                                                                                                                                                                                                                                                                                                                                                                                                              | FLOW-01; human save approval: host check steps 6-7                     |
| #11 MCP server and View           | MCP-P01: `apps/mcp/test/mcp-p01-setup-discovery.int.test.ts`; MCP-P02: `apps/mcp/test/mcp-p02-boundary-failures.int.test.ts` (integration); MCP-U01: `apps/mcp/view/test/mcp-u01-view-payload.test.ts`, `mcp-u01-score-view.test.tsx`; View wiring: `apps/mcp/view/test/mcp-view-wiring.test.tsx`; MCP-CONFIG-01: `apps/mcp/test/mcp-config-01.test.ts`; `apps/mcp/src/app.test.ts`, `apps/mcp/src/view-resource.test.ts` (unit, component); assets route: `apps/mcp/src/static-assets.int.test.ts` (integration); MCP-UI-01..03: `apps/mcp/test/mcp-ui/mcp-ui.mcpui.test.ts` (mcp-ui) | host CSP gate: host check step 4 (human)                               |
| #12 create_score                  | MCP-CREATE-01/02: `apps/mcp/test/mcp-create-score.int.test.ts` (integration)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | FLOW-01, ACCESS-01                                                     |
| #13 edit_score                    | MCP-EDIT-01/02/03: `apps/mcp/test/mcp-edit-score.int.test.ts` (integration)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | FLOW-01, MCP-UI-02/03                                                  |
| #14 save/get/search tools         | MCP-LIB-01, MCP-SAVE-02, MCP-GET-02, MCP-SEARCH-02: `apps/mcp/test/mcp-library.int.test.ts` (integration)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | FLOW-01, ACCESS-01; decline/approve save: host check steps 6-7 (human) |
| #15 Saved library (React)         | LIB-UI-01..03: `apps/web/src/library/test/lib-ui-01-states.test.tsx`, `lib-ui-02-search.test.tsx`, `lib-ui-03-open.test.tsx` (component); `apps/web/src/api/test/api-config.test.ts`, `apps/web/src/api/test/supabase-access-token.test.ts` (unit)                                                                                                                                                                                                                                                                                                                                     | FLOW-01 (REST contract); AUTH-UI-I01 library step (cloud)              |
| #16 Vercel deployment             | DEPLOY-01: `tools/deploy/deploy-01-scanners.test.ts`, `tools/deploy/deploy-01.int.test.ts` (deploy, also the CI `deploy` job); DEPLOY-02: `tools/deploy/verify-deployment.ts` against the production deployment before testers are invited (checklist step 6), not an isolated preview, and without the MCP-UI smoke, for which the cloud suites and the host check stand in: owner sign-off "DEPLOY-02 scope"; DEPLOY-03: DB-01 and DRAFT-02 at the old and new commit when stored data changes (checklist step 1)                                                                    | health/version HTTP-SYS-01 (#21); host check (human)                   |
| #17 CI and architecture           | CI-01..06: `.github/workflows/ci.yml` and docs/testing/CI.md; CI-02: `tools/architecture/forbidden-fixture.test.ts` plus `depcruise` (arch); CI-04: `tools/inventory/ci-04-manifest.test.ts` (unit), `tests/acceptance/ci-04-exposed-surface.int.test.ts` (integration); branch protection: manual (CI.md §3)                                                                                                                                                                                                                                                                          | every suite of this map                                                |
| #18 Acceptance harness            | FLOW-01: `tests/acceptance/flow-01-public-lifecycle.int.test.ts`; ACCESS-01: `tests/acceptance/access-01-route-ownership.int.test.ts` (integration); HARNESS-01: `packages/auth-jwt/testing/harness-01-test-issuer.test.ts`, `packages/test-fixtures/test/f12-harness-data.test.ts`, `packages/persistence-postgres/test/rls/test-database-guard.test.ts` (unit)                                                                                                                                                                                                                       | CI-04 surface (#17)                                                    |
| #19 Errors and logging            | ERR-01: `packages/server-common/test/err-01-error-mapping.test.ts`; ERR-02: `packages/server-common/test/err-02-redaction-context.test.ts`; ENVELOPE-01: `packages/music-contracts/test/envelope-01-error-codes.test.ts` (unit); ERR-I01: `apps/mcp/test/err-i01-dependency-failure.int.test.ts`, `apps/api/test/err-i01-dependency-failure.int.test.ts` (integration)                                                                                                                                                                                                                 | `apps/mcp/src/app.test.ts` (MCP HTTP last resort)                      |
| #20 Auth umbrella                 | no suite of its own: [AUTH_UMBRELLA.md](../architecture/AUTH_UMBRELLA.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | #25, #26, #27, #18, #17, #16                                           |
| #21 NestJS HTTP adapter           | HTTP-LIST-01, HTTP-GET-01, HTTP-SYS-01: `apps/api/test/http-routes.int.test.ts` (integration); configuration: `apps/api/test/api-config.test.ts` (unit)                                                                                                                                                                                                                                                                                                                                                                                                                                | FLOW-01, ACCESS-01, OAUTH-02 (REST), SEC-02/03 (api), ERR-I01 (Nest)   |
| #22 Drafts with TTL               | DRAFT-01: `packages/music-application/test/draft-01-expiry.test.ts` (unit); DRAFT-02..04: `packages/persistence-postgres/test/draft-02-durability.int.test.ts`, `draft-03-cleanup.int.test.ts`, `draft-04-promotion.int.test.ts` (integration)                                                                                                                                                                                                                                                                                                                                         | MCP-SAVE-02, MCP-GET-02 (#14)                                          |
| #23 Piano SoundFont               | ASSET-01: `packages/playback-spessasynth/test/asset-01.test.ts` (unit); ASSET-02: MCP-UI-01 assets step (`apps/mcp/test/mcp-ui/mcp-ui.mcpui.test.ts`, mcp-ui); ASSET-03: listening review (checklist step 9, human) with its inputs checked by `tools/release/asset-03-scores.test.ts` (cloud project, no network)                                                                                                                                                                                                                                                                     | SpessaSynth engine in Chromium (#6); asset headers: DEPLOY-02 (#16)    |
| #24 Input limits and hardening    | SEC-01: `packages/server-common/test/sec-01-input-safety.test.ts` (unit); SEC-02: `apps/mcp/test/sec-02-request-protection.int.test.ts`, `apps/api/test/sec-02-sec-03-api-protection.int.test.ts` (integration); SEC-03: `packages/server-common/test/sec-03-rate-limit.test.ts` (unit), `packages/persistence-postgres/test/sec-03-rate-limit-store.int.test.ts`, `apps/mcp/test/sec-03-rate-limit.int.test.ts`, `apps/api/test/sec-02-sec-03-api-protection.int.test.ts` (integration)                                                                                               | ACCESS-01, RLS (#27), OAUTH-02 (#26)                                   |
| #25 Web auth UI                   | AUTH-UI-01..03: `apps/web/src/test/auth-ui-01-forms.test.tsx`, `auth-ui-02-session.test.tsx`, `auth-ui-03-recovery-redirect.test.tsx`; adapter: `apps/web/src/test/supabase-auth-adapter.test.tsx` (component); `apps/web/src/test/config.test.ts` (unit); AUTH-UI-I01: `tests/cloud/auth-ui-i01.cloud.test.ts` (cloud)                                                                                                                                                                                                                                                                | account reused by the host check                                       |
| #26 MCP OAuth 2.1 and UserId      | OAUTH-01/03: `packages/auth-jwt/test/oauth-01-verifier.test.ts`, `oauth-03-identity.test.ts`; OAUTH-02 builders: `packages/auth-jwt/test/oauth-02-discovery.test.ts` (unit); OAUTH-02 wire: `apps/mcp/test/oauth-02-mcp-auth.int.test.ts`, `apps/api/test/oauth-02-api-auth.int.test.ts`; OAUTH-05 hook: `packages/persistence-postgres/test/hook/oauth-05-access-token-hook.int.test.ts` (integration); OAUTH-04 provider: `tests/cloud/oauth-04-provider.cloud.test.ts` (cloud); OAUTH-04 host: [HOST_CHECK.md](HOST_CHECK.md) (human)                                               | ACCESS-01 concurrent cross-user (OAUTH-03 reuse)                       |
| #27 Owner-scoped persistence, RLS | RLS-01..03: `packages/persistence-postgres/test/rls/rls-01-read.int.test.ts`, `rls-02-write.int.test.ts`, `rls-03-functions-claims.int.test.ts` (integration)                                                                                                                                                                                                                                                                                                                                                                                                                          | ACCESS-01 (route level)                                                |

Release tooling (not product evidence, run with the cloud project, no
network, also in the CI `quality` job):
`tests/cloud/support/cloud-support.test.ts` (opt-in gate, configuration,
identities, PKCE, token claims, step blocking, redaction),
`tools/release/cloud-smoke.test.ts` (refusal, redaction, evidence block) and
`tools/release/asset-03-scores.test.ts` (the ASSET-03 inputs).

## Release record (template)

Copy this section per release; fill every field or write why it is not
filled. No token, key, password, authorization code or connection string.

### Identification

| Field              | Value                                |
| ------------------ | ------------------------------------ |
| Release            | tag or name                          |
| Commit             | SHA (all three deployments build it) |
| Date               |                                      |
| Run by             |                                      |
| Web / API / MCP    | origins, and `<MCP URL>`             |
| Supabase project   | project ref (not a key)              |
| Vercel deployments | the three production deployment URLs |

### Automated suites at the release commit

| Command                                      | Result (counts, or failure) |
| -------------------------------------------- | --------------------------- |
| CI run (URL), all jobs                       |                             |
| `pnpm typecheck` and the two extra `tsc -p`  |                             |
| `pnpm lint`                                  |                             |
| `pnpm build`                                 |                             |
| `pnpm test` (unit, component)                |                             |
| release tooling (`--project cloud`, offline) |                             |
| `pnpm test:integration`                      |                             |
| `pnpm test:mcp-ui`                           |                             |
| `pnpm check:arch`                            |                             |
| `pnpm check:deploy` (DEPLOY-01)              |                             |

### Deployment and configuration (checklist steps 0.1-6)

| Step                             | Result                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| 0.1 Vercel projects and hosts    | project names, production hostnames, CSP `connect-src` commit                           |
| 1. Migrations pushed             | dry-run list, push output                                                               |
| 2. Supabase configuration        | Enforce SSL, ES256 key, Site URL, Redirect URLs, confirm email, SMTP, OAuth server, DCR |
| 3-4. Environment and deployments | variables set (names only), deployment URLs built from a clean worktree of the commit   |
| 5. Hook                          | privilege check, enabled, web sign-in still works, `mcp_resource` value, dry run        |
| 6. DEPLOY-02                     | `verify-deployment.ts` output                                                           |

### Cloud suites (checklist step 7)

Paste the evidence block printed by `tools/release/cloud-smoke.ts` here
(commit, hosts, every AUTH-UI-I01 and OAUTH-04 step with status and
observations).

### Target-host check (checklist step 8)

Paste the record block of [HOST_CHECK.md](HOST_CHECK.md) here.

### ASSET-03 listening review (checklist step 9)

Date, reviewer, browser and version, device and OS, where it was played, the
table of the checklist, verdict.

### Owner sign-offs (checklist step 10)

| Decision                              | Choice | Name, date |
| ------------------------------------- | ------ | ---------- |
| SoundFont provenance residual risk    |        |            |
| ASSET-03 verdict                      |        |            |
| OAuth host path and scope set         |        |            |
| Audience mode                         |        |            |
| Dynamic client registration           |        |            |
| SMTP provider and sender              |        |            |
| Localhost redirect URLs on production |        |            |
| DEPLOY-02 scope (no isolated preview) |        |            |
| Documented limits accepted            |        |            |
| Branch protection (or unverified)     |        |            |
| Go / no-go                            |        |            |

## Release record: MVP v1 release candidate 1 (2026-09-29)

### Identification

| Field              | Value                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release            | MVP v1 RC1 (branch `feat/mvp-v1-implementation`, not yet merged)                                                                                       |
| Commit             | `c9454671b34fc07d6ce2ceda109bf9f72647b7d2` (all three deployments built from a clean worktree of it)                                                   |
| Date               | 2026-09-29                                                                                                                                             |
| Run by             | Claude Code (coding agent) for the owner                                                                                                               |
| Web / API / MCP    | `https://sheet-music-for-ai-web.vercel.app`, `https://sheet-music-for-ai-api.vercel.app`, `https://sheet-music-for-ai-mcp.vercel.app/mcp`              |
| Supabase project   | `aebdzppogfvwbibcmpza` (eu-west-3, PostgreSQL 17.6)                                                                                                    |
| Vercel deployments | api `dpl_Gn6cm6Mt2GcLFwXc5JxY28vbpF4K`, mcp `dpl_HDo2or47aPLMpSyQhBsjMSyaJyD4`, web `dpl_36a1hKyCSHKuiuWuaPpWwJob3Yc6` (team vibeworker1, region cdg1) |

### Automated suites at the release commit (local, PostgreSQL 15)

| Command                                      | Result                         |
| -------------------------------------------- | ------------------------------ |
| CI run (URL), all jobs                       | first run on the pull request  |
| `pnpm typecheck` and the two extra `tsc -p`  | exit 0                         |
| `pnpm lint`                                  | exit 0 (ESLint + Prettier)     |
| `pnpm build`                                 | exit 0                         |
| `pnpm test` (unit, component)                | 1077 passed                    |
| release tooling (`--project cloud`, offline) | 66 passed                      |
| `pnpm test:integration`                      | 471 passed                     |
| `pnpm test:mcp-ui`                           | 30 passed                      |
| `pnpm check:arch`                            | no violations, 9 passed        |
| `pnpm check:deploy` (DEPLOY-01)              | 26 passed (real public values) |

### Deployment and configuration

| Step                             | Result                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 Vercel projects and hosts    | `sheet-music-for-ai-{web,api,mcp}`, root directories `apps/*`, Node 24.x; hostnames as planned; CSP `connect-src` lists the Supabase project and the API                                                                                                      |
| 1. Migrations pushed             | dry run then push of the 5 migrations (score storage, draft cleanup, rate-limit store, maintenance schedule, access-token hook); both pg_cron jobs scheduled; `postgres` member of `score_owner`; `lower('É') = 'é'`                                          |
| 2. Supabase configuration        | Enforce SSL on; ES256 in use; Site URL = web origin; Redirect URLs = `<web>/**` (no localhost); confirm email on; minimum password 8; OAuth 2.1 server on, authorization path `/oauth/consent`, dynamic registration on; custom SMTP NOT configured           |
| TLS                              | Supabase Root 2021 CA from the official download, SHA-256 `80:70:25:AD:…:CA:FA`, identical to the root served by the pooler; `verify-full` to `aws-1-eu-west-3.pooler.supabase.com:6543` succeeds                                                             |
| 3-4. Environment and deployments | web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`; api/mcp: `SUPABASE_URL`, `DATABASE_URL` (sensitive), `DATABASE_CA_CERT`, `NODEJS_HELPERS`; api `API_ALLOWED_ORIGINS`; mcp `MCP_PUBLIC_URL`, `MCP_AUTH_AUDIENCE_MODE=resource` |
| 5. Hook                          | privilege check t,t,t,t,f,f,f; hook enabled; `mcp_resource` = `https://sheet-music-for-ai-mcp.vercel.app/mcp`; dry run: OAuth-client token aud `["authenticated", "<MCP>/mcp"]`, session token aud `"authenticated"`                                          |
| 6. DEPLOY-02                     | `verify-deployment.ts`: 60/60 checks passed (web headers/CSP/assets, API health/version/401/CORS, MCP 401 challenge, RFC 9728 metadata, `/assets` headers)                                                                                                    |

### Cloud suites

- **OAUTH-04 (provider part): 13/13 passed** against the deployed stack: 401 challenge and RFC 9728 metadata; RFC 8414 metadata with S256 PKCE; public client from dynamic registration; supabase/auth#2820 probe HTTP 200 with and without `resource` (public and confidential clients); deny gives `access_denied` without code; approve after sign-in gives a code; PKCE token exchange; `aud` holds the MCP resource; `initialize`, `tools/list`, `create_score` accepted; a score saved through MCP is listed by `GET /scores` for the same account's web session; web session token refused at `/mcp`; OAuth token refused by the REST API; refresh keeps the audience. Synthetic user, scores and clients removed afterwards (0 users, 0 scores, 0 drafts; clients soft-deleted).
- **AUTH-UI-I01: not run.** It sends a real sign-up and a real recovery mail; the project has no custom SMTP and Supabase's default sender only mails team members (2 mails/hour). Blocked on the SMTP decision.

### Target-host check

Not run: needs a person with an authorized Claude account (HOST_CHECK.md). This also decides the host CSP question (`font-src data:`, `'wasm-unsafe-eval'`).

### ASSET-03 listening review

Not run: needs a person (RELEASE_CHECKLIST step 9).

### Owner sign-offs

Pending: SoundFont provenance (AKAI samples' public-domain status rests on the upstream author's statement), ASSET-03 verdict, SMTP provider, branch protection, go/no-go. Decided by the owner on 2026-09-28/29: Supabase cloud project, three Vercel projects in team vibeworker1, audience mode `resource` with the access-token hook, OAuth server with dynamic registration.
