# MVP Technical Delivery Plan

This document orders the implementation backlog so a coding agent can work through the repository without rediscovering architecture.

## Phase 0 — Product + architecture specs

Already defined:

- PRD / Story Map / User Stories
- ADR-001 — ScoreSpec v1
- ADR-002 — ScoreOperations v1
- ADR-003 — Monorepo boundaries and MCP as inbound adapter
- ADR-004 — Independent rendering and playback pipelines
- ADR-005 — Multi-user authentication with Supabase Auth and OAuth 2.1 for MCP

## Phase 1 — Repository foundation

1. **#4 — Scaffold pnpm monorepo with architectural package boundaries**
2. **#17 — Add CI quality gates and architecture boundary tests**
3. **#19 — Add structured errors, logging and basic observability** (start minimal, extend throughout)
4. **#24 — Add MCP/API input limits and security hardening** (start schema-level protections early)

Exit criteria:
- clean install/build/test/lint;
- architectural dependency rules enforced automatically.

## Phase 2 — Canonical music core

1. **#2 — Implement ScoreSpec v1 canonical music-domain contract**
2. **#3 — Implement ScoreOperations v1 mutation contract**
3. **#8 — Implement CreateScore application use case**

Exit criteria:
- scores can be created and edited in pure TypeScript tests with no browser, database, MCP, VexFlow or SpessaSynth dependency.

## Phase 3 — Rendering and playback vertical

These can proceed largely in parallel after ScoreSpec fixtures exist:

1. **#5 — Implement VexFlow renderer adapter**
2. **#6 — Implement playback compiler + SpessaSynth adapter**
3. **#23 — Select/document commercially usable piano SoundFont**
4. **#7 — Build reusable React ScorePlayer UI + annotations**

Exit criteria:
- one canonical ScoreSpec fixture renders and plays;
- play/pause/tempo/loop work;
- noteId synchronization works;
- same-color note annotations + text render cleanly.

## Phase 4 — Auth foundation

Because the MVP is shared with external testers, real multi-user auth is part of the first testable architecture rather than a post-MVP add-on.

1. **#20 — Implement multi-user authentication and authorization boundary** (umbrella)
2. **#25 — Build signup/login/logout/password-recovery UI with Supabase Auth**
3. **#26 — Protect remote MCP with Supabase OAuth 2.1 and map tokens to UserId**

Exit criteria:
- tester can create/sign into an account;
- remote MCP can authenticate the same account;
- all inbound adapters resolve a neutral application UserId.

## Phase 5 — MCP vertical slice

1. **#11 — Implement MCP server and MCP Apps score View shell**
2. **#12 — Expose create_score MCP tool**
3. **#22 — Resolve unsaved draft lifecycle**
4. **#13 — Expose edit_score MCP tool**

Exit criteria:
- from a compliant AI host, authenticated user creates a score, inline View renders/plays it, and a later conversational edit updates the same logical artifact.

This is the first major conversational MVP milestone.

## Phase 6 — Persistence and library

1. **#9 — Implement score repository ports + JSONB persistence**
2. **#27 — Add owner-scoped persistence and Supabase RLS policies**
3. **#10 — Implement SaveScore/GetScore/SearchScores use cases**
4. **#14 — Expose save_score/get_score/search_scores MCP tools**
5. **#21 — Implement minimal NestJS HTTP library adapter**
6. **#15 — Build minimal React saved-score library**

Exit criteria:
- explicit save only;
- saved score can be searched/reopened;
- cross-user access is blocked at application and database layers.

## Phase 7 — Production/deployment

1. **#16 — Vercel deployment configuration**
2. Finish production parts of **#19** observability
3. Finish public-deployment parts of **#24** security

Exit criteria:
- web/API/MCP are deployable and production URLs/assets work;
- secrets stay server-side;
- MCP UI resources and SoundFont resolve correctly.

## Phase 8 — Acceptance suite

1. **#18 — Create MVP automated acceptance test suite**

The acceptance suite should be developed incrementally earlier, but this phase finalizes the complete cross-layer flow.

Golden product flow:

1. tester signs in;
2. AI creates an 8-bar piano exercise;
3. score contains a simple pedagogical colored-note annotation;
4. inline renderer displays it;
5. playback starts;
6. tempo changes;
7. loop is enabled;
8. AI changes the same score;
9. stable identity/revision behavior is verified;
10. user explicitly saves;
11. user later retrieves and reopens the score;
12. a second user cannot access that score.

## Parallelization guidance

Safe parallel work after Phase 1:

```text
                 ScoreSpec (#2)
                /      |       \
               v       v        v
       Renderer #5  Playback #6  Operations #3
               \       /          |
                v     v            v
               Score UI #7      CreateScore #8
                    \             /
                     v           v
                      MCP vertical

Auth #25/#26 can proceed in parallel once scaffold #4 exists.
```

Do not parallelize work that changes the canonical ScoreSpec shape without coordinating its fixtures and schemas.

## Agent execution rule

Each implementation issue should be completed with:
- tests;
- typecheck/lint;
- no forbidden dependency violations;
- a short implementation note explaining important decisions;
- no expansion beyond the issue's explicit scope without opening/following a new issue.

## Known blockers requiring product-owner decisions

- **#22 unsaved draft lifecycle**
- musical golden fixtures for **#18**

Identity/auth is now decided by ADR-005.

Everything else can proceed from the existing specs.
