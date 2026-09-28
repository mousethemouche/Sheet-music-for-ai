# MVP test specification and traceability

Date: 2026-09-28. Status: implementation requirements, NOT executed tests.

## 1. Product sources and precedence

Read `docs/product/USER_STORIES.md`, the PRD, and ADR-001 through ADR-006. Later accepted decisions extend the original stories: full piano notation, multi-user authentication, and database-backed drafts with a seven-day sliding TTL. Temporary draft persistence is allowed; entering the permanent library still requires explicit user approval. Edits to an already saved artifact update that same artifact, per ADR-006.

The numbered test sections in issues #2–#27 are executable acceptance specifications. Keep their IDs in test names, e.g. `[US-D2][OPS-02] rejects stale revision without changing score`. A checkbox below means a test must be implemented; it does not claim it currently passes.

This document supersedes the earlier requirement for a large mandatory Playwright screenshot matrix. Vitest is the default runner. Protect our contracts and integration, not a reimplementation of VexFlow's test suite. Third-party tests and pinned dependencies reduce risk; they do not prove our integration is correct.

## 2. Test layers and allowed doubles

| Layer | Runtime | Real code required | Permitted substitutions |
|---|---|---|---|
| Unit | Vitest / Node | validators, operations, timeline and error mappings under test | injected clock, IDs, repository ports, external I/O |
| Component | Vitest + Testing Library / jsdom | React components, controller, event handling | renderer/playback port fakes, controlled ResizeObserver and measured bounds |
| Adapter contract | Vitest, Node where supported | actual adapter and pinned dependency public API | platform drawing/audio I/O only; do not mock every VexFlow class and call that integration |
| HTTP integration | Vitest + Nest testing + Supertest | real app bootstrap, guards, validation pipes, filters, controllers, use cases, repository adapter | test configuration, local JWKS issuer; real database for persistence assertions |
| MCP integration | Vitest + pinned MCP client/server SDK over loopback HTTP | initialize + discovery + actual tools/call, auth, use cases, repository | test issuer/external services only; direct handler calls are unit tests, not transport integration |
| Database / RLS | isolated Postgres or Supabase test stack | production migrations, transactions and policies | synthetic users/data only; never use production |
| Host/runtime smoke | tiny browser/real-host suite | actual VexFlow, asset loading, iframe bridge, WebAudio when available | fixture inputs; no live LLM needed for most cases |

Default local command: unit + component, no browser or database startup. Integration is an explicit command and a required CI job. CI owns the heavier test database. Run integration files sequentially by default; do not run one full stack per test. Keep a small real-runtime smoke on relevant changes/pre-release, not hundreds of screenshots. Geometry asserted against mocked measurements proves layout-policy arithmetic only, not actual font metrics.

Use Vitest projects for unit/component/integration separation. Pin dependency versions and commit the lockfile. Measure resource use; do not assert an invented percentage or RAM saving. Close applications, DB pools, timers, observers, workers and audio nodes after suites.

## 3. Shared fixtures and independent expectations

Create `packages/test-fixtures`. Do NOT calculate expected results by calling the same compiler/mapper being tested. Keep hand-calculated expectations separate from input JSON. Freeze fixtures to catch accidental mutation.

| Fixture | Minimum content / known expectations |
|---|---|
| F01 basic | One staff, 4/4, four quarter notes C4-D4-E4-F4; at PPQ 960: starts 0/960/1920/2880, total 3840; MIDI 60/62/64/65 |
| F02 piano | Two synchronized staves; simultaneous voices and an independently addressable C4-E4-G4 chord; durations advance by the maximum aligned voice duration, never their sum |
| F03 harmony | Dm7-G7-Cmaj7; ii7-V7-Imaj7; separate chord-root, slash bass and scale-degree labels |
| F04 meters | 7/4 = 6720 ticks at PPQ 960; 6/8 = 2880; adjacent meter changes are a schema-completion requirement, not silently ignored |
| F05 spelling | F#4 and Gb4 both MIDI 66 but different written pitch; key signature must not apply alteration twice |
| F06 rhythm | Three eighth triplets (3:2) total 960 ticks, each 320; five eighth quintuplets (5:4) total 1920, each 384; ordinary seventh-based ratios require exact rational timing / an explicit conversion policy |
| F07 pickup | A quarter-note pickup has actual duration 960, not 3840; both hands advance together; reject unexplained gaps/overfill |
| F08 expression | Tie versus phrasing slur, fingerings, accent/staccato/tenuto/marcato, p/mf/f, hairpins and sustain spans |
| F09 teaching | Three notes #ff5ca8, matching short text, melodic degrees 1/b3/5; unselected notes unaffected |
| F10 swing | Explicit eighth swing 2:1: pair starts 0/640 and total 960; straight starts 0/480; written durations unchanged; explicit tuplets not swung twice |
| F11 limits | 1/32/33 aligned measures, 0/1/2/3 staves, 0/4/5 annotations, invalid references, unknown properties, oversized input |
| F12 lifecycle | Users A/B; A/B drafts and saved scores; expired and live drafts; same timestamps for stable sorting; old stored contract fixtures when a real older version exists |

Provide combined feature fixtures too: triplets + swing + pickup; two hands + pedal + tied notes; chord fingerings + degree labels + colored annotations. Test compatibility at feature intersections, not only isolated happy paths.

## 4. Story-to-test traceability

| Product behavior | Issue/test families |
|---|---|
| US-A1 create/read piano, 1–2 staves | #2 SPEC; #5 REN; #8 CREATE; #12 MCP-CREATE |
| US-A2 short excerpts, odd meters, reject >32 | #2 SPEC; #12 MCP-CREATE; #18 FLOW |
| US-B1 sound/play/pause | #6 AUDIO; #7 UI |
| US-B2 tempo, US-B3 loop | #6 AUDIO; #7 UI |
| US-C1 colors, US-C2 explanatory text | #2 SPEC; #5 REN; #7 UI |
| US-D1 edits, US-D2 identity | #3 OPS; #13 MCP-EDIT; #22 DRAFT |
| US-E1 suggestion, US-E2 explicit save | #10 LIB; #14 MCP-LIB; #18 FLOW and host acceptance |
| US-E3 titles/tags, US-F1–F3 retrieval | #9 DB; #10 LIB; #14 MCP-LIB; #15 LIB-UI; #21 HTTP |
| Accepted extended notation | #2 SPEC; #3 OPS; #5 REN; #6 AUDIO |
| Accepted multi-user flows | #20 AUTH; #25 AUTH-UI; #26 OAUTH; #27 RLS |
| Accepted draft TTL/deploy survival | #22 DRAFT; #16 DEPLOY |
| Architecture/security/regression gates | #4 BUILD; #17 CI; #19 ERR; #23 ASSET; #24 SEC |

The language model decides what music to generate and when to suggest saving. A fixed tool integration scenario verifies software behavior, not musical creativity or arbitrary model compliance. Keep a few real-host acceptance conversations separately: ask, play, edit, decline save, confirm save, retrieve.

## 5. Exact integration surface inventory

MCP tools are not separate REST routes. They are dispatched through `tools/call` on the remote `/mcp` endpoint.

### MCP product tools: every tool gets a dedicated suite

- `create_score`: valid content -> owner-scoped draft only; invalid input/limits -> actionable error, no row.
- `edit_score`: same ID, expected revision, atomic operations; stale write/invalid target/foreign owner -> no mutation.
- `save_score`: approved save boundary -> transactional promotion; no loss on failure; no duplicate saved row on retry.
- `get_score`: own live draft or own saved score for conversational continuation; foreign/missing record -> indistinguishable not-found; no implicit write.
- `search_scores`: own saved scores only; text/tags, empty results, deterministic pagination; no drafts or other-owner counts.

### MCP protocol and resource suites

`initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read` for the registered `ui://` score resource. Test metadata/schema/resource links together. Use the project's pinned supported protocol version, initially the documented 2025-11-25 contract; never invent a new protocol/error format from a draft proposal.

`POST /mcp`: JSON-RPC request/notification semantics and authentication. `GET /mcp`: test the chosen supported SSE behavior OR documented 405 when not offered. `DELETE /mcp`: only relevant to session termination if transport sessions are enabled; otherwise assert the documented unsupported method. Document that transport sessions and persisted musical drafts are different concerns.

Test `OPTIONS /mcp` only as exposed by deployment CORS policy. Valid authenticated clients without an Origin header must not be mistaken for browser attacks. A supplied disallowed Origin is rejected. Do not add long-lived streaming simply to satisfy a test.

### Owned REST routes

- `GET /scores`: saved-library summaries only.
- `GET /scores/:id`: own saved score only; conversational draft retrieval belongs to MCP get_score.
- `GET /health` and `GET /version`: fix these route names in #21; no private score data/configuration exposed.
- No optional `PUT /scores/:id` is required by the current library story. If implemented, it must declare its metadata-only contract, expectedRevision and test matrix before merge. Do not silently add a full-score overwrite route.
- OAuth Protected Resource Metadata: public discovery URL advertised in the challenge; test the actual deployed path, resource identifier and issuer URLs in #26.
- Cleanup HTTP route: conditional on choosing an HTTP cron trigger in #22; database-scheduled cleanup needs SQL integration tests instead, not an invented HTTP endpoint.

Signup/login/recovery are provider-backed flows per ADR-005, not necessarily custom Nest `/auth/*` routes. Test our auth adapter and real provider integration. If any custom callback/consent/auth endpoint is introduced, add it to the inventory and require its route tests in the same PR.

## 6. Common route/tool assertions

For every protected product route/tool, independently cover: success; invalid shape; valid syntax but invalid domain state; missing/expired/invalid token; owner A versus B; datastore failure; serialized response shape; and persisted postconditions. Read operations do not need artificial mutation/concurrency cases. Nonapplicable cases must be recorded with a reason.

HTTP contract: unauthenticated 401; forbidden origin/insufficient granted permission 403; missing OR another owner's score 404; invalid query/argument 400; stale revision on a mutation 409; oversized HTTP body 413; rate limit 429; temporary dependency failure 503; unexpected internal error 500 without stack/secrets. Apply only where that route can produce the condition.

MCP distinction: HTTP authentication failure is 401 with challenge, NOT a successful tool result. For an authenticated well-formed call, tool input/domain failures are `result.isError: true` with stable product error code and actionable safe details. Protocol/method/envelope errors use JSON-RPC errors per the pinned SDK/spec. Never map every business failure to HTTP 500. Validate `structuredContent` against the advertised output contract, including its intentional success/error shape. Check actual serialized JSON, not only TypeScript return types.

Common mutation postconditions: failed command leaves score content, revision, TTL, ownership and library row count unchanged. Verify this using a second request/DB read. Two simultaneous edits on the same revision: exactly one commit, one conflict, revision increases once. Do not use sequential calls as the only concurrency test.

## 7. Reliability rules and scope defaults

- Successful edit increments revision once for the whole batch. Missing-target or invalid final document rejects the whole batch; no automatic silent musical repair.
- Measure count means aligned musical bars, not the sum of right/left-staff arrays. A 32-bar grand staff is valid.
- A frontend tempo multiplier is local playback state; an explicit set_tempo operation changes the canonical score. Neither creates a second artifact.
- Draft expiry: test access at the expiry boundary and after; enforce expired access even before cleanup. Reads do not refresh the accepted update-based TTL. Cleanup cannot remove a row refreshed by a concurrent successful edit.
- Schema version and revision have different meanings. Version migrations need tests on genuinely persisted older fixtures and must be safe to retry. Do not fabricate a historical v0 and claim compatibility. Unknown future schema fails safely without rewriting data.
- Pin versions and use frozen-lockfile installs. An upgrade PR must pass adapter/integration tests. Upstream VexFlow tests do not validate our chosen options, custom overlays or host iframe integration.
- No claim of universal non-regression or musical correctness from a green test run. Each approved expected result is reviewed independently; do not regenerate it merely because a test fails.

## 8. Decisions still requiring clarification

These are not permission to invent product behavior. Isolate affected tests; unrelated work can proceed. Record owner answers before marking the corresponding feature complete.

**P-01 — Editing during playback.** Proposed: stop old audio, load the new revision at tick 0, remain paused until Play. Alternative: resume automatically. #6/#7/#13 need one explicit policy.

**P-02 — Expressive playback defaults.** Proposed: swing defaults to 2:1 eighths when no ratio is given, no swing on explicit tuplets; versioned deterministic velocity/gate mappings for dynamics/articulations, no random humanization. Whether a phrasing slur changes gate times or is display-only needs agreement. Explicit ratio/math tests can be written now. Avoid presenting one velocity table as a universal musical law.

**P-03 — Conflicting teaching colors.** Proposed: two annotations cannot impose different colors on the same note; return an actionable validation conflict rather than silently using last-wins. Disjoint colors are already required.

**Security clarification, not a repeated consent question:** explicit human approval is already required. A model-supplied `confirmed: true` is NOT evidence of a human action. #14/#18 must distinguish software tests of an explicit save command from host acceptance of the user's approval. Document target-host approval support; if a strict server-verifiable guarantee is required, choose trusted UI/host approval binding to owner + score + revision. Do not add a fake test claiming the backend can read the conversation.

### Technical contract gaps to close in #2/#3, without asking the owner to design TypeScript

Explicitly define shared bar alignment and per-bar meter changes, tempo beat unit, pickup actual duration, tuplet group membership (ratio alone does not identify bracket groups), rational-to-tick policy for ratios incompatible with PPQ 960, tie endpoints including notes within chords, span endpoint inclusivity/scope, harmony beat origin/unit, pitch-spelling policy for transposition and downstream label handling. Tests must encode an agreed unambiguous representation, not guess from optional fields.

## 9. CI completion rules

Each issue carries its own unit/integration tests; #18 supplies the harness and cross-feature scenarios, not a testing phase postponed until the end. A code PR identifies test IDs and story IDs, includes positive/negative/boundary cases, and passes unit + API/MCP integration + DB isolation jobs relevant to it. Main is releasable only after the complete suite.

Maintain an independently reviewed endpoint/tool inventory. A new registered tool or owned route without a mapped executable integration suite fails the contract-coverage check. Both listing coverage and assertions of effects matter. Test coverage reports are diagnostics, not proof of correctness. No disabled security/concurrency case or automatically accepted screenshot counts as passing.

No production DB access, credentials, paid LLM calls, or delivered emails in default CI. Real auth validation uses signed test tokens and real signature verification; provider integration uses a dedicated test stack. Auth provider hosted screens/target-host iframe behavior require a small release smoke and are not guaranteed by HTTP tests alone.

## 10. Verified implementation references

These are upstream references, not proof our unimplemented product works:

- Vitest projects and separate runtimes: https://vitest.dev/guide/projects.html and https://vitest.dev/guide/environment.html
- Nest application testing and Supertest: https://docs.nestjs.com/fundamentals/testing
- MCP tools/errors: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP HTTP transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Supabase database tests: https://supabase.com/docs/guides/database/testing
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase MCP authentication: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
