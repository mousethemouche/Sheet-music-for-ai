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

One narrow actual target-host check is retained for first external release and relevant auth/host/SDK changes: connect/authenticate, show/play, edit, decline then approve save, retrieve. It is also the release gate for the host iframe CSP: the View needs `script-src 'wasm-unsafe-eval'` (the worklet's decoder), which the resource metadata of ext-apps 1.7.5 cannot declare, and no font directive (the engraving fonts are registered from bundled bytes since 2026-10-02, MCP_VIEW.md §4); the notation must draw and Play must sound on the target host. Reuse this evidence for #16/#25/#26 instead of three recipes. The coding agent runs it when it has authorized access; otherwise report the unverified host boundary, not a fictitious pass. Do not require the owner to redo the full functional recipe after every PR.

Completion: three meaningful integration scenarios pass, referenced component/protocol tests pass, no duplicated suite or leaked resources. Initial musical/listening quality and actual host compatibility are not inferred from green protocol tests.

## Implementation

Added 2026-09-29 (#11). The three scenarios are implemented, as 16 named steps, in `apps/mcp/test/mcp-ui/mcp-ui.mcpui.test.ts`.

Run it after building the View. The suite reads the production build from `apps/mcp/dist/view`:

```sh
pnpm --filter @sheet-music/mcp build
TEST_DATABASE_URL=postgres://user@localhost:5432/sheet_music_test_mcpui \
  ./node_modules/.bin/vitest run --project mcp-ui apps/mcp
```

`pnpm test:mcp-ui` runs the suite together with the other Chromium checks. `TEST_DATABASE_URL` names the Postgres server, with the same default as the `integration` project. The suite always recreates the database `sheet_music_test_mcpui` on that server.

### One harness

The test body runs in Chromium, and the test page is the host page. Node work goes through one Vitest browser command, `mcpUi`, registered on the `mcp-ui` project in `vitest.config.ts`. On first use, the command loads `harness-server.ts` through the project's module runner. The config imports nothing from the test folder.

| File (`apps/mcp/test/mcp-ui/`) | Role |
| --- | --- |
| `harness-server.ts` | Node side. Creates the test database with users A and B, and a local test issuer on loopback. Runs the production `createMcpApp` wired as `main.ts` wires it: request protection, rate limits, bearer guard, tools, use cases and Postgres stores. It serves the production-built View and runs the production `createViewAssetsRouter` on its `assets/` directory. `MCP_PUBLIC_URL` is the real loopback URL. The host page origin is the only allowed browser origin. Also starts the sandbox origin. It records asset requests, the sandbox CSP, the server's warning and error events, and page errors. It reads and clicks inside the View frame through Playwright. |
| `sandbox-proxy.ts` | The sandbox proxy, adapted from the pinned reference host (ext-apps 1.7.5 `examples/basic-host`). It builds the CSP header from the resource's `_meta.ui.csp`, which the host passes as `?csp=`, using basic-host's `buildCspHeader`. It writes the View into an inner `allow-scripts allow-same-origin` iframe and relays JSON-RPC between the host and the View. When it relays the View's answer to `ui/resource-teardown`, it first records whether the score mount and the player are still in the View and the state of every tapped AudioContext (`teardownAnswer` of the snapshot). |
| `host.ts` | The minimal host. The pinned SDK client runs in the page with the test token, over Streamable HTTP, and discovers the tools and the resource. It calls `resources/read`, then connects the official `AppBridge` over `PostMessageTransport` to the proxy, sends `sendSandboxResourceReady`, and relays tool input and results. It records sanitized bridge events: methods, IDs and revisions only, never a token or a score. |
| `view-probe.ts` | Reads the View's semantic state inside its frame, using only the MCP_VIEW.md §6 hooks: test IDs, ARIA roles and labels, and notation `data-*` attributes. |
| `protocol.ts` | Types shared by both sides, and the typing of the `mcpUi` command. |

Why a command is needed:

- The servers need Node.
- The View is cross-origin to the host page, so neither the page nor Vitest's `expect.element` can read it. Playwright can.

Relay order follows basic-host:

- After `ui/notifications/initialized`, the create call sends its complete input, then its real result.
- A later result for the same View sends the result only, because tool input is sent once per View.

Sound is measured only as a peak level:

- Before writing the View, the proxy wraps the inner window's `AudioNode.prototype.connect`. This is test-host instrumentation, the same spy as the playback-spessasynth Chromium check.
- A node connected to the destination also feeds an `AnalyserNode`.
- The probe reports that node's `AudioContext.state` and its output peak.
- The thresholds are that check's own: audible above 0.005, silent below 0.0005.

### What each scenario proves

- **MCP-UI-01**
  - Discovery: `create_score` links `ui://sheet-music/score-view`. `resources/read` returns the MCP App MIME type, the server's origin injected into the document, and that origin as `connectDomains` and `resourceDomains`.
  - Isolation: the sandbox is cross-origin, and its CSP is the one built from that metadata.
  - Handshake: the View reports `sheet-music-score-view`. The View shows the created score ID at revision 1 in the host's light theme. The player shows the title, is Ready, and has enabled Play, Tempo and Loop controls.
  - Assets: Bravura and Academico are loaded from the embedded fonts. The worklet and the SoundFont are served 200 by the declared asset origin to the sandbox origin.
  - Errors: no page error, no View console error, and no server warning or error.
  - Notation: every written note of the rich fixture has one notehead with its note ID. Chord symbols, Roman numerals, scale degrees and annotation texts are visible.
  - Playback: the View stays Ready and silent until a real click. It then plays, its AudioContext runs, highlights move through the score's notes and the level is audible. Pause gives Paused and silence.
  - Return path: the license link reaches the host as `ui/open-link` with the published `LICENSE.txt`. This is the View's only app-initiated request.
- **MCP-UI-02**
  - Revision 1 is playing in a loop.
  - A real `edit_score` result (same ID, revision 2) goes through `sendToolResult`. The pickup becomes a bar of two new note IDs.
  - The first revision-2 state is not Playing. The level falls to silence. The View becomes Ready with the new noteheads and no highlight, and one second later it is still Ready and silent, although loop is on.
  - An explicit Play highlights exactly the two new tick-0 notes, and the level is audible.
- **MCP-UI-03**
  - A real P-03 conflict (a second teaching color on the pink chord member) returns `SCORE_VALIDATION_FAILED` with `ANNOTATION_COLOR_CONFLICT`.
  - Relayed to the View, it shows the `rejected` notice with that code. Revision 1 and its noteheads stay, and the View still plays and pauses.
  - Host context change to dark at width 420: the document and the player switch to dark. The root becomes 420 px and the notation 388 px (the root's 16 px side padding). The View reports its new size.
  - Teardown (control first: a resized frame is reported while connected): when the proxy relays the answer, the score mount and the player are already gone and every AudioContext is `closed` (a release deferred by 50 ms after the answer fails this step). Afterwards, a theme change, a tool result and a frame resize change nothing, and no size notification arrives.
  - Closing the bridge fires its `onclose`, and a later send rejects. The View frame is removed.

Each scenario opens its own score, View and bridge in `beforeAll` and closes them in `afterAll`. Each also passes alone (`-t MCP-UI-0x`). Only the servers, the database and the sandbox origin are shared across the file.

### Reuse and limits

- MCP-UI-01 hosts the minimal real VexFlow, synth and asset smoke in the production bundle. `packages/renderer-vexflow/test/ren-i01-vexflow.mcpui.test.ts` (REN-I01) still owns geometry, colors, resize, short pedals and four voices. `packages/playback-spessasynth/test/spessasynth-engine.mcpui.test.ts` still owns asset error mapping and resource release at adapter level. Both files are kept; their owners may trim what now overlaps (labels and IDs; load, play and stop).
- Mutation check. With `'unsafe-eval'` removed from the sandbox `script-src`, the worklet cannot decode the SoundFont. The player never reaches Ready (after the driver's 15 s decoder timeout it shows Audio unavailable) and MCP-UI-01 fails. The suite therefore catches a host CSP that blocks the View's WASM. The Claude target host is not verified by this suite; the release target-host check below remains.
- The host's SDK client tries its optional GET stream on `/mcp`. It gets 405, which Chromium logs in the host frame. This is expected, and it is not a View error.
