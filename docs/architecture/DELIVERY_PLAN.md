# MVP technical delivery plan

Updated 2026-09-28. Build plan and test requirements, not completed implementation.

## Read first

Product: PRD, STORY_MAP and USER_STORIES. Architecture: ADR-001–006 (ScoreSpec, operations, monorepo/MCP, renderer/playback, multi-user auth, persistent drafts).

Testing authority: [TEST_PLAN](../testing/TEST_PLAN.md) and [MCP–UI integration](../testing/MCP_UI_TEST_PROCESS.md). These replace older cumulative test checklists. One risk has one primary test owner; reference existing executable evidence from another issue instead of writing the same suite again. Features and approved P-01/P-02/P-03 are not reduced.

## 1. Foundation and test harness

#4 monorepo; #17 CI/boundaries; #18 shared fixtures/harness. Start #19 shared errors and #24 safe input/middleware as their boundaries appear.

Exit: clean install/build/typecheck/lint; separate fast Vitest unit/component command and actual integration command; inward dependencies checked once. No required dummy tests for empty packages or custom coverage framework.

## 2. Music core

#2 ScoreSpec/runtime rules and completion of precise music semantics; #3 typed ScoreOperations; #8 CreateScore orchestration.

Exit: valid fixtures, immutable operations and structured failures tested in pure TypeScript. Application can use repository doubles in units; production draft creation is wired in phase3, never memory-only. Do not copy the full music-validation matrix to MCP or React tests.

## 3. Independent tracks: media and server foundations

After core contracts, proceed in parallel where dependencies allow:

- Media: #5 VexFlow adapter; #6 neutral compiler/synth; #23 piano asset; #7 ScorePlayer. Asset selection/configuration does not wait for finished audio/deployment. Adapter unit tests and provisional actual-runtime checks can run before MCP host exists; consolidate actual checks into the shared host harness later.
- Identity/data: #20 auth umbrella; #25 web auth; #9 repository/migrations; #22 persistent drafts/TTL/promotion; #27 RLS. These tests use one isolated stack, not production.
- MCP foundation: #11 server/resource/View skeleton and #26 HTTP OAuth protection can be built together once neutral use-case ports exist. Do not make umbrella completion a circular blocker on its children.

Exit: actual rendered/playable fixture; trusted owner principal; durable private draft repository. Detailed behavior tests stay in their owning issues.

## 4. Conversational and saved-library integration

#12 create_score; #13 edit_score; #10 save/get/search use cases; #14 library MCP tools; #21 saved HTTP routes; #15 minimal React library.

Tests delivered alongside features:

- ONE FLOW-01 (#18): actual MCP create/get/edit/save/search -> REST list/get -> saved edit, with named route assertions.
- ONE ACCESS-01 (#18): route/tool-level owner-isolation matrix.
- Focused route-specific failures in #12–14/#21; shared auth/errors stay #26/#19.
- THREE MCP–UI integration cases (#11): real resource/create path, actual update path, error/context/teardown. This is not an extra E2E/host category.

Exit: accepted product loop and public contracts verified without duplicating them at application, repository, host and E2E levels. No permanent save before human approval; draft state is explicitly temporary.

## 5. Deployment and release verification

#16 workspace/runtime/environment/asset configuration, plus production details of #19/#24. Reuse existing integration harness with preview URLs/test data rather than create another full regression suite.

Run all relevant owned suites and the same small MCP–UI integration before release. Preserve actual migration/CAS/promotion/expiry/RLS checks; screenshots/100% line coverage do not replace them.

One narrow actual target-host compatibility check is shared by deployment/auth: connect, display/play, edit, decline/approve save, retrieve. Required for first external release and relevant host/auth/SDK changes, not a full owner recipe every PR. Inspector/reference-host checks are diagnostic when needed, not duplicate permanent gates. Record unavailable authorized host access honestly.

## Test ownership and parallel execution

#18 and #20 are harness/umbrella work, NOT late new test phases. Tests belong to the feature or boundary that owns the failure:

- #2 schema, #3 operations;
- #5 renderer mapping, #6 timeline/engine, #7 UI revision policy;
- #9 database search/CAS/migrations, #22 TTL/promotion/cleanup, #27 limited-role RLS;
- #11 MCP setup and MCP–UI integration, #12–14/#21 route-specific behavior;
- #25 web auth, #26 verifier/authorization, #19 shared errors, #24 request protection.

Share one test DB per CI job with isolated data and bounded workers. Unit/components are browser-free; only actual iframe/adapter integration needs a browser. Do not run every fixture × route × viewport. Shared contract/auth/lockfile changes trigger dependent tests; documentation-only changes do not start heavy services.

## Coding-agent completion rule

Each implementation PR states its unique risk, test location/result and reused evidence. A test is useful if it distinguishes correct behavior from a plausible failure not already caught at the same boundary. Do not add pass-through controller/getter/mock-call tests where actual integration already covers them. Additional tests are welcome for a distinct branch, security boundary or reproduced bug; no arbitrary count quota.

Unanswered engineering details in #2/#3 must be made explicit, not hidden behind optional fields. Product decisions already settled: real multi-user auth, seven-day update-based drafts, P-01 stop/load/paused on new revision, P-02 deterministic audible expression/legato, P-03 reject conflicting note colors. Do not ask the owner to reconfirm them.

Remaining human/host evidence concerns actual unseen music/sound/readability and trusted save approval, not permission to postpone automated tests. Green fixtures do not establish arbitrary AI creativity or guarantee all third-party host behavior.
