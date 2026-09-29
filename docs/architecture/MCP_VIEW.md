# MCP Apps View

The View of issue #11: the React page an MCP Apps host renders in a sandboxed
iframe for the results of `create_score`, `edit_score` and `get_score`. It
mounts the shared ScorePlayer (`packages/score-ui`, #7) with the real VexFlow
renderer (#5) and SpessaSynth engine (#6, SoundFont #23). The server side of
the resource and the tools is [MCP_SERVER.md](MCP_SERVER.md); the port
contracts are [RENDER_PLAYBACK_PORTS.md](RENDER_PLAYBACK_PORTS.md). Pinned:
`@modelcontextprotocol/ext-apps` 1.7.5 (MCP Apps spec 2026-01-26).

| Path                            | Role                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| `apps/mcp/view/index.html`      | document shell, host style fallbacks, the asset-origin placeholder         |
| `view/src/main.tsx`             | composition root: App, store, ports, `PlayerMount` (ScorePlayer + credits) |
| `view/src/host-bridge.ts`       | ext-apps `App` wiring: tool results, host context, size, teardown          |
| `view/src/tool-result.ts`       | MCP-U01 parser: only a valid artifact reaches the player                   |
| `view/src/view-state.ts`        | last valid artifact, notice, connection, theme                             |
| `view/src/ScoreView.tsx`        | shell UI, notices, the score mount slot                                    |
| `view/src/asset-origin.ts`      | reads the asset origin the server injected                                 |
| `view/src/player-ports.ts`      | the concrete ScorePlayer ports and the playback asset URLs                 |
| `view/src/SoundCredits.tsx`     | the SoundFont attribution and license link                                 |
| `apps/mcp/vite.view.config.ts`  | single-file build plus the `assets/` directory                             |
| `apps/mcp/src/view-resource.ts` | the `ui://` resource: document with the injected origin, CSP metadata      |
| `apps/mcp/src/static-assets.ts` | `createViewAssetsRouter(dir)`: `/assets/*` on the server's origin          |

## 1. Build

`pnpm --filter @sheet-music/mcp build` (View first) writes:

- `dist/view/index.html`: one self-contained document. Every script and style
  is inlined (`vite-plugin-singlefile`, its recommended config replaced by
  the equivalent explicit options so one asset can stay out); no `src`, no
  `<link>`, no network request for code.
- `dist/view/assets/`: what the View must load by URL, served by the MCP
  server at `/assets/` (§3):
  - `spessasynth_processor.min-<hash>.js`, the pinned spessasynth_lib 4.3.14
    worklet processor, byte for byte. An AudioWorklet module can only be
    loaded by URL, so `build.assetsInlineLimit` inlines every asset except
    this one. The View gets its root-relative path through playback-spessasynth's
    `SPESSASYNTH_PROCESSOR_URL` (`base: '/'`).
  - `soundfonts/piano/ms-basic-grand-piano.sf3`, `LICENSE.txt`, `NOTICE.txt`,
    copied with unchanged names (names read from the asset manifest), as
    [SOUNDFONT.md](../assets/SOUNDFONT.md) §6 requires.

The build fails when `index.html` lost the asset-origin placeholder or when
the worklet was not emitted exactly once (`checkViewBuild` plugin), and when
the `.sf3` does not match the manifest's size and SHA-256
(`publishPianoSoundFont`, the same check as the web build).

Size (2026-09-29): `index.html` 1,692.20 kB, 683.42 kB gzip (it was about
700 kB before the player). Split of the inlined script, from its source map:
VexFlow 697 kB (about 383 kB of it the embedded Bravura and Academico
fonts), zod 350 kB (contracts, domain validation, ext-apps and SDK schemas),
react-dom 203 kB, stb-vorbis 110 kB and spessasynth_core 85 kB (pulled in by
spessasynth_lib's main-thread entry although decoding runs in the worklet),
MCP SDK 30 kB, music-domain 27 kB, renderer-vexflow 26 kB, ext-apps 25 kB, the
rest under 12 kB each. Out of the document: the worklet 402.59 kB and the
SoundFont 9,182.09 kB, both cached immutably.

## 2. Resource and asset origin

The build serves every deployment, and the host renders the View from its own
sandbox origin, so the View cannot know where the assets live. The server
tells it at `resources/read` time:

- `view/index.html` holds `<meta name="sheet-music-asset-origin" content="" />`.
- `viewDocument(config)` (view-resource.ts) writes the configured asset
  origin into that placeholder. Production passes the origin of
  `MCP_PUBLIC_URL` (the server's own origin, which serves `/assets/`); it must
  be https, or http on a loopback host (`assetOriginOf`). Without an origin
  the document is served unchanged; an origin with a document lacking the
  placeholder is an error. `createMcpApp` runs it once at startup
  (`prepareScoreView`), so such a build stops the process before it listens,
  and every read serves the prepared string.
- The same origin is the resource's `_meta.ui.csp`: `connectDomains` (the
  SoundFont `fetch`, `connect-src`) and `resourceDomains` (the worklet module,
  which the browser loads under `script-src`). Nothing else is declared:
  fonts are embedded (§4), and there are no frames, images or base URI.
- `readAssetOrigin(document)` (view side) accepts only an http(s) URL and
  keeps its origin; anything else is "no origin".

Rejected alternatives: passing the origin in tool-result `_meta` (the View
could not start before the first result, and every tool would carry
deployment data); a build-time constant (one build per deployment).

Without an origin the notation still works, and the engine factory returns
an engine whose loads fail at once with `ASSET_LOAD_FAILED` ("Audio is
unavailable"), with no request and no AudioContext.

## 3. Assets route

`createViewAssetsRouter(directory)` returns an Express router that answers
only `/assets/*`; the composition root mounts it at the app root with
`directory = <dir of the View HTML>/assets` (main.ts). It throws at startup
when the directory is missing.

- Files: exactly the build's `assets/` directory; extensions `.js`
  (`text/javascript; charset=utf-8`), `.sf3` (`application/octet-stream`),
  `.txt` (`text/plain; charset=utf-8`). Anything else, a directory, a
  traversal (plain or encoded), a dotfile or a method other than GET/HEAD is
  a plain-text `404 Not found`, without redirect.
- Headers: `Cache-Control: public, max-age=31536000, immutable` (the worklet
  name is content-hashed, the SoundFont content is fixed by its SHA-256),
  `Access-Control-Allow-Origin: *` (the View requests from the host's sandbox
  origin in CORS mode: `fetch` and the module-script request of
  `audioWorklet.addModule`; no credentials), CORP `cross-origin`,
  `nosniff`, ETag and ranges from `express.static`.
- No Origin policy, authentication or body cap: the route reads no body and
  serves only public build output. Bandwidth: every View instance may fetch
  the 9 MB SoundFont once per browser cache partition; put a CDN in front in
  production (#16).

## 4. What the host's CSP must allow

What hosts put in the iframe CSP beyond the declared domains is host-specific.
The spec's default (no metadata) is `default-src 'none'; script-src 'self'
'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
media-src 'self' data:; connect-src 'none'`; the reference `basic-host` of
ext-apps adds the declared domains plus `'unsafe-eval' blob: data:` to
`script-src` and `data: blob:` to `font-src`. The View needs:

| Need                                   | Directive                                        | Why                                                              |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| inline module script and inline styles | `script-src`/`style-src 'unsafe-inline'`         | single-file build, React style attributes                        |
| asset origin                           | `connect-src`, `script-src` (declared)           | SoundFont fetch, worklet module                                  |
| `data:` fonts                          | `font-src data:`                                 | VexFlow's embedded fonts (`new FontFace(name, 'url(data:...)')`) |
| WebAssembly in the worklet             | `script-src 'wasm-unsafe-eval'` (or unsafe-eval) | the processor decodes the `.sf3` Ogg Vorbis samples with WASM    |

Measured on 2026-09-29 with the production build in a cross-origin
`sandbox="allow-scripts allow-same-origin"` iframe, assets from a third
origin through `createViewAssetsRouter`, headless Chromium (manual smoke, not
a committed test): with the basic-host CSP, and with a strict CSP plus
`font-src data:` and `'wasm-unsafe-eval'`, the notation draws (23 noteheads
of the rich fixture), the player reaches Ready, Play starts playback with
the highlight, and teardown answers and unmounts, without console errors.
With `font-src` limited to the asset origin every render fails ("The
notation could not be drawn."). Without `'wasm-unsafe-eval'` the worklet's
decoder cannot instantiate and sends nothing; the SpessaSynth driver waits
at most 15 s (`DEFAULT_DECODER_START_TIMEOUT_MS`) for its ready report, then
fails the load with `ASSET_LOAD_FAILED`, so the player shows "Audio
unavailable" with Retry instead of staying in Loading (checked in
`spessasynth-engine.mcpui.test.ts` with a processor that never answers).

**Release gate.** `McpUiResourceCsp` of ext-apps 1.7.5 has fields for
domains only (`connectDomains`, `resourceDomains`, `frameDomains`,
`baseUriDomains`): the View cannot declare `font-src data:` or
`'wasm-unsafe-eval'`, and a host that applies the spec's default policy
blocks both (no notation; audio unavailable after the timeout). The MCP-UI
suite passes because its sandbox uses basic-host's permissive policy. The
target host (Claude) has not been verified here: the target-host check of
MCP_UI_TEST_PROCESS.md must confirm both directives before a release (#16).
If the target host lacks `font-src data:`, the fix is to register the fonts
from bytes (`new FontFace(name, arrayBuffer)` is not subject to `font-src`)
or serve them from the asset origin, in renderer-vexflow (#5). The embedded
font data is internal to the pinned `vexflow` package (its `exports` map
does not publish it) and its font licenses are not in the npm package, so
that change needs the font files and their OFL notices vendored first. No
View-side change removes the WebAssembly need of the pinned processor.

## 5. Behavior

- **Boot.** The App (`autoResize: false`) registers its listeners, then
  connects. The first valid artifact of a `toolresult` mounts `PlayerMount`
  (ScorePlayer + sound credits), keyed by score ID. The player validates the
  artifact again (score-ui), renders and loads the engine (AudioContext
  created suspended), and never plays by itself.
- **Revisions.** A higher revision of the same score reaches the same
  mounted player, which applies P-01 (stop, load at tick 0, stay paused);
  duplicates, stale revisions and other score IDs are ignored before the
  player (view-state, MCP-U01).
- **Errors.** A rejected call (`isError`, the server envelope), an unreadable
  result or a cancellation shows a notice (`role="alert"`) and keeps the last
  valid score and its audio. Text is rendered as React text only. A
  rejection reads `The request was rejected: <envelope message>` followed by
  up to three detail messages (a `Details` list); the error code is the
  notice's `data-error-code`, not part of its text. The player's own
  problems (invalid update, render or audio failure) are in its
  `role="alert"`.
- **Audio.** Only the user's Play starts output: score-ui calls `play()` in
  the click handler and the engine resumes its AudioContext there.
- **Theme.** The host context `theme` sets `data-theme`/`color-scheme` on the
  document and the player theme (ScorePlayer maps it to its RenderTheme);
  until the host sends one, the system preference is used. Host style
  variables and fonts are applied to the root.
- **Width.** `containerDimensions` sets the root's width or max width; the
  player follows its container through its own ResizeObserver and re-renders.
  The root has 16 px side padding, 8 px when the frame is 400 px wide or
  less; notation wider than that scrolls sideways with a fade cue
  (DESIGN_SYSTEM.md §4).
- **Layout.** Title, tags and state, then the player with its controls
  above the notation (`controlsPosition="top"`): the host grows the frame
  to the View's height, so Play is never below the fold. Sound credits last.
  Size changes are reported to the host (`ui/notifications/size-changed`).
- **Credits.** The SoundFont `attribution` and a link to the published
  `LICENSE.txt`, opened through the host (`ui/open-link`).
- **Teardown** (`ui/resource-teardown`): the score is unmounted
  synchronously (`flushSync`), so the player's engine is destroyed (silence,
  AudioContext closed) and its renderer released before the host receives
  the answer; the tool-result, cancellation and host-context listeners and
  the size observer are removed. The View keeps its transport open so the
  answer is posted; the host closes the bridge when it removes the iframe.

## 6. Hooks for the MCP-UI suite

Stable selectors (no CSS classes):

| Hook                                                                              | Meaning                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `[data-testid="score-view"][data-connection]`                                     | `connecting`, `connected` (handshake done), `failed`, `closed` (after teardown)                          |
| `[data-testid="score-mount"]` `data-score-id`, `data-revision`, `data-theme`      | the accepted artifact and the theme given to the player; absent before a valid result and after teardown |
| `[data-testid="view-notice"][role="alert"]` `data-notice-kind`, `data-error-code` | `rejected` (with the envelope code, e.g. `SCORE_VALIDATION_FAILED`), `unreadable`, `cancelled`           |
| `section[aria-label^="Score player"]`                                             | the ScorePlayer (`Score player: <title>`)                                                                |
| `[role="img"][aria-label^="Music notation"] svg`                                  | the notation; notehead groups carry `data-note-id` (also `data-harmony-id`, `data-pedal-id`...)          |
| `svg [data-note-id] [style*="fill"]`                                              | noteheads currently highlighted by playback                                                              |
| `[role="group"][aria-label="Playback controls"]`                                  | button `Play`/`Pause`, slider `Tempo` (`aria-valuetext`), checkbox `Loop`                                |
| player `[role="status"]`                                                          | `Loading`, `Ready`, `Playing`, `Paused`, `Audio unavailable`, `Notation unavailable`                     |
| player `[role="alert"]`                                                           | player problems, `Retry audio` button                                                                    |
| `[data-testid="sound-credits"]`                                                   | attribution and license link                                                                             |
| `html[data-theme]`                                                                | theme applied from the host context                                                                      |

To host it: run the MCP server with `MCP_PUBLIC_URL` on its loopback origin,
read `ui://sheet-music/score-view`, and load the returned text in a sandboxed
iframe whose CSP is built from `_meta.ui.csp` as §4 requires (the basic-host
construction works). Engine state is not exposed beyond the status text;
sound itself is measured by the playback-spessasynth check.

## 7. Tests

| Test        | File                                                                        | Covers                                                                                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP-U01     | `apps/mcp/view/test/mcp-u01-view-payload.test.ts`, `...score-view.test.tsx` | parser acceptance/rejection, which result is shown, notices, mount only after validation                                                                                                                                                                     |
| View wiring | `apps/mcp/view/test/mcp-view-wiring.test.tsx`                               | real `App` + official `AppBridge` over an in-memory transport: host theme to the player and its change, newer revision to the same player instance, teardown order and listener removal; asset-origin parsing; engine without origin fails without a request |
| View doc    | `apps/mcp/src/view-resource.test.ts`                                        | origin injection, unchanged without origin, http non-loopback and missing placeholder rejected; prepared once, and a build without the placeholder fails `createMcpApp`                                                                                      |
| Assets      | `apps/mcp/src/static-assets.int.test.ts`                                    | on a real View build over HTTP: the worklet path the View requests and the SoundFont files with type, CORS, cache headers and bytes; 404 for traversal, unpublished files, directories, other methods; startup check                                         |
| MCP-P01     | `apps/mcp/test/mcp-p01-setup-discovery.int.test.ts`                         | the resource read returns the build with the injected origin and the CSP                                                                                                                                                                                     |

Not here, by design: the player's states and P-01 races (score-ui UI-01..05),
engraving (REN-01..03, REN-I01), the engine (AUDIO-01..07 and its Chromium
check), and the real iframe, CSP and bundle (MCP-UI-01..03).
