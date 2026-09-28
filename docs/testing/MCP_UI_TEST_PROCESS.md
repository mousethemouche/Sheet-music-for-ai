# MCP–UI integration: one small suite

Updated 2026-09-28. Test requirements, not executed tests. Replaces the earlier six-layer host/E2E process. See [TEST_PLAN.md](TEST_PLAN.md) for ownership and shared scenarios.

## Purpose

Verify the boundary our other tests do not exercise: actual MCP result/resource -> host bridge -> sandboxed iframe -> production-built React View. This is `integration/mcp-ui`, not another testing category. It does not repeat business validation, every musical feature, playback math or the saved-library lifecycle.

Owner: issue #11. Issues #17/#18 reuse its evidence, not duplicate implementations.

## One harness only

Use a real loopback MCP server/client, test identity, actual registered ui:// resource, official AppBridge and the actual bundled View. Prefer adapting a minimal pinned reference-host implementation where practical. Choose this OR an automated basic-host as the fixture host; do not maintain parallel host suites for the same behavior. Do not hand-build a competing bridge protocol.

Use one browser worker and one isolated test backend. No live LLM, screenshots as pass criteria, video or viewport matrix. Inspect semantic state/DOM and sanitized bridge events. Test-host instrumentation stays outside production application code; never inject fake score data after obtaining the real tool result. Component port fakes are for #7, not evidence the actual bundle/audio works.

## Three scenarios

- [ ] **MCP-UI-01 — boot and real result:** initialize MCP, discover tool/resource, call create_score using one rich valid fixture, fetch the real resource and mount the View in a sandboxed iframe. Handshake completes; correct score ID/revision and usable controls appear; required built assets load and no uncaught error. This scenario also hosts the minimal actual VexFlow/synth/asset smoke owned by #5/#6/#23: verify labels/note mapping, user-gesture playback/progress and stop. No screenshot baseline or exact audio-byte comparison.
- [ ] **MCP-UI-02 — update wiring:** while that View plays, route one actual successful edit through the bridge. Same score ID, newer revision, old sound stopped, new score at tick0 in pause; explicit Play uses the new plan. This verifies P-01 wiring only; exhaustive stale/duplicate/failed-load permutations stay in #7.
- [ ] **MCP-UI-03 — failure isolation and lifecycle:** route one real rejected edit, e.g. color conflict. Display recoverable error and retain last valid score/revision. Send the theme/width context the View actually uses, then unmount; bridge disconnects and resources/listeners stop. Test an app-initiated return path only if the product actually implements one, extending the relevant scenario instead of inventing new UI.

Each scenario should report its own failure and have reliable setup/teardown; shared infrastructure does not mean hidden test ordering. No separate HOST/FLOW/E2E copies of these cases. Use selected viewports only when testing a specific responsive issue; a narrow fixture is sufficient for the default bridge check.

## Other owners

Music/schema/mutations: #2/#3. Engine behavior: #6. React states/revision races: #7. MCP protocol/setup: #11. Tool behavior: #12–14. Authentication/RLS: #25–27. Reuse their suites rather than replaying their full matrices in an iframe.

The VexFlow adapter still owns our mapping/layout orchestration; upstream tests do not prove our integration. A tiny real check above remains justified, without retesting every glyph or trusting only mocked bounds.

## When to run

Run with relevant MCP/View/bridge/shared-contract/asset dependency changes and before release; use the same suite in CI. No browser for documentation-only or unrelated pure-domain work. MCP Inspector/basic-host may be used to diagnose SDK upgrades or failures, but are not additional permanent gates when the same boundary is already exercised here.

One narrow actual target-host check is retained for first external release and relevant auth/host/SDK changes: connect/authenticate, show/play, edit, decline then approve save, retrieve. Reuse this evidence for #16/#25/#26 instead of three recipes. The coding agent runs it when it has authorized access; otherwise report the unverified host boundary, not a fictitious pass. Do not require the owner to redo the full functional recipe after every PR.

Completion: three meaningful integration scenarios pass, referenced component/protocol tests pass, no duplicated suite or leaked resources. Initial musical/listening quality and actual host compatibility are not inferred from green protocol tests.
