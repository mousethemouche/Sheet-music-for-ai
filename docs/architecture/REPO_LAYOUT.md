# Repository layout

How the ADR-003 monorepo is laid out, built, tested and guarded. Issue #4
(scaffold) and #17 (CI-01/CI-02). The ADRs remain the source of truth for
_why_; this page records _where_ and _how_. The contracts the packages
implement are specified in
[SCORESPEC_V1_SEMANTICS.md](SCORESPEC_V1_SEMANTICS.md) (ScoreSpec v1, #2),
[SCORE_OPERATIONS_V1.md](SCORE_OPERATIONS_V1.md) (ScoreOperations v1, #3) and
[APPLICATION_LAYER.md](APPLICATION_LAYER.md) (use cases, ports and transport
contracts, #8/#10/#22).

## Workspace

pnpm workspace (`pnpm-workspace.yaml`): `apps/*` and `packages/*`. All
packages are private, ESM (`"type": "module"`) and named `@sheet-music/<dir>`.

| Path                            | Role                                                                                            | Runtime        |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| `apps/web`                      | React + Vite SPA: standalone player, auth (#25), saved library (#15)                            | browser        |
| `apps/api`                      | NestJS HTTP composition root: saved-score routes, health, version (#21)                         | Node           |
| `apps/mcp/src`                  | MCP server, stateless Streamable HTTP on `POST /mcp` (#11-#14, #26)                             | Node           |
| `apps/mcp/view`                 | MCP Apps View (React) bundled as ONE self-contained HTML file for the `ui://` resource          | sandboxed page |
| `packages/music-domain`         | ScoreSpec, invariants, ScoreOperations, pure music logic (#2, #3)                               | any            |
| `packages/music-contracts`      | Transport-neutral schemas/DTOs shared by MCP, HTTP and web                                      | any            |
| `packages/music-application`    | Use cases and neutral ports (repositories, clock, IDs, `UserId`) (#8, #10, #22)                 | any            |
| `packages/renderer-core`        | Renderer port, `RenderResult`, `LayoutMap` (ADR-004)                                            | browser        |
| `packages/renderer-vexflow`     | VexFlow adapter (#5)                                                                            | browser        |
| `packages/playback-core`        | `PlaybackPlan`, timeline compiler, engine port (#6)                                             | any            |
| `packages/playback-spessasynth` | SpessaSynth adapter (#6, #23)                                                                   | browser        |
| `packages/score-ui`             | React ScorePlayer and annotation overlay over the ports (#7)                                    | browser        |
| `packages/test-fixtures`        | F01-F12 ScoreSpec fixture catalogue (#18)                                                       | tests          |
| `packages/persistence-postgres` | `pg` repositories for scores and drafts (#9, #22, #27)                                          | Node           |
| `packages/auth-jwt`             | Supabase JWT/JWKS verification to the neutral `UserId` (#26)                                    | Node           |
| `packages/server-common`        | Shared error mapping to HTTP/MCP, logging/correlation, request-protection middleware (#19, #24) | Node           |
| `supabase/migrations`           | SQL migrations deployed with the Supabase CLI (see `supabase/README.md`)                        | Postgres       |
| `tools/`                        | Repository tooling: Vitest setup and the architecture-rule proof test                           | Node           |

The MCP View lives inside `apps/mcp` because it is part of the same inbound
adapter and ships with the server, but it is a separate program: its own
`view/tsconfig.json` (DOM + JSX), its own Vite config (`vite.view.config.ts`)
and architecture rules that forbid imports between `apps/mcp/src` and
`apps/mcp/view`. The server serves the built file; it never imports View
source.

The workspace edges each app and package is expected to use are already
declared in the package manifests (and third-party libraries are pre-installed
in the package that will use them), so planned feature work does not need to
change `pnpm-lock.yaml`. ADR-003 would also allow `apps/web` ->
`music-application`, but it is not declared: the web app reaches the use cases
through the HTTP API (#15, #21), and adding that edge later changes the
lockfile.

## Source-first packages, bundled apps

Workspace packages export TypeScript source (`"exports": { ".": "./src/index.ts" }`)
and have no build step:

- Vite (web, View) and Vitest transpile linked workspace sources directly.
- `tsc --noEmit` checks each package against the others' sources
  (`moduleResolution: Bundler`, no `.js` import suffixes, no build ordering).
- Node apps are bundled by Vite in SSR mode: `apps/api` -> `dist/main.js`,
  `apps/mcp` -> `dist/server/main.js`. Linked workspace packages are inlined;
  npm dependencies stay external and resolve from `node_modules`. The output
  is plain ESM that `node` (and later a Vercel function, #16) runs as is.
- NestJS needs legacy decorators with `emitDecoratorMetadata`, which oxc does
  not emit: `apps/api` and the node-side Vitest projects compile with SWC
  (`unplugin-swc`), reading each file's nearest `tsconfig.json`.

A built `dist/` per package was rejected: it adds a build order, stale-output
risk and `.js` import suffixes, and nothing consumes packages outside this
workspace.

## TypeScript

`tsconfig.base.json` is strict (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noImplicitOverride`,
`noImplicitReturns`). Each package extends it and narrows its environment:
pure packages get no DOM and no Node types; browser packages get the DOM lib;
Node packages get `@types/node`; React packages add `jsx: react-jsx`.
`apps/mcp` disables `exactOptionalPropertyTypes` because the pinned MCP SDK
types do not compile under it. The root `tsconfig.json` covers root config
files, `tools/` and every `apps/*/vite*.config.ts`.

## Commands

| Command                 | What it does                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `pnpm build`            | `pnpm -r build`: builds web, api and mcp (View then server)                    |
| `pnpm typecheck`        | `tsc` in every package and app, then the root config                           |
| `pnpm lint`             | ESLint (type-aware, React hooks rules, zero warnings), then `prettier --check` |
| `pnpm format`           | Prettier write                                                                 |
| `pnpm test`             | Vitest `unit` + `component` projects. No database, no browser                  |
| `pnpm test:integration` | Vitest `integration` project against `TEST_DATABASE_URL`                       |
| `pnpm test:mcp-ui`      | Vitest `mcp-ui` project in headless Chromium                                   |
| `pnpm check:arch`       | dependency-cruiser over `apps` and `packages`, then the rule-proof test        |

Apps build independently: `pnpm --filter @sheet-music/<web|api|mcp> build`.
Run the built servers with `pnpm --filter @sheet-music/api start` (port
`PORT`, default 3000) and `pnpm --filter @sheet-music/mcp start` (default 3001,
endpoint `/mcp`).

## Test categories

Categories come from docs/testing/TEST_PLAN.md §2. Discovery is by file name,
so the projects are disjoint:

| Project        | Files                                  | Environment                    |
| -------------- | -------------------------------------- | ------------------------------ |
| `unit`         | `apps/**`, `packages/**`: `*.test.ts`  | Node (SWC)                     |
| `component`    | `apps/**`, `packages/**`: `*.test.tsx` | jsdom + Testing Library        |
| `integration`  | `*.int.test.ts(x)`                     | Node (SWC), real DB/HTTP/MCP   |
| `mcp-ui`       | `*.mcpui.test.ts(x)`                   | Chromium (Playwright provider) |
| `architecture` | `tools/architecture/*.test.ts`         | Node                           |

React code, and therefore `*.test.tsx`, exists only in `score-ui`, `apps/web`
and `apps/mcp/view`. Tests may sit next to the code (`src/**`) or in a
package-level `test/` directory. A test imports the real module under test.

Integration and MCP-UI run files serially in one worker
(`fileParallelism: false`, `maxWorkers: 1`) because they share one database.
`TEST_DATABASE_URL` defaults to `postgres://user@localhost:5432/sheet_music_test`;
CI overrides it with its Postgres service. Only databases named `sheet_music_*`
may be used. Each integration file must release what it opens in
`afterAll`: `await app.close()` for Nest apps, `server.close()` for HTTP
servers, `await pool.end()` for `pg` pools, so no handle outlives its file.
Scoped runs: `pnpm vitest run --project integration <path>`.

`passWithNoTests` is on while the scaffold has no product tests.

## Architecture rules

`.dependency-cruiser.cjs` enforces ADR-003/004/005 on resolved paths, so
type-only imports, re-exports, dynamic imports, deep imports and npm aliases
are all caught:

- `music-domain`, `music-application` and `music-contracts` never depend on
  React, NestJS, the MCP SDK, `pg`, Supabase, VexFlow, SpessaSynth, Express or
  `jose`; `music-domain` depends on no other workspace package.
- Inward packages follow the ADR-003 diagram as an allow-list of workspace
  imports (besides themselves, and the fixtures from tests):
  `music-contracts` -> `music-domain`; `music-application` -> `music-domain`,
  `music-contracts`; `renderer-core` and `playback-core` -> `music-domain`;
  `score-ui` -> `music-domain`, `renderer-core`, `playback-core`. A sideways
  or outward edge (for example `renderer-core` -> `music-application`, or
  `music-contracts` -> `music-application`) is rejected, by relative path too.
- `renderer-core` never imports VexFlow; `playback-core` never imports
  SpessaSynth; `score-ui` never imports either library or their adapter
  packages; renderer and playback packages never import each other.
- VexFlow only in `renderer-vexflow`, SpessaSynth only in
  `playback-spessasynth`, the MCP SDK only in `apps/mcp`, the Supabase client
  only in `apps/web`, React only in `score-ui`, `apps/web` and `apps/mcp/view`.
- Inward packages (domain, contracts, application, ports, score-ui, fixtures)
  never import adapters (`renderer-vexflow`, `playback-spessasynth`,
  `persistence-postgres`, `auth-jwt`, `server-common`).
- Packages never import apps; apps never import other apps (MCP never goes
  through the REST app).
- Browser code (`apps/web/src`, `apps/mcp/view`, `score-ui`) never imports
  server infrastructure (`persistence-postgres`, `auth-jwt`, `server-common`,
  NestJS, `pg`, Express, `jose`).
- `apps/mcp/src` and `apps/mcp/view` never import each other.
- No module import cycles.
- Production code (everything except `test/` directories, `*.test.ts(x)` files
  and the apps' `vite*.config.ts`) never imports a devDependency, its own or
  the root one (Vitest, Testing Library, Supertest, Playwright...), nor the
  `test-fixtures` catalogue.
- Every import resolves, and every npm import is declared in the nearest
  `package.json` or the root one.

Only the workspace's own `dist/` and `coverage/` output is excluded from the
graph, so npm packages whose entry point sits under `dist/` stay visible to
every rule.

`tools/architecture/forbidden-fixture.test.ts` runs the same rule set on
`tools/architecture/fixtures/forbidden` (a miniature repository with stub
packages in its own committed `node_modules`) and proves that a type-only
import, an npm alias, a re-export, a relative-path import of an adapter, a
sideways relative import between inward packages, a devDependency (entry
point under `dist/`) in production code and an import cycle are rejected,
while compliant domain code and a test importing a devDependency are accepted.

## Pinned versions

All third-party versions are exact and live in the `catalog:` section of
`pnpm-workspace.yaml`. Deviations from the newest release, checked against the
registry on 2026-09-28:

- TypeScript 6.0.3, not 7.x: typescript-eslint 8.71 supports `<6.1` and
  dependency-cruiser 18.4 supports `<7`.
- jsdom 29.1.1, not 30.x: jsdom 30 requires Node `^24.15`; this repo supports
  Node `>=24.6`.
- `@types/node` 24.19.0 (Node 24 runtime), forced with a pnpm override because
  `@types/*` packages request `*`.
- `@modelcontextprotocol/sdk` 1.30.1 with `@modelcontextprotocol/ext-apps`
  1.7.5: ext-apps 2.x requires the split v2 SDK packages
  (`@modelcontextprotocol/server`, `client`, `core`), not
  `@modelcontextprotocol/sdk`. Moving to v2 is a deliberate upgrade of both.
- zod 4.6.5 satisfies both the SDK (`^3.25 || ^4.0`) and ext-apps.
- `react-router` 8.4.0 (the `react-router-dom` package is only a v7
  compatibility shim).
- pnpm 10 skips dependency install scripts; `@swc/core` and `esbuild` are
  listed in `ignoredBuiltDependencies` because their native binaries come
  through optional dependencies.

## CI

`.github/workflows/ci.yml`:

- `quality` (CI-01, CI-02): frozen install, typecheck, lint, build, `pnpm test`,
  `pnpm check:arch`.
- `integration` (CI-03): `postgres:15` service, `TEST_DATABASE_URL`,
  `pnpm test:integration`.
- `mcp-ui`: Chromium + built bundles + `pnpm test:mcp-ui`; gated
  (manual run or repository variable `MCP_UI_ENABLED=true`) until #11 adds
  its scenarios.
- Changes touching only `docs/` or Markdown skip the database and browser jobs.
