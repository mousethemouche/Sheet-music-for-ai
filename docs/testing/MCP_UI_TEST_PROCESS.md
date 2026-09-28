# MCP + UI automated test process

Status: required implementation/testing procedure for MVP v1.

## Goal

A coding agent must be able to implement or modify the MCP + MCP Apps UI and prove that it still works without requiring the product owner to manually perform a full acceptance recipe after every change.

The test process must separate:

1. MCP server/protocol correctness;
2. View/component correctness;
3. MCP Apps host <-> iframe bridge correctness;
4. product behavior;
5. real third-party-host compatibility.

A green test at one layer must not be presented as proof of another layer.

## Official references

MCP Apps officially recommends testing with the reference `basic-host`, which renders the App View inside a sandboxed iframe and exposes Tool Input, Tool Result, Messages and Model Context for debugging.

The MCP server itself can also be inspected with MCP Inspector.

Our automated suite should not depend only on either interactive tool. Instead, it reproduces the same protocol boundaries programmatically, using the official MCP client and MCP Apps `AppBridge`.

## Architecture of the test harness

```text
                         TEST PROCESS

     ┌─────────────────────────────────────────────┐
     │ 1. Vitest MCP protocol / application tests │
     │ Node only — no browser                     │
     └──────────────────────┬──────────────────────┘
                            │
                            v
               real loopback HTTP /mcp
                            │
                            v
     ┌─────────────────────────────────────────────┐
     │ 2. MCP test client                          │
     │ initialize / tools / resources / auth      │
     └──────────────────────┬──────────────────────┘
                            │
                            v
     ┌─────────────────────────────────────────────┐
     │ 3. Local MCP Apps test host                 │
     │ official AppBridge + actual iframe          │
     └──────────────────────┬──────────────────────┘
                            │ postMessage
                            v
     ┌─────────────────────────────────────────────┐
     │ 4. Real Score View                          │
     │ actual bundled React View                   │
     └─────────────────────────────────────────────┘

Pre-release only:
     official basic-host smoke + target-host smoke
```

## Layer 1 — View component tests, no browser required

Runtime: Vitest + Testing Library + jsdom.

Test the View as an ordinary React application behind neutral adapters.

Required coverage:

- valid canonical score result renders the ScorePlayer;
- loading/error/empty states;
- play/pause/tempo/loop controls;
- incoming revision replacement policy;
- stale revision ignored;
- annotation color conflict rejected before render;
- theme/host-context mapping;
- cleanup/unmount;
- renderer/playback failures;
- no direct VexFlow or SpessaSynth imports in View-level product logic.

Use fakes for:

- ScoreRenderer;
- PlaybackEngine;
- MCP host bridge wrapper;
- ResizeObserver/layout measurements where necessary.

This layer is cheap and should run on every local test invocation.

## Layer 2 — MCP server integration, no UI/browser required

Runtime: Vitest + the pinned official MCP client/server SDK over loopback Streamable HTTP.

Boot the real `apps/mcp` composition root and exercise the actual transport.

Required protocol tests:

- initialize;
- notifications/initialized;
- ping;
- tools/list;
- tools/call;
- resources/list;
- resources/read;
- protocol-version handling;
- malformed JSON-RPC;
- unsupported methods;
- authentication challenge;
- allowed/disallowed Origin behavior.

Required product tool tests:

- create_score;
- edit_score;
- save_score;
- get_score;
- search_scores.

Each tool must be tested with:

- representative success;
- invalid schema;
- valid schema but invalid domain state;
- missing/expired/invalid auth;
- cross-user access attempt where applicable;
- datastore failure;
- exact serialized success/error shape;
- persisted postconditions.

Directly calling a handler does not count as the integration test.

## Layer 3 — Automated MCP Apps host test

This is the key piece that removes most manual recipe work.

Create a tiny internal test host, for example:

```text
tests/mcp-app-host/
```

or a dedicated test helper package.

It MUST use the official:

```text
@modelcontextprotocol/ext-apps/app-bridge
```

rather than inventing our own host protocol.

The host should:

1. connect a real MCP client to the loopback MCP server;
2. call/list the real tool;
3. fetch the real `ui://` resource;
4. create a sandboxed iframe containing the actual bundled View;
5. wire the official `AppBridge` to that iframe;
6. forward the real tool input/result into the View;
7. expose deterministic inspection hooks ONLY in test code.

The production View must not contain special test behavior.

## Layer 4 — Minimal real-browser host tests

Iframe + postMessage behavior should be tested in a real browser because jsdom is not a browser host.

Keep this suite deliberately tiny.

Recommended runtime:

- one headless Chromium worker;
- no video;
- trace on failure only;
- no broad screenshot matrix;
- no paid LLM call.

The browser launches only the local test host, not ChatGPT.

### HOST-01 — App initialization

Given the MCP server and test host are running:

- iframe is created;
- sandbox configuration is present;
- View loads without uncaught exception;
- Apps initialization handshake completes;
- host capabilities/context arrive;
- no duplicate initialization under remount.

### HOST-02 — Tool input/result flow

Call `create_score` through the actual MCP client.

Assert:

- host receives the actual tool result;
- corresponding View receives the expected tool input/result;
- ScorePlayer receives correct scoreId/revision;
- no second fake data path exists.

### HOST-03 — Revision update

While the View holds revision N, call `edit_score`.

Assert:

- actual revision N+1 reaches the View;
- logical score ID unchanged;
- old result arriving later cannot overwrite N+1;
- P-01 behavior is followed: previous playback stops, new plan loads at tick 0, UI remains paused.

### HOST-04 — Error does not corrupt View

Submit an edit with a contradictory annotation color.

Assert:

- actual MCP tool result is an error;
- View preserves last valid score;
- renderer never receives invalid conflicting ScoreSpec;
- no new revision is displayed.

### HOST-05 — Host context

Send supported host changes through AppBridge:

- theme;
- size/context values used by the View.

Assert View updates presentation without mutating score identity/music state.

### HOST-06 — View-to-host request path

If the View uses any app-initiated MCP call or host action in MVP, execute it through the real bridge and assert:

```text
View -> AppBridge -> MCP client -> server -> result -> View
```

Do not create a test for an app-initiated action that the product does not use.

### HOST-07 — Resource/build integrity

Use production-built View assets.

Assert:

- resource MIME/content is correct;
- all referenced JS/CSS/fonts/assets load;
- CSP allows only required resources;
- no auth/server secret appears in the resource or browser bundle;
- no localhost-only asset URL survives production build.

### HOST-08 — teardown

Destroy the View/host and assert:

- iframe removed;
- AppBridge disconnected;
- listeners removed;
- renderer/playback resources destroyed;
- no later message mutates unmounted state;
- no open handles keep the test process alive.

## Assertions: prefer semantics over screenshots

The host suite should inspect:

- tool result;
- parsed scoreId/revision;
- rendered component state;
- bridge lifecycle;
- DOM presence of meaningful labels/controls;
- calls into renderer/playback ports;
- errors;
- cleanup.

Do NOT use screenshots as the primary correctness oracle.

A screenshot can be attached as a diagnostic when a real-render smoke fails, but pixel equality is not the core contract.

VexFlow itself owns its engraving internals. We test our semantic mapping and small actual-library integration, not the geometry of every glyph.

## Layer 5 — Reference-host smoke

The official MCP Apps documentation provides `examples/basic-host` as the reference host.

Keep a script/checklist such as:

```text
pnpm test:mcp-ui:reference
```

that:

1. starts our MCP server;
2. starts a pinned/reference-compatible basic-host;
3. points it at the local server;
4. exercises at least create_score;
5. verifies the UI resource renders and no host/View console errors occur.

This can be a pre-release or dependency-upgrade smoke rather than every-commit CI.

It exists to detect divergence between our internal test host and the official reference implementation.

MCP Inspector is useful for diagnosis of server tools/results, but an interactive Inspector session is not a substitute for automated tests.

## Layer 6 — Target-host smoke

No local harness can prove every host-specific behavior.

Before a release intended for testers, run a very small target-host compatibility smoke in the actual host(s), initially ChatGPT Developer Mode if that is a supported target.

The smoke is intentionally small:

1. connect/authenticate the MCP;
2. ask for one score;
3. verify inline View appears;
4. play it;
5. request one edit;
6. verify same artifact updates and stays paused per P-01;
7. decline save and verify no saved item;
8. explicitly approve save;
9. retrieve the score.

This is NOT the normal developer recipe.

It is a release compatibility check for a third-party host boundary.

If the coding agent has browser/computer access to the target host, it should execute and record this smoke. Otherwise this is the only residual human-host check; all product/server/UI logic must already be covered automatically before reaching it.

## basic-host / target-host evidence

For reference-host and target-host smoke runs, record:

- app version/commit SHA;
- MCP Apps/ext-apps version;
- target host and version/date when relevant;
- tool inputs used;
- pass/fail per smoke step;
- console errors, if any;
- sanitized logs only.

Never record access tokens or private user data.

## CI policy

Every PR touching any of:

```text
apps/mcp/**
packages/score-ui/**
music-contracts affecting MCP result shape
MCP Apps/ext-apps dependency
UI resource bundling
```

must run:

1. View/component tests;
2. MCP protocol/tool integration tests;
3. local AppBridge host tests.

The minimal real-browser host suite may run in a dedicated bounded CI job with one Chromium worker.

Dependency upgrades of the MCP SDK or MCP Apps SDK additionally require the reference-host smoke before merge/release.

## Definition of Done for an MCP UI feature

An MCP + UI change is not done until:

- unit/component tests pass;
- actual MCP transport tests pass;
- actual tool/resource schemas pass;
- AppBridge host test passes with the production View bundle;
- invalid/error/stale-result behavior is covered;
- teardown has no leaked resources;
- auth/ownership integration passes where relevant;
- no new MCP tool/resource is missing from the endpoint inventory;
- reference-host smoke passes when protocol/UI SDK versions change.

A product owner should not need to manually click through these behaviors after every coding iteration.
