# Vercel deployment

Issue #16. Three Vercel projects deploy the three apps of this pnpm monorepo.
The repository holds their configuration (`apps/*/vercel.json`), the two
function adapters and the checks. DEPLOY-01 runs locally and in CI
(`pnpm check:deploy`). DEPLOY-02 and DEPLOY-03 need the cloud and the owner's
approval: this page lists their steps in order (§6, §7). Nothing here claims
that a deployment exists. The research behind the choices was done on
2026-09-29 against the Vercel documentation and the Vercel CLI source listed
under "Sources".

## 1. Topology

| Project (team `vibeworker1`) | Root Directory | Preset         | Build command (vercel.json)                                            | Static output                    | Function                                                                     |
| ---------------------------- | -------------- | -------------- | ---------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `sheet-music-for-ai-web`     | `apps/web`     | Vite           | `pnpm run build`                                                       | `dist` (SPA, SoundFont, worklet) | none                                                                         |
| `sheet-music-for-ai-api`     | `apps/api`     | Other (`null`) | `pnpm run build`                                                       | `public` (`robots.txt` only)     | `api/index.js` -> `dist/serverless.js` (NestJS)                              |
| `sheet-music-for-ai-mcp`     | `apps/mcp`     | Other (`null`) | `pnpm run build`, then copy `dist/view/assets` to `dist/static/assets` | `dist/static` (View assets)      | `api/index.js` -> `dist/server/serverless.js` (Express), plus `dist/view/**` |

Planned public URLs (the default `*.vercel.app` production domains; §6 step 3
confirms them):

| Name | URL                                         | Used as                                                   |
| ---- | ------------------------------------------- | --------------------------------------------------------- |
| W    | `https://sheet-music-for-ai-web.vercel.app` | web origin                                                |
| A    | `https://sheet-music-for-ai-api.vercel.app` | API base URL                                              |
| M    | `https://sheet-music-for-ai-mcp.vercel.app` | MCP origin; `MCP_PUBLIC_URL` = `M/mcp`                    |
| S    | `https://aebdzppogfvwbibcmpza.supabase.co`  | Supabase project (PostgreSQL 17, ES256 tokens, OAuth 2.1) |

How a request is routed (Vercel checks the static output first, then the
rewrites):

```text
web  GET /assets/*        -> static file (immutable cache)
     GET anything else    -> /index.html (SPA fallback, CSP on every answer)
api  GET /robots.txt      -> static file
     any other path       -> function api/index.js -> Nest app (/health, /version, /scores...)
mcp  GET /assets/<file>   -> static file (the View's worklet, SoundFont, license, notice)
     any other path       -> function api/index.js -> Express app (/mcp,
                             /.well-known/oauth-protected-resource/mcp, /assets 404s)
```

## 2. Build and runtime choices

- **Monorepo.** Each project's Root Directory is its app folder. "Include
  source files outside of the Root Directory in the Build Step" must stay on
  (default for new projects): the build reads `packages/*`, `assets/` and the
  root lockfile. Vercel finds `pnpm-lock.yaml` at the repository root and runs
  `pnpm install`, which installs the whole workspace. Set
  `ENABLE_EXPERIMENTAL_COREPACK=1` so the root `packageManager`
  (`pnpm@10.34.5`) is used. Do not override the Install Command with a bare
  `pnpm install`: without Corepack, Vercel then picks the oldest pnpm of its
  build image.
- **Node.** 24.x, the default for new projects. `apps/api` and `apps/mcp`
  also pin `engines.node: "24.x"`, which overrides the project setting for
  their functions; set the web project's Node.js Version to 24.x as well.
- **Preset "Other" for api and mcp.** `apps/api` depends on `@nestjs/core`
  and `apps/mcp` on `express`, so Vercel would otherwise pick its zero-config
  NestJS or Express preset and use `src/main.ts` or `src/app.ts` as the entry
  point. With `"framework": null`, the only function is `api/index.js`
  (Vercel ignores files under `api/` whose path contains `/_`, so the adapter
  sources `api/_serverless.ts` are not functions).
- **Build order.** Vercel runs the build command (static build) before it
  builds the `api/` functions, so `api/index.js` can re-export the bundle
  `vite build` writes to `dist/`. File tracing (`@vercel/nft`) follows that
  bundle's imports into `node_modules`: workspace packages are inlined by
  Vite, npm dependencies stay external, exactly as for `node dist/main.js`.
  `apps/api` and `apps/mcp` are `"type": "module"`, so the bundle stays ESM.
- **Adapters.** `apps/api/api/_serverless.ts` and
  `apps/mcp/api/_serverless.ts` run the same configuration validation and
  composition as `main.ts` (`loadApiConfig` -> `bootstrapApi`;
  `loadMcpConfig` -> View file -> `createPostgresPersistence` ->
  `createMcpApp`) at module load, without `listen` and without signal
  handling. Their default export is the Express app. Vercel serves a default
  export that is a function as a Node `(req, res)` handler and adds its
  request helpers (a pre-read, parsed `req.body`) only to a function without
  a `listen` method, so an Express app receives the untouched request
  stream: the MCP body parser and 512 KiB cap behave as locally.
  `NODEJS_HELPERS=0` in the project environment turns the helpers off in any
  case.
- **One app and one pool per instance.** The module is evaluated once per
  function instance; Fluid compute (default for new projects) sends many,
  also concurrent, requests to a warm instance, which reuses the app and its
  `pg` pool (lazy connections, at most 5, idle ones closed after 10 s).
  `DATABASE_URL` is the Supavisor transaction pooler (port 6543), as
  DATABASE.md §10.2 requires for serverless instances, reached over TLS
  verified against `DATABASE_CA_CERT` (the Supabase root certificate): the
  configuration refuses a remote database without it, and a `DATABASE_URL`
  with `sslmode` or any other TLS parameter (node-postgres would let it
  override the verified settings).
- **Startup failure.** A missing or invalid variable logs
  `api.config_invalid` / `config.invalid` with the variable names only and
  the module evaluation fails: Vercel answers 500 and no request reaches a
  half-built app (checked by DEPLOY-01).
- **Client address.** Vercel's edge overwrites `X-Forwarded-For` with the
  client's public address and forwards no external value, so one trusted
  hop makes `req.ip`, the per-IP rate-limit subject, the client address.
  Both adapters trust exactly that hop without any setting: the MCP adapter
  defaults an unset `MCP_TRUST_PROXY_HOPS` to 1 (an explicit value wins;
  `main.ts` keeps 0), and, since `bootstrapApi` has no trust-proxy
  parameter, the API adapter sets Express `trust proxy` to 1
  (`VERCEL_PROXY_HOPS`) on the app it built. The MCP function logs the value
  it uses (`server.started`, `trustProxyHops`).
- **Limits.** A function's request and response bodies are capped at
  4.5 MB: the MCP request cap is 512 KiB and the View resource read is about
  1.7 MB of JSON, but the 8.76 MiB SoundFont cannot go through a function,
  hence the static `/assets`. `maxDuration` is 30 s (api) and 60 s (mcp)
  instead of the Fluid default of 300 s. The MCP function bundle carries
  `dist/view/**` (about 11 MB) through `includeFiles`; the limit is 250 MB.
- **Region.** Functions run in `iad1` by default. Put them next to the
  database (§6 step 2).

## 3. Static files and headers

**Web** (`apps/web/vercel.json`), on every answer:

| Header                    | Value                                                           |
| ------------------------- | --------------------------------------------------------------- |
| `Content-Security-Policy` | see below                                                       |
| `X-Content-Type-Options`  | `nosniff`                                                       |
| `X-Frame-Options`         | `DENY`                                                          |
| `Referrer-Policy`         | `no-referrer` (the consent page URL carries `authorization_id`) |
| `Permissions-Policy`      | `camera=(), microphone=(), geolocation=(), payment=(), usb=()`  |

`/assets/*` adds `Cache-Control: public, max-age=31536000, immutable`: the
bundle and worklet names are content-hashed and the SoundFont, LICENSE.txt
and NOTICE.txt are fixed by the manifest's SHA-256 (WEB_APP.md). The `.sf3`
is served as `application/octet-stream`. The SPA rewrite
`/((?!assets/).*)` -> `/index.html` loads deep links (`/library`,
`/scores/<id>`, `/oauth/consent`, `/reset-password`), while a missing
`/assets` file stays a 404 instead of an HTML page.

The CSP:

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
font-src 'self' data:; img-src 'self' data:;
connect-src 'self' https://aebdzppogfvwbibcmpza.supabase.co https://sheet-music-for-ai-api.vercel.app;
worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

- `connect-src`: the SoundFont fetch (`'self'`), Supabase Auth (S) and the
  API (A). vercel.json is static, so these two origins are written in it: if
  the real hostnames differ, change them there before deploying.
  `pnpm check:deploy` with the real `VITE_*` values fails until they match.
- `script-src 'wasm-unsafe-eval'`: the pinned SpessaSynth worklet decodes the
  SoundFont with WebAssembly (MCP_VIEW.md §4); the worklet module itself is
  same-origin. No inline script: Vite emits the bundle as a module file.
- `font-src data:`: VexFlow's embedded engraving fonts.
- `style-src 'unsafe-inline'`: style attributes of the renderer and React.
- No `Cross-Origin-Opener-Policy`: it would cut `window.opener` for MCP
  clients that open the OAuth consent in a popup.

Measured on 2026-09-29 (a throwaway headless Chromium run, not a committed
test): the production web build served with these headers by
`local-vercel.ts`, with a seeded session and a stubbed API answer, renders a
saved score (the rich wire fixture), reaches Ready (SoundFont, worklet and
its WebAssembly decoder loaded) and plays. The only violation reported is
zod's JIT probe (`Function('')` inside a `try`), which then runs without JIT;
`z.config({ jitless: true })` in the web entry would silence it. `/login`,
`/library` (redirect to sign-in) and `/about` report nothing else.

**MCP** (`apps/mcp/vercel.json`): `/assets/*` answers exactly like
`createViewAssetsRouter` (MCP_VIEW.md §3), which it stands in for:
`Cache-Control: public, max-age=31536000, immutable`,
`Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy:
cross-origin`, `X-Content-Type-Options: nosniff`, and the content types
`text/javascript; charset=utf-8` (worklet module), `application/octet-stream`
(`.sf3`), `text/plain; charset=utf-8` (`.txt`). DEPLOY-01 compares the static
copy with the function's answer for each file. The View document itself is
not a static file: it is only the `ui://` resource, and `/` is a 404.

Differences from a local run, all deliberate: the API answers
`/robots.txt` (`Disallow: /`) from its static output; the View's asset files
come from the CDN; a 404 under `/assets` also carries the headers of the
`/assets/*` rule.

## 4. Environment variables

Every `VITE_*` value is compiled into the public web bundle. `vercel env add`
stores Production and Preview values as Sensitive by default; pass
`--no-sensitive` for the public values so they stay readable.

**web** (read at build time):

| Variable                        | Production value          | Secret                             |
| ------------------------------- | ------------------------- | ---------------------------------- |
| `VITE_SUPABASE_URL`             | S                         | no                                 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` of S | no (the app refuses any other key) |
| `VITE_API_BASE_URL`             | A, no trailing slash      | no                                 |
| `ENABLE_EXPERIMENTAL_COREPACK`  | `1`                       | no                                 |

**api** (read when the function starts):

| Variable                       | Production value                                                                                                                    | Secret  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `SUPABASE_URL`                 | S                                                                                                                                   | no      |
| `DATABASE_URL`                 | Supavisor transaction pooler URL, port 6543, role of DATABASE.md §10.2, with no `sslmode` or other TLS parameter (refused at start) | **yes** |
| `DATABASE_CA_CERT`             | C: the Supabase root certificate (PEM), set from the downloaded file                                                                | no      |
| `API_ALLOWED_ORIGINS`          | W (exact origin, comma-separated if several)                                                                                        | no      |
| `NODEJS_HELPERS`               | `0`                                                                                                                                 | no      |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`                                                                                                                                 | no      |

**mcp** (read when the function starts):

| Variable                       | Production value                                                                    | Secret  |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------- |
| `MCP_PUBLIC_URL`               | `M/mcp`                                                                             | no      |
| `SUPABASE_URL`                 | S                                                                                   | no      |
| `DATABASE_URL`                 | same as the API                                                                     | **yes** |
| `DATABASE_CA_CERT`             | C, same as the API                                                                  | no      |
| `MCP_AUTH_AUDIENCE_MODE`       | `resource` (`interim-authenticated` only with the §4 sign-off of AUTH_MCP_OAUTH.md) | no      |
| `MCP_TRUST_PROXY_HOPS`         | unset: the adapter uses 1, the Vercel edge (§2)                                     | no      |
| `MCP_ALLOWED_ORIGINS`          | unset (MCP host backends send no `Origin`)                                          | no      |
| `NODEJS_HELPERS`               | `0`                                                                                 | no      |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`                                                                                 | no      |

Never set on any project: `PORT`, `MCP_VIEW_HTML_PATH`, and any Supabase
secret, service-role or JWT secret key; no app needs one.

How the values reference each other:

```text
W (web origin)  -> API_ALLOWED_ORIGINS (api); Supabase Site URL, Redirect URLs W/**,
                   OAuth authorization path W/oauth/consent
A (API origin)  -> VITE_API_BASE_URL (web); CSP connect-src (apps/web/vercel.json)
M (MCP origin)  -> MCP_PUBLIC_URL = M/mcp (mcp); private.app_settings.mcp_resource of the
                   Custom Access Token Hook = the same URL (supabase/README.md); the View's
                   asset origin and resource CSP (derived at startup, nothing to set)
S (Supabase)    -> VITE_SUPABASE_URL (web), SUPABASE_URL (api, mcp); CSP connect-src
C (root CA)     -> DATABASE_CA_CERT (api, mcp): Supabase Dashboard > Database Settings >
                   SSL Configuration > Download certificate (public, not a secret)
```

**Preview isolation.** Preview deployments must never use the production
database or project. Leave the Preview environment empty until an isolated
Supabase project (or branch) exists: a preview API or MCP function then
refuses to start (configuration error) and the preview web app shows its
configuration page. When one exists, give Preview its own S, `DATABASE_URL`
and `DATABASE_CA_CERT`, stable preview aliases for A and M (`vercel alias set`), and add the preview
API and Supabase origins to the CSP. Vercel's Deployment Protection (Vercel
Authentication) also blocks anonymous requests to preview URLs, MCP hosts
included; the verification script passes it with
`VERCEL_AUTOMATION_BYPASS_SECRET`.

## 5. Local checks (DEPLOY-01)

```sh
pnpm check:deploy
# before a deployment, with the real public values:
VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  VITE_API_BASE_URL=https://<api host> pnpm check:deploy
```

It needs the local test Postgres of `pnpm test:integration` (the server and
credentials of `TEST_DATABASE_URL`) and uses only the database
`sheet_music_test_deploy` (docs/testing/HARNESS.md §2.1). CI runs it in the
`deploy` job (docs/testing/CI.md). Files: `tools/deploy/`.

| Check           | What it proves                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| build           | each project builds with the exact `buildCommand` of its vercel.json into its `outputDirectory`; api/mcp use preset "Other" and the single function `api/index.js`, whose re-exported bundle exists                                                                                                                                                                                             |
| secrets         | no client file (web `dist`, MCP static output and View document, API static output) holds `service_role`, a `sb_secret_` key, a JWT, `SUPABASE_SERVICE*`, a private key, a Postgres URL, or any canary server secret present in the build environment                                                                                                                                           |
| URLs            | the web bundle carries the configured API and Supabase URLs and the publishable key; no client file holds a loopback URL other than two library constants (react-router's `http://localhost` URL base, supabase-js's unused `http://localhost:9999` default); the View keeps its asset-origin placeholder                                                                                       |
| CSP             | `connect-src` lists `'self'`, the configured API and Supabase origins and only https origins without wildcard; `frame-ancestors 'none'`; `script-src 'self' 'wasm-unsafe-eval'`                                                                                                                                                                                                                 |
| assets          | every `/assets` path of `index.html` exists and is immutable; the worklet the bundle references exists; SoundFont size and SHA-256 match the manifest in both outputs; the MCP static output equals `dist/view/assets` byte for byte; routes and rewrites are as in §1                                                                                                                          |
| startup failure | the API and MCP entries, imported like Vercel's launcher does, exit before serving when a variable is missing or invalid, a remote database has no `DATABASE_CA_CERT`, or `DATABASE_URL` carries `sslmode`; the log names the variable, never the value                                                                                                                                         |
| served entries  | behind a local stand-in of Vercel's routing (`local-vercel.ts`) with the local test database and issuer, the DEPLOY-02 checks of §7 pass for web, API (with one authenticated read) and MCP (with setup and the View resource); the static `/assets` copy answers like the MCP function; `X-Forwarded-For` becomes the per-IP rate-limit subject, for the MCP with `MCP_TRUST_PROXY_HOPS` unset |
| database TLS    | with `DATABASE_CA_CERT`, both entries reach the database over verified TLS only: against the local server, which offers no TLS, every store call answers 503, never a plaintext fallback                                                                                                                                                                                                        |
| uploads         | `.vercelignore` at the repository root keeps local build and test output and `.env*` files (except `.env.example`) out of a CLI deployment                                                                                                                                                                                                                                                      |
| scanners        | each scanner and route matcher finds what it looks for (`deploy-01-scanners.test.ts`)                                                                                                                                                                                                                                                                                                           |

`local-vercel.ts` approximates Vercel's routing (static first, rewrites,
header rules); it is not Vercel. The real routing, CDN headers and helper
behaviour are checked by DEPLOY-02 on a deployment.

Since `api/index.js` imports `../dist/...`, `pnpm check:arch` needs the apps
built first, as CI already does (`pnpm build` runs before it).

## 6. Cloud steps (DEPLOY-02 preparation, not run)

Prerequisites: the owner's approval; Vercel CLI 54.1 or later (the version
these commands were checked against), logged in with access to the team
`vibeworker1`; `jq`. Steps 1-4 need nothing else (they fix W, A and M);
the Supabase migrations are pushed before step 6 (supabase/README.md), and
step 7 places the Supabase settings that need W and M, the OAuth 2.1 server
and the Custom Access Token Hook (AUTH_MCP_OAUTH.md §4). Run every command
from the repository root unless a step says otherwise.

`vercel env` and `vercel deploy` have no `--project` option, and without a
link the CLI offers to set up (create) a project. Every command below that
acts on one project therefore names it through `VERCEL_ORG_ID` (the team ID)
and `VERCEL_PROJECT_ID` (the project name or ID), which the CLI uses instead
of a `.vercel` link and refuses to use when the project does not exist.

1. Create the projects and set what vercel.json cannot hold:

   ```sh
   for app in web api mcp; do
     vercel project add "sheet-music-for-ai-$app" --scope vibeworker1
     printf '{"rootDirectory":"apps/%s","sourceFilesOutsideRootDirectory":true,"nodeVersion":"24.x"}' "$app" |
       vercel api "/v9/projects/sheet-music-for-ai-$app" -X PATCH --scope vibeworker1 --input -
   done
   ```

2. Region: read the Supabase project's region in its dashboard. Unless it is
   `us-east-1`, add `"regions": ["<nearest Vercel region>"]` (for example
   `cdg1` for eu-west-3, `fra1` for eu-central-1, `dub1` for eu-west-1) to
   `apps/api/vercel.json` and `apps/mcp/vercel.json`.
3. Confirm the production domains:
   `vercel api /v9/projects/sheet-music-for-ai-<app>/domains --scope vibeworker1`.
   If a `*.vercel.app` domain differs from §1, use it for W, A and M below and
   update the CSP `connect-src` in `apps/web/vercel.json`.
4. Re-run the local checks with the real public values (§5) and commit any
   vercel.json change: the deployed commit must hold it.
5. Download C, the Supabase root certificate (Dashboard > Database Settings >
   SSL Configuration > Download certificate), to a file outside the
   repository. Then set the Production variables of §4. Values go through
   stdin (`printf '%s'`, no trailing newline; the certificate from its file);
   the two private values come from the runner's environment
   (`SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, filled from the owner's
   secret store), never from a literal in the shell history. `DATABASE_URL`
   carries no `sslmode`: the functions refuse to start with one.

   ```sh
   S=https://aebdzppogfvwbibcmpza.supabase.co
   W=https://sheet-music-for-ai-web.vercel.app
   A=https://sheet-music-for-ai-api.vercel.app
   M=https://sheet-music-for-ai-mcp.vercel.app
   C="$HOME/supabase-root-ca.crt"   # the downloaded certificate
   ORG_ID="$(vercel api /v9/projects/sheet-music-for-ai-web --scope vibeworker1 --raw | jq -r .accountId)"
   on() { # on <app> <vercel arguments...>: run vercel against one project
     app="$1"; shift
     VERCEL_ORG_ID="$ORG_ID" VERCEL_PROJECT_ID="sheet-music-for-ai-$app" vercel "$@"
   }
   add() { # add <app> <name> <value> [--sensitive]
     printf '%s' "$3" | on "$1" env add "$2" production "${4:---no-sensitive}"
   }
   for app in web api mcp; do add "$app" ENABLE_EXPERIMENTAL_COREPACK 1; done
   add web VITE_SUPABASE_URL "$S"
   add web VITE_SUPABASE_PUBLISHABLE_KEY "$SUPABASE_PUBLISHABLE_KEY"
   add web VITE_API_BASE_URL "$A"
   for app in api mcp; do
     add "$app" SUPABASE_URL "$S"
     add "$app" DATABASE_URL "$DATABASE_URL" --sensitive
     on "$app" env add DATABASE_CA_CERT production --no-sensitive < "$C"
     add "$app" NODEJS_HELPERS 0
   done
   add api API_ALLOWED_ORIGINS "$W"
   add mcp MCP_PUBLIC_URL "$M/mcp"
   add mcp MCP_AUTH_AUDIENCE_MODE resource
   for app in web api mcp; do on "$app" env ls production; done   # names only
   ```

   Leave Preview empty (§4, preview isolation), and leave
   `MCP_TRUST_PROXY_HOPS` and `MCP_ALLOWED_ORIGINS` unset.

6. Deploy the release commit from a clean worktree, functions first, then
   the web app, whose build bakes A in. The CLI uploads the directory it runs
   in, filtered by `.vercelignore` only (not `.gitignore`), so a working copy
   with local edits, `dist/` or `.env` files would ship them; a fresh
   worktree has none. In the shell of step 5 (`on` defined), with
   `RELEASE_SHA` the commit chosen in RELEASE_CHECKLIST.md step 0:

   ```sh
   RELEASE_DIR="$(mktemp -d)/sheet-music-for-ai"
   git worktree add --detach "$RELEASE_DIR" "$RELEASE_SHA"
   cd "$RELEASE_DIR"
   if test "$(git rev-parse HEAD)" = "$RELEASE_SHA" && test -z "$(git status --porcelain --ignored)"; then
     for app in api mcp web; do on "$app" deploy --prod; done
   else
     echo 'not a clean checkout of the release commit: nothing deployed' >&2
   fi
   cd - && git worktree remove "$RELEASE_DIR"
   ```

   Each build log must show pnpm 10.34.5 and Node 24, and the function
   `api/index` for api and mcp. Record the three deployment URLs with
   `RELEASE_SHA`.

7. Supabase settings (RELEASE_CHECKLIST.md is the order of record): the
   ones that only need W and M (Site URL = W, Redirect URLs `W/**`, OAuth
   2.1 server with Authorization Path `/oauth/consent`, "Enforce SSL on
   incoming connections") are set once step 3 has fixed the hostnames
   (checklist step 2, before the deployment); the Custom Access Token Hook is
   enabled and `mcp_resource` = `M/mcp` inserted after the deployment
   (checklist step 5), since its sign-in check needs the web app.
8. Verify (§7).

## 7. Post-deploy verification (DEPLOY-02, DEPLOY-03)

HTTP checks, no token needed (all pass locally in DEPLOY-01):

```sh
node tools/deploy/verify-deployment.ts \
  --web https://sheet-music-for-ai-web.vercel.app \
  --api https://sheet-music-for-ai-api.vercel.app \
  --mcp https://sheet-music-for-ai-mcp.vercel.app/mcp \
  --supabase https://aebdzppogfvwbibcmpza.supabase.co
```

It checks: web CSP, `nosniff`, `X-Frame-Options`, SPA deep links, the
bundle's immutable cache, configured URLs, absence of loopback URLs and
secrets, worklet and SoundFont headers, a 404 for a missing asset; API
`/health`, `/version`, the 401 challenge on `/scores` with `no-store` and a
correlation ID, CORS for W and 403 for a foreign origin; MCP 401 with
`resource_metadata`, the RFC 9728 document (resource = `M/mcp`, issuer
`S/auth/v1`, readable cross-origin), `/assets` content types and
cache/CORS/CORP headers, a 404 for a missing asset and for `/`. With
`API_SESSION_TOKEN` (a web session access token) it adds one protected read
(`private, no-store`, `Vary: Authorization`); with `MCP_ACCESS_TOKEN` (an MCP
OAuth token) it adds `initialize` and the View resource read (asset origin M
written into the document and its CSP). Token values are never printed; do
not record them. `WEB_BASE_URL`, `API_BASE_URL`, `MCP_URL` and
`SUPABASE_URL` replace the flags.

The unauthenticated API and MCP answers already go through the database:
the per-IP rate limit runs before authentication and writes to Postgres, so
a 401 proves the function reached the database over verified TLS. A
refused certificate or a missing `DATABASE_CA_CERT` shows as a 503 (or a 500
at startup) and fails the checks.

**Scope against issue #16.** DEPLOY-02 asks for these checks and the small
MCP-UI smoke against an isolated preview configuration. There is one
Supabase project and Preview stays empty (§4), so the first release runs
them against the production deployment before testers are invited, and the
MCP-UI suite, which only drives a local harness, is not run against a URL:
the OAUTH-04 cloud suite (`initialize`, `tools/list`, `create_score`, a save
listed by the API) and the host check (show, play, edit, save, retrieve)
stand in for it. The owner signs this off (RELEASE_CHECKLIST.md step 10).

The same checks as curl, when node is not at hand:

```sh
curl -sSI "$W/" | grep -iE '^(content-security-policy|x-frame-options|x-content-type-options):'
curl -sS "$A/health"; curl -sS "$A/version"
curl -sSi "$A/scores" | grep -iE '^(HTTP|www-authenticate|cache-control)'
curl -sSi -X POST "$M/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' | grep -iE '^(HTTP|www-authenticate)'
curl -sS "$M/.well-known/oauth-protected-resource/mcp"
curl -sSI "$M/assets/soundfonts/piano/ms-basic-grand-piano.sf3" |
  grep -iE '^(HTTP|content-type|cache-control|access-control-allow-origin|cross-origin-resource-policy):'
```

Then, reused rather than repeated:

- The shared external-host check (MCP_UI_TEST_PROCESS.md): connect the MCP
  server M in the target host, authenticate, show and play one score, edit,
  decline then approve a save, retrieve it in the web app W. It is also the
  release gate for the host CSP (`font-src data:`, `'wasm-unsafe-eval'`,
  MCP_VIEW.md §4). Record commit, hosts and result, no token; a missing host
  access is reported, not passed.
- The OAUTH-04 provider smoke and AUTH-UI-I01 (AUTH_MCP_OAUTH.md §4,
  WEB_AUTH.md) against S, W, A and M.
- DEPLOY-03, for a change that affects stored data: the migration and
  read-compatibility suites of #9 and the restart and draft suites of #22,
  against the local test database before the schema change is pushed:

  ```sh
  # DB-01..04 (round trip, search, compare-and-swap, unreadable stored documents)
  # and DRAFT-02..04 (durability across instances, cleanup, promotion)
  pnpm exec vitest run --project integration packages/persistence-postgres/test
  ```

  For an actual upgrade, create a score with the old deployment, deploy, and
  read it back with the new one (`get_score`, `GET /scores/:id`). Rolling back
  the app does not roll back a migration.

## 8. Known limits and follow-ups

- **Database TLS.** The functions verify the pooler's certificate and host
  name against `DATABASE_CA_CERT` (DATABASE.md §10.2). That the Supavisor
  pooler's certificate chains to the downloaded root certificate is
  Supabase's documented setup, not something a local check can prove: the
  first DEPLOY-02 run is the proof (a 503 on `/scores` means the chain or
  host name was refused). If Supabase rotates its root certificate, update
  `DATABASE_CA_CERT` on both projects and redeploy.
- The pool is not attached to Vercel's instance lifecycle
  (`attachDatabasePool` of `@vercel/functions`, which closes idle clients
  before an instance is suspended): that needs a new dependency and access to
  the pool, which persistence-postgres does not expose. A suspended instance
  keeps up to 5 client connections to Supavisor until it resumes or ends;
  watch the pooler's client count.
- `bootstrapApi` has no trust-proxy parameter, so the API adapter sets it; an
  `API_TRUST_PROXY_HOPS` variable like the MCP one would remove that
  difference.
- The web CSP holds fixed origins (vercel.json is static); a new hostname or a
  preview API needs a vercel.json change.
- Deployment Protection on preview URLs blocks MCP hosts and the web app's API
  calls; a preview used for the host check needs protection off for api and
  mcp, or the production deployment is used before launch.

## Sources

Read on 2026-09-29: Vercel docs "Using Monorepos", "Monorepos FAQ",
"Configuring a Build", "Package Managers", "Supported Node.js versions",
"Using the Node.js Runtime with Vercel Functions", "Advanced Node.js Usage",
"Vercel Functions Limits", "Request headers", "Express on Vercel", "NestJS on
Vercel", "@vercel/functions API Reference", "vercel project", "vercel env",
"vercel api", "vercel link", REST "Update an existing project"; the Vercel
CLI source (`vercel/vercel` main): `internals/builder-orchestration/src/sort-builders.ts`
(static build before `@vercel/node`), `packages/fs-detectors/src/detect-builders.ts`
(`api/**` functions, `/_` exclusion, output directory),
`packages/node/src/build.ts` (install, `includeFiles`, TypeScript and ESM
handling), `packages/node/src/serverless-functions/serverless-handler.mts`
(helpers skipped for Express apps), `packages/static-build/src/index.ts`
(missing or empty output directory is an error). Checked on 2026-09-29 in the
installed Vercel CLI 54.1.0 (its `--help` and bundled source): `vercel env
add` and `vercel deploy` accept no `--project`; `VERCEL_ORG_ID` (a `team_`
ID) with `VERCEL_PROJECT_ID` (name or ID) replaces the `.vercel` link and
fails when the project does not exist; `vercel deploy` uploads the directory
it runs in with the project's Root Directory setting, filtered by that
directory's `.vercelignore` and the CLI defaults, never `.gitignore`;
`vercel env add` reads a multi-line value from stdin and strips one trailing
newline; `vercel api` adds the `--scope` team to the request.
