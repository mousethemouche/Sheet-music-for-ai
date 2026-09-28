# MVP test plan — useful coverage, one owner per risk

Updated 2026-09-28. Status: specifications for implementation, NOT executed tests.

## 1. Rule for the coding agent

Test each rule at the lowest level that can actually detect its failure. Add a higher-level test only for a distinct integration risk. Do not copy a complete scenario into unit, component, repository, MCP, host and E2E suites.

This revision REPLACES the previous cumulative test checklists. Product scope, ADR-001–006, USER_STORIES and accepted P-01/P-02/P-03 remain unchanged. Shorter checklists do not remove supported music, privacy or data-safety requirements.

For every added test, identify: the failure it catches, its observable expected result, and why an existing test cannot catch that failure. An integration success may cover a trivial controller/handler's mapping: do not also require a mock-only unit test asserting that the controller called its service. Keep unit tests for actual branching/transformations.

One test may satisfy several issue/story checkboxes. Link its file/title from those issues instead of implementing it again. Parameterize small meaningful variations; do not conceal an enormous feature × route × browser × viewport Cartesian product inside test.each. Keep failures independently named, not one gigantic assertion block. Existing useful regression tests must not be removed solely to hit a test-count target.

## 2. Only three categories

- **Unit (Vitest / Node):** music validation, mutations, timeline/expression, expiry policy, shared security/error decisions. Clock/ID/I/O ports may be injected; expected outputs are independent of production code.
- **Component (Vitest + Testing Library):** React behavior through neutral renderer/playback/auth ports. Test decisions, visible states and cleanup, not CSS class names, hook internals or library call sequences with no product consequence.
- **Integration:** real boundaries: database, API, MCP, MCP–UI, and actual renderer/audio adapters. MCP–UI is a sub-suite, not an additional E2E/host test tier.

Default local command runs unit/components without browser or database. Explicit integration command uses one isolated database stack and bounded workers. MCP–UI uses one browser worker; runtime adapter checks share that harness where feasible. No production data, paid LLM calls or real tester emails in CI.

## 3. Ownership: implement once, reference elsewhere

| Risk / behavior | Primary test owner | Other issues reuse evidence |
|---|---|---|
| ScoreSpec schema, rhythm, references, limits, P-03 | #2 unit | #3/#8/#12 check delegation/error propagation only |
| Typed edits, identity, final-batch validation | #3 unit | #13 covers transport and persisted outcome |
| Our VexFlow mapping and actual API usage | #5 unit + adapter integration | #7/#11 do not repeat engraving cases |
| Timing, swing, audible expression, engine state | #6 unit + adapter integration | #7 checks UI commands; #11 checks bridge wiring |
| React revision application/P-01 and annotation presentation | #7 component | #11 contains one representative wired revision update |
| Create/save/get orchestration that has real branches | #8/#10 unit | successful public flow is FLOW-01, not another DB lifecycle suite |
| Storage round-trip, actual migrations, search semantics, atomic revision write | #9 DB integration | public routes test one query mapping, not the entire search matrix |
| Draft expiry, cleanup races and transactional promotion | #22 unit/DB integration | #14 checks save response/replay, not a second rollback suite |
| Direct database authorization | #27 DB integration | distinct from actual route ownership in ACCESS-01 |
| JWT verification and protected-route wiring | #26 unit/integration | no full token matrix repeated per tool |
| Auth UI and provider signup/recovery | #25 component/provider integration | #20 is umbrella only |
| Common error conversion/redaction | #19 unit + one wire failure per transport | no outage case at every thin handler |
| Input abuse and request middleware | #24 | schema limits stay #2; owner isolation stays ACCESS-01/#27 |
| Actual MCP lifecycle/resource declarations | #11 protocol integration | tool behavior stays #12–14 |
| Public happy path and route-level foreign-owner checks | #18 FLOW-01 / ACCESS-01 | #12–14/#21 reuse the same executable tests |
| Actual iframe/bridge/bundled View | #11 MCP-UI-01..03 | #18/#17 reference them; no duplicate host suite |

Integration must boot production guards, validators, filters and use cases; a direct mocked handler call is not a transport test. Use the real test DB for persistence/transaction assertions, limited database roles for RLS, and actual signed test tokens for signature verification. A fake LayoutMap proves our layout arithmetic only, not browser font measurement. Keep a small actual-library check; do not reproduce VexFlow's internal glyph tests.

## 4. Fixtures: small reusable inputs, not an all-layer matrix

Retain F01–F12 IDs as a fixture catalogue, not twelve mandatory browser stories:

| ID | Purpose / independent oracle |
|---|---|
| F01 | 4/4 C4-D4-E4-F4 quarters: PPQ960 starts0/960/1920/2880, MIDI60/62/64/65, total3840 |
| F02 | Aligned two-hand voices and C4-E4-G4 chord; time advances in parallel; each chord note addressable |
| F03/F05 | Chords, Roman analysis, degrees and spelled pitch; F#4/Gb4 both sound66 but remain differently written |
| F04/F07 | 7/4 total6720, 6/8 total2880; quarter pickup960; adjacent meter changes and hand alignment |
| F06 | Three eighth triplets:320 each,total960; five eighth quintuplets:384 each,total1920; explicit rational policy for other supported ratios |
| F08 | Slur versus tie, fingerings, articulations, dynamics/hairpin/pedal; paired legato/unmarked expectations |
| F09/F10 | Three pink notes + matching text; conflict negative case; straight starts0/480 versus requested swing2:1 starts0/640 |
| F11 | Boundary inputs:32/33 bars,2/3 staves,4/5 annotations, invalid references and malformed payloads |
| F12 | Users A/B, drafts/saved/expired items, tied timestamps, test clock and real historical fixtures when they exist |

Compose one small rich valid fixture for wire serialization and adapter checks. Retain targeted combined-feature cases where interactions matter: tuplets with swing, pedal with ties, chord member with fingering/color. Do not run every musical fixture through every tool or screenshot every viewport.

## 5. Minimum public integration contract

Use actual HTTP MCP tools/call and actual Nest routes. Every exposed tool/route has named executable coverage, but not its own copy of the entire product lifecycle.

**FLOW-01 (#18):** authenticated A creates a rich draft via MCP -> get -> edits same ID -> explicitly saves -> searches via MCP and GET /scores -> reopens via GET /scores/:id -> edits/gets the saved item. Assert actual serialized contracts, same logical identity, revision updates, no permanent item before save, one saved item after save and no silent feature loss. Share this flow with #12–14/#21; do not add it again under an E2E folder.

**ACCESS-01 (#18):** compact table across the five product tools and protected saved routes: valid A/B contexts remain isolated; exact foreign ID behaves like not-found, search/counts reveal only own saved items, forged owner input grants no access. Include one overlapping A/B request pair to expose mutable principal leakage. Failed writes leave data unchanged. These are route-wiring tests, not duplicates of database-role RLS tests.

| Surface | Additional focused coverage owner |
|---|---|
| create_score | #12: malformed input and one valid-shape domain rejection produce actionable failure/no draft; rich serialization success shared with FLOW-01 |
| edit_score | #13: stale/replayed revision and invalid later operation/color conflict leave persisted content/revision/TTL unchanged; success shared with FLOW-01 |
| save_score | #14: invalid metadata, expired draft, stale save and replay response; atomic rollback/races tested once in #22 |
| get_score | #14: missing/expired/unsupported content safely fails; reads do not renew TTL; live/saved success shared with FLOW-01 |
| search_scores | #14: representative query+tags+pagination and no-match response; exhaustive matching/sorting cases live only in #9 |
| GET /scores, GET /scores/:id | #21: representative query/path errors, summaries vs full saved score, no draft exposure; success uses FLOW-01 |
| GET /health, GET /version | #21: one table of public status/payload/no-secret expectations; no artificial mutation/auth matrix for liveness |
| MCP initialize/discovery/resources/HTTP handling | #11: one lifecycle/resource scenario and compact setup/error cases; do not re-test the SDK's full conformance suite |
| Auth discovery, POST /mcp and protected HTTP guards | #26: real auth verification plus one missing-token check for each independent protected route, not every token variant × every tool |
| Optional custom consent/callback/cleanup/write route | owning issue: add a focused success/failure/auth case only when actually introduced |

Five product tools remain create_score, edit_score, save_score, get_score, search_scores. No REST mutation route, stream or extra UI action is added merely to satisfy tests. Test supported/unsupported transport methods according to the chosen pinned SDK contract, not speculative features.

Keep an independent, small route/tool manifest with test references (#18). Compare exposed surface to it in CI. It establishes no untested entry point is forgotten, NOT that a listed route is fully correct; avoid building a bespoke coverage framework.

Shared public semantics stay unchanged: invalid REST input400; absent/invalid auth401; forbidden origin/permission403; missing/foreign item404; mutation conflict409; size413; rate429; unavailable dependency503. Apply only where relevant. Authenticated MCP tool failures use the chosen tool-error contract, not success-shaped empty results; malformed protocol is a protocol error. #19 tests the mapping table once and one real failure per transport. Additional handler-specific failure tests require distinct behavior.

## 6. Accepted product policies retained

**P-01:** on accepting a newer canonical revision of the active score, stop old audio/release notes and pedal, load at tick0, remain paused until explicit Play, even if loop was enabled. Duplicate/stale result, rejected edit and local tempo slider do not trigger replacement. Failed local application stays silent/recoverable; never old audio under new notation. Detailed revision races are #7; one bridge-wiring case is #11.

**P-02:** absent feel is straight; requested swing without ratio uses2:1, default eighth subdivision; explicit ratio wins and explicit tuplets are not swung twice. Articulations/dynamics/hairpins and phrasing legato are audible, deterministic, no random humanization. A slur retains distinct attacks, written rests/pitches and source IDs; no implicit pedal or tie conversion. Engineering gate/velocity/precedence constants must be documented/versioned, not presented as owner-chosen musical laws. Detail tests live #6; do not copy timing math into MCP/UI tests.

**P-03:** different teaching colors on one note reject the final document, never last-wins. SCORE_VALIDATION_FAILED with ANNOTATION_COLOR_CONFLICT identifies safe affected IDs. No partial write/revision/TTL change. Same canonical color overlap and disjoint colors remain valid; explicitly repairing/removing the prior annotation in the submitted batch may resolve conflict. Playback cursor is not a teaching annotation. Detailed rule tests #2, batch behavior #3, one real error propagation #13.

Draft TTL remains seven days after latest successful update, reads never renew it; expired access is blocked even before cleanup. Saved artifacts retain identity and can evolve. Permanent save still needs human approval; model-generated confirmed:true is not proof. Keep target-host approval verification separate from testing the explicit application SaveScore boundary.

Contract work in #2/#3 still defines shared bars/local meter, tempo unit, pickup actual duration, tuplet groups, rational conversion, tie endpoints/chord members, span/offset semantics and transposition spelling/label behavior. Removing duplicate tests must not hide these implementation requirements.

## 7. What is intentionally NOT required

No second acceptance suite in #18/#20 repeating child suites. No mandatory unit tests for pass-through controllers/constructors/getters already exercised through their public route. No full SVG/DOM snapshots, pixel matrix or duplication of VexFlow's own tests. No exhaustive random fuzzing/mutation-testing project as an MVP gate; add a targeted regression or bounded generator when a real risk justifies it.

No separate internal-host + basic-host + E2E suites implementing the same cases. One MCP–UI integration suite; use a minimal official-AppBridge host or automate a pinned basic-host, not both permanently. Inspector/reference-host runs remain diagnostics for SDK changes/unexplained interoperability problems.

Do not retest all upstream OAuth algorithms or SoundFont parsing formats; verify our options/trust boundary and one real integration. Do not add product features, retries, caches or custom approval endpoints solely to manufacture tests for them.

## 8. Execution and completion

Unit/components run locally by default. Actual API/MCP/DB integration runs in CI with one isolated stack, serial DB work and proper teardown. The same tests are reused, not copied, for downstream verification. Shared contracts/auth/migrations/lockfile changes trigger relevant dependent suites; documentation-only changes do not start browser/DB. Full integration including the tiny MCP–UI suite runs before release. No automatic snapshot acceptance or skipped security cases counted as coverage.

Keep one narrow actual target-host compatibility smoke for first tester release and relevant host/auth/SDK changes: connect, display/play, edit, decline/approve save, retrieve. This is external integration evidence, not the daily owner recipe. Combine it with provider/auth and sound/notation review where practical. If access is unavailable, report that unverified boundary honestly rather than claiming the local harness proves it.

A PR states which unique risks/tests it owns, which existing tests it reuses, and the commands/results. No arbitrary test-count or100% line-coverage quota. Successful tests reduce known risks; they cannot guarantee zero regressions.
