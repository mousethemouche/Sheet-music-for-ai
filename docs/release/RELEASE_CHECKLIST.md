# Release checklist (MVP v1)

The ordered steps to take one commit to the first external testers, and the
evidence each step leaves in [EVIDENCE.md](EVIDENCE.md). Nothing here runs in
CI: the steps touch the Supabase cloud project and the Vercel team, so they
run once the owner has approved the release, by the person or agent the owner
names. Secrets live in the Vercel and Supabase settings or in the runner's
environment, never in the repository, a shell history file, an issue or the
evidence.

## Topology

```text
                      +--------------------------+
 tester's browser --->| web  (Vercel, static SPA)|--- GET /scores ---> api (Vercel, Node function)
        |             |  /oauth/consent, /library|                      NestJS, session tokens only
        |             +--------------------------+                        |
        | sign-in, recovery, consent                                      | DATABASE_URL (pooler 6543)
        v                                                                 v
 Supabase project (PostgreSQL 17, Auth: ES256 JWT, OAuth 2.1 server,  <---+--- mcp (Vercel, Node function)
   Custom Access Token Hook, custom SMTP)                                      POST /mcp, /assets/*,
        ^                                                                      /.well-known/oauth-protected-resource/mcp
        | OAuth authorize, token, refresh (DCR or pre-registered client)          ^
 MCP host (claude.ai) --------------------------------------------------------- Bearer token (aud = MCP resource)
```

| Vercel project | Root Directory | Serves                                                                                              | Build (vercel.json)    |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| web            | `apps/web`     | the SPA (auth pages, consent page, library, player), SoundFont and worklet under `/assets/`         | `apps/web/vercel.json` |
| api            | `apps/api`     | `GET /scores`, `GET /scores/:id`, `/health`, `/version` from one Node function                      | `apps/api/vercel.json` |
| mcp            | `apps/mcp`     | `POST /mcp` and the RFC 9728 metadata from one Node function; the View's playback assets `/assets/` | `apps/mcp/vercel.json` |

The three projects belong to one Vercel team and build from this pnpm
monorepo. Their configuration, the serverless entry points and the local
DEPLOY-01 checks are #16's (`apps/*/vercel.json`, `tools/deploy/`,
`docs/deploy/VERCEL.md`). Below, `<web origin>`, `<api origin>` and
`<MCP URL>` (`https://<mcp host>/mcp`) are the production values read in
step 0 once the Vercel projects exist.

## 0. Release commit, hosts and local gates

1. Create the three Vercel projects and read their production hostnames:
   docs/deploy/VERCEL.md §6 steps 1-4 (create the projects, place the
   functions next to the database, read the domains with
   `vercel api /v9/projects/<name>/domains`, fix the CSP `connect-src` of
   `apps/web/vercel.json` if a name differs from the planned one, re-run
   `pnpm check:deploy` with the real public values, commit). This is the
   first cloud action and comes before steps 2, 3 and 5, which write the
   hostnames into Supabase (Site URL, Redirect URLs, the hook's
   `mcp_resource`), the API CORS list and the MCP resource URL: a
   `*.vercel.app` name is only known once its project exists.
2. Choose the release commit on `main` (or the release branch), after the
   commit of item 1, and record its SHA (`RELEASE_SHA`). Its CI run must be
   green on every job (CI.md §1, DEPLOY-01 included); a pushed `v*` tag also
   runs MCP-UI. Locally, with the test Postgres:

   ```sh
   pnpm install --frozen-lockfile
   pnpm typecheck && pnpm exec tsc -p tests/acceptance/tsconfig.json && pnpm exec tsc -p tests/cloud/tsconfig.json
   pnpm lint && pnpm build && pnpm test && pnpm check:arch
   pnpm exec vitest run --project cloud tests/cloud/support tools/release   # release tooling, offline
   pnpm test:integration
   pnpm exec playwright install chromium && pnpm test:mcp-ui
   pnpm check:deploy                 # DEPLOY-01 (#16): builds each app as Vercel does
   ```

3. Record each command with its test counts in EVIDENCE.md, "Automated
   suites at the release commit".

## 1. Database migrations

With the Supabase CLI logged in (`supabase login`, a personal access token
kept by the CLI) and as the project's `postgres` role (supabase/README.md,
"Cloud deployment"):

```sh
supabase link --project-ref <project-ref>
supabase db push --dry-run          # review: the migrations not yet applied
supabase db push
```

Expected, on a new project, in order: `20260928210000_score_storage`,
`20260928210100_draft_cleanup`, `20260928210200_rate_limit_store`,
`20260928210300_schedule_maintenance`, `20260929092000_mcp_access_token_hook`.
Migrations are forward-only; a failed push stops the release.

DEPLOY-03 (#16): the first release has no stored data to carry over. For a
later release that changes stored data, run DB-01 and DRAFT-02 (and DRAFT-03/04
when drafts change) at the old and the new commit against the same persisted
fixture before pushing.

Record: the dry-run list and the push result.

## 2. Supabase configuration (Auth and database TLS)

In the Supabase dashboard of the project (values, never keys, go to the
evidence):

- **Database TLS** (Database Settings): "Enforce SSL on incoming
  connections" on, so no client reaches the database in plaintext; download
  the root certificate (SSL Configuration > Download certificate) for
  `DATABASE_CA_CERT` (step 3). It is public, but keep it outside the
  repository.
- **JWT signing keys**: the current key is ES256 (asymmetric); the JWKS at
  `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` lists it.
- **URL Configuration**: Site URL = `<web origin>` (the OAuth consent page is
  built from it); Redirect URLs include `<web origin>/**` (confirmation link
  to `/login?next=...`, recovery link to `/reset-password`). Adding
  `http://localhost:5173/**` on the production project is an owner decision
  (step 10): any local dev server could then receive production sessions.
- **Email**: provider enabled, "Confirm email" on, minimum password length at
  least 8 (the UI checks 8).
- **SMTP**: custom SMTP is required. The default service only mails the
  project's team members: every tester sign-up and recovery mail fails
  (`email_address_not_authorized`), and so does AUTH-UI-I01. Use a sender
  domain with SPF and DKIM, and set the email rate limit high enough for the
  testers plus two mails per cloud-smoke run.
- **OAuth 2.1 server** (Authentication > OAuth Server): enabled;
  Authorization Path `/oauth/consent`; dynamic client registration enabled,
  since claude.ai registers itself (as a public client, once per new
  connection). With registration off, hosts need a pre-registered client
  (HOST_CHECK.md, "Before you start"). Owner decision (step 10).

Record: each value above (screenshot or list).

## 3. Environment variables

Production scope only (Preview stays empty, VERCEL.md §4), set with the
commands of docs/deploy/VERCEL.md §6 step 5. VERCEL.md §4 is the single
source; this copy must match it. Templates: each app's `.env.example`.

| Project       | Variable                        | Value                                                                                                                     |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| web, api, mcp | `ENABLE_EXPERIMENTAL_COREPACK`  | `1` (the build then uses the root `packageManager`, pnpm 10.34.5)                                                         |
| web           | `VITE_SUPABASE_URL`             | `https://<project-ref>.supabase.co`                                                                                       |
| web           | `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key `sb_publishable_...` (the app refuses any other key)                                                  |
| web           | `VITE_API_BASE_URL`             | `<api origin>`                                                                                                            |
| api, mcp      | `SUPABASE_URL`                  | `https://<project-ref>.supabase.co`                                                                                       |
| api, mcp      | `DATABASE_URL`                  | secret (Sensitive): transaction pooler (port 6543), login role `postgres.<project-ref>` (DATABASE.md §10.2), no `sslmode` |
| api, mcp      | `DATABASE_CA_CERT`              | the root certificate of step 2 (PEM, from its file): verified TLS                                                         |
| api, mcp      | `NODEJS_HELPERS`                | `0`                                                                                                                       |
| api           | `API_ALLOWED_ORIGINS`           | `<web origin>`                                                                                                            |
| mcp           | `MCP_PUBLIC_URL`                | `<MCP URL>`, identical to the hook's `mcp_resource`                                                                       |
| mcp           | `MCP_AUTH_AUDIENCE_MODE`        | `resource`. `interim-authenticated` only after the owner sign-off of AUTH_MCP_OAUTH.md §4                                 |
| mcp           | `MCP_ALLOWED_ORIGINS`           | unset (host backends send no Origin)                                                                                      |
| mcp           | `MCP_TRUST_PROXY_HOPS`          | unset (the Vercel adapter trusts the one Vercel edge)                                                                     |

The functions refuse to start (configuration error naming the variable)
without `DATABASE_CA_CERT` or with a TLS parameter in `DATABASE_URL`.

No secret key or service_role key goes to any project: the apps verify tokens
with the public JWKS, and the web bundle must hold none (DEPLOY-01/02 scan
it).

## 4. Vercel deployment

The projects exist since step 0. Once step 3 is done, deploy `RELEASE_SHA`
to production per docs/deploy/VERCEL.md §6 step 6: from a fresh
`git worktree` of that commit (the CLI uploads the directory it runs in,
filtered by `.vercelignore`, not `.gitignore`, so a working copy with edits,
`dist/` or `.env` files would ship them), the api and mcp functions first,
then the web app (its build compiles its `VITE_*` values; the Node functions
read theirs at start and refuse to start without them).

Record: the three production deployment URLs and `RELEASE_SHA`.
Rollback: promote the previous production deployment (Vercel instant
rollback); the database stays forward-only.

## 5. Custom Access Token Hook

After step 4: the sign-in check needs the deployed web app. Follow
supabase/README.md, "Custom Access Token Hook", steps 2 to 7: check the
privileges of `supabase_auth_admin`, enable the hook, check that a sign-in
on `<web origin>` still works, insert the `mcp_resource` row with exactly
the canonical `<MCP URL>` (lowercase host, no trailing slash), and dry-run
the function. Leave `mcp_allowed_client_ids` unset while hosts register
dynamically. Without the row the hook binds nothing and the MCP refuses
every real token (fail closed), so the deployed MCP accepts no connection
before this step.

Record: the privilege check output, the enabled hook, the dry-run output.
Rollback: disable the hook (same README, step 4).

## 6. DEPLOY-02 checks (#16)

```sh
node tools/deploy/verify-deployment.ts \
  --web <web origin> --api <api origin> --mcp <MCP URL> --supabase https://<project-ref>.supabase.co
```

Routing, health and version, the 401 challenge and the RFC 9728 metadata,
cache, CORS and CSP headers, asset loading and the client-bundle secret scan;
the optional authenticated checks are described in docs/deploy/VERCEL.md.
The 401 answers pass through the per-IP rate limit, which writes to the
database: they also prove the verified TLS connection (a refused
certificate shows as 503). Exit code 0 is expected. Record the output (it
prints no token).

Issue #16 asks for DEPLOY-02 on an isolated preview, with the small MCP-UI
smoke. With one Supabase project it runs here, on production before testers
are invited; the cloud suites (step 7) and the host check (step 8) stand in
for the MCP-UI smoke (VERCEL.md §7). This is an owner sign-off (step 10).

## 7. Cloud suites: AUTH-UI-I01 (#25) and OAUTH-04 (#26)

Two opt-in suites in `tests/cloud`, run against the deployed apps and the
real Supabase project. They create one synthetic user each on the mail-sink
mailbox (`<mailbox>+smfa-<suite>-<time>-<hex>@<domain>`), a dynamically
registered OAuth client and a temporary confidential probe client, and
delete all of it (the user's scores go with the user) when they finish. They
read no mailbox: confirmation and recovery links come from the Auth admin
`generate_link`, which sends nothing.

Prerequisites: steps 1-6 done; Chromium installed
(`pnpm exec playwright install chromium`); a mail-sink mailbox on a real
domain that accepts `+tag` addresses (Supabase refuses to mail reserved
domains such as `example.com` or `*.test`, and the signup and recovery mails
the project sends during the run land there); the admin key read from a
secret store into the environment of this one command.

```sh
export CLOUD_E2E=1
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...          # public
export SUPABASE_SECRET_KEY="$(<read from the secret store>)" # or SUPABASE_SERVICE_ROLE_KEY (legacy JWT)
export WEB_BASE_URL=<web origin> API_BASE_URL=<api origin> MCP_URL=<MCP URL>
export CLOUD_E2E_EMAIL=release-smoke@<mail-sink domain>      # no +tag: the suites add it
node tools/release/cloud-smoke.ts                            # or: pnpm exec vitest run --project cloud
```

Optional: `CLOUD_E2E_OAUTH_CLIENT_ID` (and `CLOUD_E2E_OAUTH_CLIENT_SECRET`
for a confidential client) to use a pre-registered client instead of dynamic
registration; `CLOUD_E2E_OAUTH_REDIRECT_URI` (default
`http://127.0.0.1:53682/callback`, a loopback URL the browser intercepts; a
pre-registered client must list it); `CLOUD_E2E_OAUTH_SCOPE` (default: what
claude.ai requests given our metadata, that is no scope, plus
`offline_access` when the authorization server advertises it).

`cloud-smoke.ts` refuses to start without the opt-in and the variables
(listed by name), runs the `cloud` Vitest project, and prints and writes an
evidence block outside the repository: commit, hosts (origins), every step
with its status and non-secret observations (`aud`, rotation, the #2820
probe, refresh after sign-out), secrets redacted. Paste it into EVIDENCE.md,
and only that block: the raw terminal output is not evidence, since a
Playwright failure message can quote a one-time link or a consent URL.

| Suite       | Steps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-UI-I01 | web sign-up asks for confirmation, no session; unconfirmed sign-in refused; confirmation link signs in (library through `GET /scores`, the Redirect URLs allow the app); sign-out; sign-in; reload restores and an expired access token is refreshed; sign-out ends the provider session (refresh refused, issued access token recorded); recovery request; recovery link and new password; old password refused, new one accepted                                                                                                                                                                               |
| OAUTH-04    | 401 challenge and RFC 9728 metadata; RFC 8414 metadata with S256; client (dynamic registration or pre-registered); consent page reachable and authorization details readable (supabase/auth#2820 probe, public and confidential, with and without `resource`); deny gives `access_denied` and no code; approve after sign-in gives a code; PKCE token exchange; `aud` holds the MCP resource, same `sub` as the web account; initialize, tools/list, create_score; save through the MCP listed by `GET /scores`; web session token refused at `/mcp`; OAuth token refused by the API; refresh keeps the audience |

A step the provider blocks fails once with its diagnosis, and the steps that
need it are skipped with the reason:

- `BLOCKED: the consent page cannot read this host-shaped request`
  (supabase/auth#2820): the probe line says which client type and
  `resource` combinations work. Decide the host path from it (HOST_CHECK.md);
  if none works, the release that accepts MCP connections waits for the
  provider fix.
- `release gate AUTH_MCP_OAUTH.md §4`: the token lacks the MCP resource in
  `aud`. Check step 5 (hook enabled, `mcp_resource` equal to `<MCP URL>`).
- `The provider refused the sign-up ... default SMTP`: step 2, SMTP.

Without `CLOUD_E2E=1` both suites are skipped (the default for every other
command); with it but an incomplete environment they fail on "cloud
configuration is complete" before any request.

## 8. Target-host check

[HOST_CHECK.md](HOST_CHECK.md), with the claude.ai custom connector:
connect and authenticate (deny, then allow), show and play one score, edit
it, decline then approve the save, retrieve it. Record the block of that page
in EVIDENCE.md.

## 9. ASSET-03 listening review (#23)

A person listens, once at this first release and again whenever the piano
asset or the sound policy changes (SOUNDFONT.md §5). Automated tests do not
replace it. Play in Chromium with the real engine, preferably on the target
host (HOST_CHECK.md step 8, which also proves the host CSP) or in the web
app's player after saving the scores.

Material, both valid `create_score` arguments (checked by
`tools/release/asset-03-scores.test.ts`):

- `tools/release/asset-03/f08-slur-pair.create-score.json`: fixture F08.
  Bar 1 is C4-D4-E4-F4 slurred (gate 1/1), from p with a crescendo; bar 2
  the same notes unmarked (gate 9/10); bar 3 a tied G4 next to a slurred,
  repeated (not tied) G4, pedalled; bar 4 the four articulations, from f with
  a diminuendo, pedalled.
- `tools/release/asset-03/c3-c6-range.create-score.json`: at 72 BPM, stepwise
  C major in eighths from C3 (left hand) to C6 (right hand), then C3 and C6
  held together.

| Check                                                                                       | Result (pass / fail, notes) |
| ------------------------------------------------------------------------------------------- | --------------------------- |
| Attack, sustain and release sound like a piano; no click, no missing or detuned note        |                             |
| F08 bar 1 sounds connected, bar 2 detached, both with distinct attacks on every note        |                             |
| F08 bar 3: the tied G4 is one sound, the slurred repeated G4 is struck again                |                             |
| F08 bar 4: accent, staccato, tenuto and marcato are audibly different                       |                             |
| F08: bar 1 grows from soft, bar 4 starts loud and fades; soft and loud are distinguishable  |                             |
| F08 bars 3-4: the pedal sustains and releases cleanly (no hanging notes after the last bar) |                             |
| C3-C6: even loudness and timbre across the range, no jump between registers                 |                             |
| Time from the first Play to the first sound, cold cache (seconds)                           |                             |
| Tab memory after playing the C3-C6 passage (Chrome Task Manager, MB)                        |                             |

Record date, reviewer, browser and version, device and OS, where it was
played (claude.ai or the web app), the table and a verdict (accept, or which
fallback of SOUNDFONT.md §4) in EVIDENCE.md, and copy the verdict into
SOUNDFONT.md §5.

## 10. Owner sign-offs

Each decision is recorded in EVIDENCE.md, "Owner sign-offs", with date and
name, before external testers are invited.

- [ ] SoundFont provenance: the residual risk of SOUNDFONT.md §2 (public-domain
      status of the AKAI samples rests on the upstream author's report) is
      accepted, or a fallback of §4 is chosen.
- [ ] ASSET-03 verdict (step 9).
- [ ] OAuth host path from the OAUTH-04 probe and the host check: dynamic
      registration (public clients) or a pre-registered confidential client;
      the scope set the host requests (AUTH_MCP_OAUTH.md §5).
- [ ] Audience mode `resource` confirmed. `interim-authenticated` only with
      the signed residual risks of AUTH_MCP_OAUTH.md §4.
- [ ] Dynamic client registration on or off (step 2), knowing that claude.ai
      registers a new client per new connection.
- [ ] Custom SMTP provider and sender (step 2).
- [ ] Localhost redirect URLs on the production project: yes or no (step 2).
- [ ] DEPLOY-02 scope: no isolated preview (one Supabase project); DEPLOY-02
      ran against the production deployment before testers were invited,
      with the OAUTH-04 cloud suite and the host check standing in for the
      MCP-UI smoke (step 6). Or an isolated preview is created first and the
      checks run there.
- [ ] Documented limits accepted: sign-out does not revoke already issued
      access tokens (valid until `exp`, 1 hour by default; AUTH-UI-I01 records
      it); anthropics/claude-ai-mcp#1038 if it affects the host.
- [ ] Branch protection of `main` configured as CI.md §3 lists, or recorded as
      unverified.
- [ ] Go / no-go for inviting testers.
