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
| `view/src/view.css`             | Tailwind CSS v4 entry: shared theme, `@source` of the View and score-ui    |
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
  `<link>`, no network request for code. The styles are Tailwind CSS v4,
  compiled by `@tailwindcss/vite` from `view/src/view.css`, which imports the
  shared `@sheet-music/ui` theme and scans the View's sources and
  `packages/score-ui/src` (DESIGN_SYSTEM.md §4): the player has no
  stylesheet of its own.
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

Size (2026-09-29, after the shadcn/ui migration): `index.html` 1,796.87 kB,
716.43 kB gzip, of which 33.46 kB (7.27 kB gzip) is the inlined CSS. The
same build before the migration was 1,715.85 kB, 689.91 kB gzip (CSS 6.17 kB;
the player's stylesheet then shipped inside the script): +81.0 kB, +26.5 kB
gzip (+3.8 %), about +21 kB gzip of script and +5 kB of CSS. It was about
700 kB before the player. Split of the inlined script, from its source map:
VexFlow 714 kB (about 383 kB of it the embedded Bravura and Academico
fonts), zod 355 kB (contracts, domain validation, ext-apps and SDK schemas),
react-dom 208 kB, stb-vorbis 113 kB and spessasynth_core 87 kB (pulled in by
spessasynth_lib's main-thread entry although decoding runs in the worklet),
MCP SDK 30 kB, renderer-vexflow 29 kB, Radix 29 kB (slider, collection,
switch, slot, label and their hooks), music-domain 28 kB, `cn` 26 kB (class
merging with Tailwind conflict resolution), ext-apps 25 kB, score-ui 14 kB,
the rest under 12 kB each (`packages/ui` 5.6 kB, class-variance-authority
0.6 kB). Out of the document: the worklet 402.59 kB and the SoundFont
9,182.09 kB, both cached immutably. Since 2026-10-02 the same font bytes come
from renderer-vexflow (`src/font-data`, registered from bytes, §4) instead of
VexFlow's `vexflow/bravura` entry: `index.html` 1,797.09 kB (+0.22 kB).

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
  fonts are registered from embedded bytes (§4), and there are no frames,
  images or base URI. The server declares the same origin under ChatGPT's
  `openai/widgetCSP` key too (MCP_SERVER.md §6).
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

| Need                                   | Directive                                        | Why                                                           |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| inline module script and inline styles | `script-src`/`style-src 'unsafe-inline'`         | single-file build, React style attributes                     |
| asset origin                           | `connect-src`, `script-src` (declared)           | SoundFont fetch, worklet module                               |
| WebAssembly in the worklet             | `script-src 'wasm-unsafe-eval'` (or unsafe-eval) | the processor decodes the `.sf3` Ogg Vorbis samples with WASM |

**Fonts need nothing.** The engraving fonts are registered from bytes
embedded in the bundle (`new FontFace(name, ArrayBuffer)`, renderer-vexflow
README "Fonts"), which no `font-src` or `connect-src` governs. Until
2026-10-02 they were VexFlow's `url(data:...)` faces and needed
`font-src data:`; ChatGPT's sandbox does not allow it (below), and every
render there failed: "Notation unavailable", "The notation could not be
drawn." (`RENDER_FAILED`: "Engraving failed: A network error occurred.").
REN-I03 (renderer-vexflow) engraves the three ChatGPT drafts of that failure
under ChatGPT's widget CSP.

Measured on 2026-09-29 with the production build in a cross-origin
`sandbox="allow-scripts allow-same-origin"` iframe, assets from a third
origin through `createViewAssetsRouter`, headless Chromium (manual smoke, not
a committed test): with the basic-host CSP, and with a strict CSP plus
`font-src data:` and `'wasm-unsafe-eval'`, the notation draws (23 noteheads
of the rich fixture), the player reaches Ready, Play starts playback with
the highlight, and teardown answers and unmounts, without console errors.
Without `'wasm-unsafe-eval'` the worklet's decoder cannot instantiate and
sends nothing; the SpessaSynth driver waits at most 15 s
(`DEFAULT_DECODER_START_TIMEOUT_MS`) for its ready report, then fails the
load with `ASSET_LOAD_FAILED`, so the player shows "Audio unavailable" with
Retry instead of staying in Loading (checked in
`spessasynth-engine.mcpui.test.ts` with a processor that never answers).

Measured on 2026-10-02 with the production build in an emulation of
ChatGPT's widget sandbox (below: about:blank iframe written with
`document.write`, ChatGPT's own CSP with the asset origin declared, its
injected styles), headless Chromium (manual smoke): the three ChatGPT drafts
draw (76, 96 and 96 noteheads) in the light and dark themes, Bravura and both
Academico faces are `loaded` and no CSP violation is reported; with the asset
origin served from loopback, the player reaches Ready (light theme). The
previous build showed "Notation unavailable" in the same frame, after three
`font-src` violations on `data:`.

**Release gate.** `McpUiResourceCsp` of ext-apps 1.7.5 has fields for
domains only (`connectDomains`, `resourceDomains`, `frameDomains`,
`baseUriDomains`): the View cannot declare `'wasm-unsafe-eval'`, and a host
that applies the spec's default policy blocks it (audio unavailable after
the timeout; the notation draws). The MCP-UI suite passes because its
sandbox uses basic-host's permissive policy. ChatGPT's policy includes
`'wasm-unsafe-eval'`. The target host (Claude) has not been verified here:
the target-host check of MCP_UI_TEST_PROCESS.md must confirm it before a
release (#16). No View-side change removes the WebAssembly need of the
pinned processor.

### ChatGPT (Apps SDK)

ChatGPT reads the MCP Apps resource (`text/html;profile=mcp-app`,
`_meta.ui.resourceUri`, the `ui/notifications/tool-result` bridge). What its
sandbox does, read from its code on 2026-10-02 (web-sandbox.oaiusercontent.com,
not a documented contract):

- It creates an about:blank iframe (`sandbox="allow-scripts
allow-same-origin allow-forms allow-popups ..."`), writes the resource text
  into it with `document.write`, prepends its own CSS (system font on `html`,
  `body` with `!important`, transparent background) and shows the frame on
  `DOMContentLoaded`.
- When it applies a CSP, it writes it as a `<meta http-equiv>` built from the
  declared domains: `script-src` gets them plus `'unsafe-inline'`,
  `'unsafe-eval'`, `'wasm-unsafe-eval'` and `blob:`; `connect-src`,
  `style-src` and `font-src` get them (plus `*.oaiusercontent.com`);
  `img-src` allows `data:`. `font-src data:` is reserved to OpenAI's own
  apps: never count on it.
- In developer mode the widget may carry a "CSP off" badge ("CSP
  désactivée"): third-party reports say a developer-mode app gets no policy
  unless "enforce CSP" is on, and a published app always gets one. The
  2026-10-02 failure happened with that badge shown; whatever the account
  setting was, the published app gets the policy, and the View now works
  under it in the emulation. The badge is not explained: in Chromium the old
  build fails only under a policy (without one, the three faces load), so
  either the badge did not mean "no policy" or the owner's browser engine
  differs (WebKit: Safari, the ChatGPT macOS app). Not verified yet in
  ChatGPT itself or in WebKit (only Chromium is installed for Playwright
  here): after deploying, open one score in ChatGPT web, and in the macOS
  app if it is used; a WebKit run of REN-I03 needs Playwright's WebKit
  build first.
- The View's console is not forwarded to the conversation: a render failure
  shows only in the DevTools of the widget frame (the player's alert says
  "The notation could not be drawn.").
- The server declares the asset origin under `_meta.ui.csp` and
  `_meta['openai/widgetCSP']` (MCP_SERVER.md §6). Before submitting the app,
  ChatGPT also requires a dedicated widget domain (`openai/widgetDomain`), not
  set yet.

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
  document (ext-apps `applyDocumentTheme`), the `.light` / `.dark` class
  that selects the design tokens (`applyThemeClass`, host-bridge.ts), and
  the player theme (ScorePlayer maps it to its RenderTheme and its paper,
  and carries the same class). Until the host sends one, the system
  preference is used, from the first script line; before the script runs,
  `view.css` keeps `color-scheme: light dark`, so the frame's scheme matches
  the host's and the browser paints no opaque backdrop. Host style
  variables and fonts are applied to the root; the host's `--font-sans`
  reaches the components, while its `--font-weight-*` and `--shadow-*`
  cannot restyle them (pinned in the theme, DESIGN_SYSTEM.md §1.2). Text
  drawn straight on the host background (title, meta, credits) prefers the
  host's `--color-text-*` variables.
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
| `[role="group"][aria-label="Playback controls"]`                                  | Play/Pause (the only `button` without a role), `Tempo` and `Loop` below                                  |
| `[role="slider"]` in the controls, named `Tempo`                                  | the Radix slider's thumb: `aria-valuetext`, `aria-valuenow` (25-200, step 5), `aria-disabled`            |
| `[role="switch"]` in the controls, named `Loop`                                   | a `button`: `aria-checked`, `disabled`; its `Label` toggles it too                                       |
| player `[role="status"]`                                                          | `Loading`, `Ready`, `Playing`, `Paused`, `Audio unavailable`, `Notation unavailable`                     |
| player `[role="alert"]`                                                           | player problems, `Retry audio` button                                                                    |
| player `[data-player-viewport]`                                                   | the notation's scroll container; its parent is the paper                                                 |
| `[data-testid="sound-credits"]`                                                   | attribution and license link                                                                             |
| `html[data-theme]`, `html.light` / `html.dark`                                    | theme applied from the host context (the class selects the design tokens)                                |

Tests select roles, names and data attributes, never classes. The one
exception is deliberate: MCP-UI-01 reads computed styles (the Play button
and controls bar backgrounds, the Play button's 1 px border that forced
colors paints, the paper's inset edge) of elements found through the hooks
above, and MCP-UI-03 checks that the controls bar changes color and the
document's `.light` / `.dark` class changes with the host theme. An unstyled player passes every role check, and
a broken `@source` in `view.css` builds without error; these fail instead.

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
| View doc    | `apps/mcp/src/view-resource.test.ts`                                        | origin injection, unchanged without origin, http non-loopback and missing placeholder rejected; prepared once with the CSP under `ui.csp` and `openai/widgetCSP`, and a build without the placeholder fails `createMcpApp`                                   |
| Assets      | `apps/mcp/src/static-assets.int.test.ts`                                    | on a real View build over HTTP: the worklet path the View requests and the SoundFont files with type, CORS, cache headers and bytes; 404 for traversal, unpublished files, directories, other methods; startup check                                         |
| MCP-P01     | `apps/mcp/test/mcp-p01-setup-discovery.int.test.ts`                         | the resource read returns the build with the injected origin and the CSP (`ui.csp`, `openai/widgetCSP`)                                                                                                                                                      |

Not here, by design: the player's states and P-01 races (score-ui UI-01..05),
engraving (REN-01..05, REN-I01..03; REN-I03 under ChatGPT's widget CSP), the
engine (AUDIO-01..07 and its Chromium check), and the real iframe, CSP and
bundle (MCP-UI-01..03).
