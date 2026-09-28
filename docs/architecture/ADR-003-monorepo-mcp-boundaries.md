# ADR-003 — Monorepo boundaries and MCP as an inbound adapter

- **Status:** Accepted
- **Date:** 2026-09-28
- **Scope:** MVP v1

## Decision

The repository will use a pnpm workspace monorepo with applications separated from reusable domain/application packages.

```text
apps/
  web/                 # React browser UI / local preview / library
  api/                 # NestJS HTTP application + persistence composition root
  mcp/                 # MCP server / MCP Apps adapter

packages/
  music-domain/        # ScoreSpec, invariants, pure music logic
  music-application/   # use cases: CreateScore, EditScore, SaveScore, SearchScores...
  music-contracts/     # transport-neutral schemas/shared DTOs where needed

  renderer-core/       # renderer port + neutral RenderResult/LayoutMap
  renderer-vexflow/    # VexFlow adapter only

  playback-core/       # PlaybackPlan, playback port, timeline compiler
  playback-spessasynth/# SpessaSynth adapter only

  score-ui/            # React score/player components independent from MCP host
  test-fixtures/       # canonical ScoreSpec fixtures
```

## Dependency direction

```text
                apps/web
                apps/api
                apps/mcp
                   |
                   v
          music-application
                   |
                   v
             music-domain

renderer-vexflow ----> renderer-core ----> music-domain
playback-spessasynth -> playback-core ---> music-domain
score-ui ------------> renderer-core / playback-core / music-domain
```

Application code may depend inward. Domain code never depends outward.

## MCP boundary

MCP is an **inbound interface adapter**, not the application core and not a proxy to REST.

Bad:

```text
MCP -> HTTP call -> REST controller -> application use case
```

Good:

```text
MCP adapter ------\
REST controller ---+--> same application use case
internal UI -------/
```

The MCP package may import MCP SDK / MCP Apps packages. Domain and application packages may not.

## MCP Apps UI

Interactive score rendering is delivered as an MCP Apps UI resource. A model-visible tool may reference a `ui://...` resource, which the host renders in a sandboxed iframe.

The score View consumes structured tool results and may call app-visible tools for UI-only actions when appropriate.

Core product state remains server/domain state; the iframe does not become the canonical source of truth.

## Composition roots

- `apps/api` wires NestJS, persistence adapters, repositories and HTTP endpoints.
- `apps/mcp` wires MCP transport, MCP Apps resources and the same application use cases.
- `apps/web` wires React views and client-side renderer/playback adapters.

No app owns business rules.

## Vercel

All deployable apps must be independently buildable for Vercel.

The exact project topology may be:
- one Vercel project with workspace-aware builds; or
- separate Vercel projects for web/API/MCP.

The code architecture must not depend on which deployment topology is selected.

## Forbidden imports

At minimum:

```text
music-domain -> NestJS
music-domain -> MCP SDK
music-domain -> React
music-domain -> VexFlow
music-domain -> SpessaSynth
music-domain -> Supabase/Postgres client

music-application -> NestJS controllers
music-application -> MCP SDK
music-application -> React
music-application -> VexFlow
music-application -> SpessaSynth

renderer-core -> VexFlow
playback-core -> SpessaSynth
```

Only infrastructure/adapters know concrete libraries.

## Consequences

- MCP can evolve independently from REST/web.
- Renderer and synth are replaceable.
- Tests can run most business logic without browser, MCP host or database.
- The agent can work issue-by-issue without crossing architectural boundaries accidentally.
