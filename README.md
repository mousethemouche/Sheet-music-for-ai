# Sheet Music for AI

An MCP App in which an AI creates readable, playable piano scores inline in the
conversation, refines them on request, and saves them to a personal library
only after the user confirms.

Status: MVP v1 implementation has started. The monorepo, tooling and CI are in
place. Product features land issue by issue (see
[DELIVERY_PLAN](docs/architecture/DELIVERY_PLAN.md)).

## Requirements

- Node 24 (`.nvmrc`; `>=24.6`)
- pnpm 10 (pinned in `packageManager`)
- PostgreSQL 15 for integration tests (databases named `sheet_music_*` only)
- Chromium for the MCP-UI suite: `pnpm exec playwright install chromium`

```sh
pnpm install --frozen-lockfile
```

## Structure

```text
apps/
  web/        React + Vite SPA: standalone player, auth, saved library
  api/        NestJS HTTP app (saved-score routes, health, version)
  mcp/        MCP server (stateless Streamable HTTP, POST /mcp)
    view/     MCP Apps View: React, built into ONE self-contained HTML file
packages/
  music-domain/          ScoreSpec, invariants, pure music logic
  music-contracts/       transport-neutral schemas and DTOs
  music-application/     use cases and neutral ports
  renderer-core/         renderer port, LayoutMap
  renderer-vexflow/      VexFlow adapter
  playback-core/         PlaybackPlan, timeline compiler, engine port
  playback-spessasynth/  SpessaSynth adapter
  score-ui/              React ScorePlayer over the ports
  test-fixtures/         F01-F12 ScoreSpec fixtures
  persistence-postgres/  pg repositories
  auth-jwt/              Supabase JWT/JWKS verification to UserId
  server-common/         shared error mapping, logging, request protection
supabase/migrations/     SQL migrations for Supabase cloud
tools/                   Vitest setup and architecture-rule proof test
```

Packages export TypeScript source and have no build step; Vite, Vitest and
`tsc` consume them directly, and the Node apps are bundled by Vite. Details,
version constraints and the reasoning behind them:
[REPO_LAYOUT](docs/architecture/REPO_LAYOUT.md).

## Commands

| Command                 | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `pnpm build`            | Build web, api and mcp (View bundle, then server)                 |
| `pnpm typecheck`        | Strict `tsc` in every package and app                             |
| `pnpm lint`             | ESLint (type-aware, zero warnings) and Prettier check             |
| `pnpm format`           | Format with Prettier                                              |
| `pnpm test`             | Unit + component tests. Starts no database and no browser         |
| `pnpm test:integration` | DB/API/MCP integration tests, serial, against `TEST_DATABASE_URL` |
| `pnpm test:mcp-ui`      | MCP-UI integration in headless Chromium                           |
| `pnpm check:arch`       | Dependency rules (dependency-cruiser) and their proof test        |

One app at a time: `pnpm --filter @sheet-music/<web|api|mcp> build`, then
`pnpm --filter @sheet-music/api start` (port 3000) or
`pnpm --filter @sheet-music/mcp start` (port 3001, `/mcp`). `PORT` overrides
the default. Web dev server: `pnpm --filter @sheet-music/web dev`.

## Tests

Unit, component and integration (with its MCP-UI sub-suite) from the
[TEST_PLAN](docs/testing/TEST_PLAN.md), selected by file name so each file runs
in exactly one Vitest project:

| File name         | Project       | Runs in                                                               |
| ----------------- | ------------- | --------------------------------------------------------------------- |
| `*.test.ts`       | `unit`        | Node                                                                  |
| `*.test.tsx`      | `component`   | jsdom + Testing Library (React packages only)                         |
| `*.int.test.ts`   | `integration` | Node, real Postgres/HTTP/MCP, one worker                              |
| `*.mcpui.test.ts` | `mcp-ui`      | Chromium, one worker ([process](docs/testing/MCP_UI_TEST_PROCESS.md)) |

`TEST_DATABASE_URL` defaults to
`postgres://user@localhost:5432/sheet_music_test`. Tests import the real module
under test; integration tests close their apps, servers and pools in
`afterAll`.

## Dependency rules

Dependencies point inward (ADR-003/004/005), checked by `pnpm check:arch`
including type-only imports, re-exports and aliases:

- `music-domain`, `music-application` and `music-contracts` never import React,
  NestJS, MCP SDK, `pg`, Supabase, VexFlow, SpessaSynth, Express or `jose`.
- `renderer-core` has no VexFlow, `playback-core` has no SpessaSynth, `score-ui`
  uses the ports only; VexFlow and SpessaSynth live only in their adapters.
- Inward packages never import adapters and import only the workspace packages
  the ADR-003 diagram allows (no sideways edge such as `renderer-core` ->
  `music-application`); packages never import apps; apps never import each
  other; React only in `score-ui`, `apps/web` and `apps/mcp/view`; MCP SDK only
  in `apps/mcp`; Supabase client only in `apps/web`; browser code never imports
  server infrastructure.
- No import cycles; production code never imports devDependencies or the
  test fixtures.

## Specifications

- Product: [PRD](docs/product/PRD.md), [STORY_MAP](docs/product/STORY_MAP.md),
  [USER_STORIES](docs/product/USER_STORIES.md)
- Architecture: [ADR-001 ScoreSpec](docs/architecture/ADR-001-score-spec-contract.md),
  [ADR-002 ScoreOperations](docs/architecture/ADR-002-score-operations.md),
  [ADR-003 monorepo/MCP](docs/architecture/ADR-003-monorepo-mcp-boundaries.md),
  [ADR-004 rendering/playback](docs/architecture/ADR-004-rendering-playback-boundaries.md),
  [ADR-005 auth](docs/architecture/ADR-005-multi-user-auth.md),
  [ADR-006 drafts](docs/architecture/ADR-006-draft-score-lifecycle.md);
  contracts: [ScoreSpec v1 semantics](docs/architecture/SCORESPEC_V1_SEMANTICS.md),
  [ScoreOperations v1](docs/architecture/SCORE_OPERATIONS_V1.md),
  [application layer](docs/architecture/APPLICATION_LAYER.md)
- Testing: [TEST_PLAN](docs/testing/TEST_PLAN.md),
  [MCP-UI process](docs/testing/MCP_UI_TEST_PROCESS.md)
- Database: [supabase/README](supabase/README.md)
