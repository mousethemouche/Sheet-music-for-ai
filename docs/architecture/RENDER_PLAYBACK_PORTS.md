# Rendering and playback ports

The neutral contracts of [ADR-004](ADR-004-rendering-playback-boundaries.md),
fixed before the VexFlow adapter (#5), the playback compiler and SpessaSynth
adapter (#6) and the React ScorePlayer (#7) are built in parallel. ADR-004
remains the decision record; this page fixes what its sketch leaves open. It
extends that sketch (render options, `resize`, a separate playback highlight
call) and the ADR-001 `LayoutMap` sketch (a `Map` instead of a `Record`,
because `constructor` is a valid ScoreSpec ID; systems, staves and annotation
bands).

| Package                         | Holds                                                                      | Built by       |
| ------------------------------- | -------------------------------------------------------------------------- | -------------- |
| `packages/renderer-core`        | `ScoreRenderer`, `RenderOptions`, `LayoutMap`, `RenderError`, factory type | this contract  |
| `packages/renderer-vexflow`     | the `ScoreRenderer` adapter and its factory (fonts)                        | #5             |
| `packages/playback-core`        | `PlaybackPlan`, `PPQ`, engine port, `PlaybackError`, factory types         | this contract  |
| `packages/playback-core`        | `compilePlaybackPlan`, `activeNoteIds` (types fixed in §3.5)               | #6             |
| `packages/playback-spessasynth` | a `CreatePlaybackEngine` implementation                                    | #6 (asset #23) |
| `packages/score-ui`             | ScorePlayer, annotation overlay, highlight sync, P-01 orchestration        | #7             |
| `apps/web`, `apps/mcp/view`     | bind assets and inject `ScoreRendererFactory` / `PlaybackEngineFactory`    | #11, #15       |

Neither core package imports VexFlow, SpessaSynth or each other
(`pnpm check:arch`). `playback-core` has no DOM types: the engine port is
usable in Node tests.

## 1. Shared rules

- Inputs are canonical ScoreSpecs (`validateScoreSpec` or `applyScoreEdit`
  output). Ports never validate, mutate or persist them.
- Outputs are plain data. No library object escapes, except as the `cause` of
  an error, which is for logs only.
- One renderer and one engine per mounted player, created by the injected
  factory and destroyed on unmount (StrictMode mounts twice: each instance
  cleans up after itself).

## 2. Renderer port (`renderer-core`)

### 2.1 Lifecycle

- `render(score, target, options)` mounts once. From then on the renderer
  owns the children of `target`. The UI gives `target` no padding or border
  and draws its overlay in a sibling element, never inside `target`.
- `update(score, options?)` re-engraves a new score or revision; omitted
  options keep the previous ones. A theme change is
  `update(score, { ...options, theme })`.
- `resize(width)` re-engraves the current score at a new width.
- The renderer attaches no global listener, observer or timer. The UI measures
  the container (for example with a `ResizeObserver`) and calls `resize`.
- `destroy()` removes everything the renderer added to `target` and is
  idempotent. Afterwards the renderer never touches `target` again; a pending
  or later `render`/`update`/`resize` rejects (the UI ignores it) and
  `setPlaybackHighlight` is a no-op.
- A second `render`, or `update`/`resize` before `render`, rejects and leaves
  the current mount intact.

### 2.2 Ordering

Calls are applied in call order and each promise settles with the outcome of
its own call. A `LayoutMap` is valid until the next call of the same renderer
resolves; the UI uses the result of its latest call.

### 2.3 Failure

Every rejection is a `RenderError` (`code: 'RENDER_FAILED'`): an engraving
library error, a font that fails to load, a malformed option (negative or
non-finite `width` or `annotationBandHeight`) or a lifecycle misuse (§2.1).
A rejected call leaves `target` showing the last successful rendering (empty
if none) and the renderer usable: a failed update never blanks a readable
score.

### 2.4 Width

- `width` is the available width in CSS px. The adapter chooses how many bars
  fit on each system. Below its own minimum it lays out at that minimum, and
  `LayoutMap.width` reports the width actually used (the UI lets the container
  scroll).
- `width === 0` means the target is hidden (collapsed host, `display: none`).
  The renderer does not engrave, leaves the target content as it is, and
  resolves with an empty `LayoutMap` (`width` and `height` 0, no systems, no
  notes). The next call with a positive width engraves the latest score and
  options.

### 2.5 LayoutMap

Coordinates are CSS pixels of the displayed surface, from its top-left corner,
which is the top-left corner of `target`. Every number is finite; widths and
heights are `>= 0`.

| Field                      | Content                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `width`, `height`          | size of the surface                                                                                       |
| `systems[]`                | top to bottom: `systemId` (`system-<index>`), `index`, `measureIds`, `staves`, `bounds`, `annotationBand` |
| `systems[].staves[]`       | per staff in ScoreSpec order: `staffId`, `bounds` from the top line to the bottom line                    |
| `systems[].bounds`         | everything drawn for the system: ledger lines, labels, dynamics, pedal marks                              |
| `systems[].annotationBand` | empty rectangle directly above `bounds`, as wide as the staves (§2.7)                                     |
| `notes` (`ReadonlyMap`)    | one entry per written note (NoteEvent or chord member; rests excluded), keyed by note ID                  |
| `notes.get(id)`            | `noteId`, `systemId`, `staffId`, `measureId` (bar ID), `bounds` of the notehead only                      |

No two systems' `bounds` or bands intersect. IDs removed by an update are
absent from the new map. `systemId` is not a domain ID and is not stable
across renders. Coordinates are ephemeral and never persisted (ADR-001).

### 2.6 Teaching colors and the playback highlight

- **Teaching colors** are engraved from `score.annotations` by `render` and
  `update`. P-03 guarantees one color per note. Only the targeted written note
  is colored (one chord member, not its chord); every other note uses
  `theme.ink`. Teaching colors are drawn as stored in light and dark themes.
- **Playback highlight** is a separate, transient layer:
  `setPlaybackHighlight(noteIds)` replaces the whole set (`[]` clears it). It
  is synchronous, never re-lays out, ignores unknown IDs and survives `update`
  and `resize` (IDs absent from the new score are ignored). Highlighted notes
  use `theme.playbackHighlight`; a note leaving the set gets back exactly its
  engraved color. The playback cursor therefore never overwrites or erases a
  teaching color (UI-02), and it is not an annotation.
- `RenderTheme` holds only `ink` and `playbackHighlight` (CSS colors usable
  as SVG fill or stroke). The UI maps the host's light or dark theme to them;
  the page provides the background.

### 2.7 Annotation band and overlay (#7)

Annotation text is HTML drawn by the React overlay, positioned in the same
coordinate space as the `LayoutMap`.

- The renderer reserves `options.annotationBandHeight` px above every system
  that holds at least one note targeted by an annotation (other systems get a
  zero-height band), above everything it draws for that system, including
  chord symbols and Roman numerals. It draws nothing in the band.
- The overlay places each annotation's text, in the annotation's color, in the
  band of a system holding one of its notes, horizontally near those notes.
  It never draws inside `staves` or system `bounds`. Nothing is drawn at the
  band's height across the whole surface, so the text may run past the band's
  right edge: score-ui wraps it in the surface width less the band's left
  margin on each side (never less than the band), so a short, unjustified
  system does not squeeze its label into a narrow column.
- The band height is the UI's measured height of its tallest wrapped text
  block at the current width. When it changes (new text, new width), the UI
  calls `update` with the new height: a second pass, because the renderer
  never measures overlay text. With no annotations the UI passes 0.

### 2.8 Fonts

- Engraving fonts (the music font and the text font of the labels the
  renderer draws) are an adapter asset: bundled with the app or loaded from
  the app's configured asset base URL, both set when the app creates the
  factory. Never from a third-party origin: the MCP View runs in a sandboxed
  iframe with a CSP.
- `render`, `update` and `resize` resolve only after the fonts they measure
  with are ready; layout is never computed with fallback metrics. A font that
  fails to load is `RENDER_FAILED`.
- `RenderOptions` has no font field: nothing needs a per-render font choice.
  The overlay text uses the page's own CSS font.

## 3. Playback plan (`playback-core`)

### 3.1 Units

- `PPQ = 960` ticks per quarter; `TICKS_PER_WHOLE_NOTE = 3840` (ScoreSpec
  time is in whole notes).
- `plan.bpm` is `score.tempo.bpm`: quarter notes per minute whatever the
  meter (SCORESPEC_V1_SEMANTICS §1). At tempo multiplier `m`,
  `seconds = ticks × 60 / (PPQ × bpm × m)`: at 120 bpm a quarter (960 ticks)
  lasts 0.5 s.
- Every tick in a plan is a **performance tick**: an integer `>= 0`, swing
  applied (P-02), within `[0, totalTicks]`. #6 converts exact whole-note
  positions with one documented rounding rule and never adds rounded
  durations, so nothing drifts.
- `totalTicks` is the sum of the bars' actual durations (F01 3840, a 7/4 bar
  6720, a 6/8 bar 2880, a quarter pickup 960).

### 3.2 Events

- One `PlaybackEvent` per key press. Each chord member is its own event.
  Rests produce none.
- A tie chain sounds once: `noteId` is its first written note, `tiedNoteIds`
  the continuations in order, and the event covers the whole chain.
- `durationTicks` is the gated sound (staccato shorter, phrasing slur more
  connected) and `velocity` the final loudness (dynamic, hairpin,
  articulations). The constants and precedence rules are #6's documented
  engineering policy, identified by `plan.expressionPolicyVersion` (P-02). No
  randomness: the same score always gives a deep-equal plan.
- Invariants: integers; `durationTicks >= 1`;
  `startTick + durationTicks <= totalTicks`; `midiNote` 21..108; `velocity`
  1..127; sorted by `startTick`, ties in #6's documented order. **One key
  never overlaps itself**: an event ends at or before the next attack of the
  same `midiNote` (how a unison between voices sounds is #6's documented
  rule).

### 3.3 Sustain pedal

Each ScoreSpec pedal span `[onset(start), onset(end) + duration(end))` gives a
`down` at its start and an `up` at its end. A pedal change is `up` then `down`
at the same tick. Pedal events are sorted by tick, and every `down` has a
later `up`. The pedal never lengthens `durationTicks` and is never inferred
from slurs or ties.

### 3.4 Highlight spans

- One `HighlightSpan` per written note, tied continuations included, rests
  excluded. `[startTick, endTick)` is the note's notated span on the performed
  timeline: swing applied, articulation gate not applied. A staccato quarter is
  highlighted for a whole quarter; a tied continuation from its own written
  start.
- `activeNoteIds(plan, tick)` returns the IDs whose span contains `tick`
  (`startTick <= tick < endTick`), in `plan.highlights` order. Half-open: in
  F01 at tick 960 only D4 is active; a chord gives all its members; a rest
  gives `[]`. `tick` may be fractional; outside `[0, totalTicks)` the result
  is `[]`.

### 3.5 Functions #6 adds to `playback-core`

```ts
export const compilePlaybackPlan: PlaybackCompiler; // (score: ScoreSpec) => PlaybackPlan
export const activeNoteIds: ActiveNoteIdsQuery; // (plan, tick) => readonly string[]
```

Both are pure. The compiler is total on canonical ScoreSpecs and copies
`scoreId` and `revision` into the plan so the UI can tell which revision a
plan belongs to.

## 4. Engine port (`playback-core`)

### 4.1 Snapshot and notifications

- `getSnapshot()` and `subscribe(listener)` follow the React
  `useSyncExternalStore` contract: the snapshot is immutable and keeps its
  identity until something in it changes; listeners take no argument and may
  be called synchronously inside the command that caused the change.
- The snapshot holds `state`, `loadId`, `plan` (the committed plan, `null` in
  idle, loading, error and destroyed), `tempoMultiplier` (default 1), `loop`
  (default false) and `error` (only in `error`). Tempo multiplier and loop are
  kept across loads.
- The position is not in the snapshot, so the player does not re-render every
  frame. `subscribePosition(listener)` receives the tick while playing (at
  most once per display frame) and once after every discrete move (load,
  stop, seek, pause, loop wrap, end). Once `load`, `stop`, `pause`, `seek` or
  `destroy` returns, no position of the previous run is delivered.
- Unsubscribing is idempotent. `destroy()` drops listeners without notifying
  them.

### 4.2 State machine

`load(plan)` below means a well-formed plan. Cells name the resulting state;
`-` is a no-op.

| Command \ state       | idle      | loading      | ready     | playing                | paused    | error     | destroyed           |
| --------------------- | --------- | ------------ | --------- | ---------------------- | --------- | --------- | ------------------- |
| `load(plan)`          | loading   | loading (¹)  | loading   | silence, loading       | loading   | loading   | resolves superseded |
| load completes        |           | ready @0 (²) |           |                        |           |           |                     |
| load fails            |           | error        |           |                        |           |           |                     |
| `play()`              | -         | -            | playing   | -                      | playing   | -         | -                   |
| `pause()`             | -         | -            | -         | paused (position kept) | -         | -         | -                   |
| `stop()`              | -         | -            | -         | ready @0               | ready @0  | -         | -                   |
| `seek(t)`             | -         | -            | paused @t | playing @t             | paused @t | -         | -                   |
| end of pass, loop off |           |              |           | ready @0               |           |           |                     |
| end of pass, loop on  |           |              |           | playing @0             |           |           |                     |
| audio breaks          |           |              |           | error                  |           |           |                     |
| `destroy()`           | destroyed | destroyed    | destroyed | destroyed              | destroyed | destroyed | -                   |

(¹) The pending load is superseded. (²) Never playing, even with loop on.
`setTempoMultiplier` and `setLoop` apply in every state but `destroyed` (a
no-op there); the multiplier takes effect immediately without moving the
position.

Every transition out of `playing`, and every seek, loop wrap and load,
releases sounding notes and the pedal at once: no stuck note, no pedal left
down. Each event is attacked at most once per pass (no duplicate scheduling).
After a seek, notes attacked before the target tick are not re-struck and the
pedal takes its state at that tick. Resuming from `paused` re-applies the
pedal state at the position.

### 4.3 Load tokens (AUDIO-07)

- Each accepted `load()` drops the current plan and takes
  `loadId = previous + 1`; the outcome carries that token.
- Only the latest call may commit. An earlier call resolves
  `{ status: 'superseded' }` and never changes the state or the plan, even if
  it fails or finishes late. `destroy()` supersedes every pending call. A
  `load()` after `destroy()` takes no token and resolves
  `{ status: 'superseded', loadId: snapshot.loadId }`.
- A non-null `snapshot.plan` is always the plan of call `snapshot.loadId`.
- A malformed plan (`ppq` not 960, a violated §3.2 invariant the adapter
  checks cheaply) rejects with `INVALID_ARGUMENT` without taking a token or
  changing anything.

### 4.4 Errors

`PlaybackError` carries one `code`; the message is for logs.

| Code                | Raised by                                                        | Afterwards                       |
| ------------------- | ---------------------------------------------------------------- | -------------------------------- |
| `ASSET_LOAD_FAILED` | latest `load()`: SoundFont or worklet module not fetched/decoded | `error`; `load()` again recovers |
| `PLAYBACK_FAILED`   | latest `load()`: synthesizer failed to start                     | `error`; `load()` again recovers |
| `PLAYBACK_FAILED`   | `play()`: audio output could not start                           | state unchanged, silent          |
| `PLAYBACK_FAILED`   | audio breaks while playing (notified, no promise)                | `error`, silent                  |
| `INVALID_ARGUMENT`  | `load()` rejects; `seek()` and `setTempoMultiplier()` throw      | nothing changed                  |

`seek(t)` needs `0 <= t < plan.totalTicks`; `setTempoMultiplier(m)` needs a
finite `m` within `TEMPO_MULTIPLIER_RANGE` (0.25 to 2, inclusive), an
adjustable engineering bound shared by the engine and the tempo control.

### 4.5 User gesture

Browsers start audio only from a user gesture. The UI calls `play()` directly
in its click or key handler, with no `await` before it, and the adapter
resumes its audio output before its first `await`. The adapter may create its
audio context during `load()` (suspended). A `play()` still pending when
`load`, `stop`, `pause` or `destroy` is called resolves without playing.

### 4.6 Assets and factories

```ts
type CreatePlaybackEngine = (assets: PlaybackAssetConfig) => PlaybackEngine; // adapter (#6)
type PlaybackEngineFactory = () => PlaybackEngine; // what score-ui receives

// app wiring (web or MCP View), with the SpessaSynth adapter's root exports:
const engineFactory: PlaybackEngineFactory = () =>
  createSpessaSynthEngine({
    soundFont: { url: resolvePianoAssetUrl(assetBaseUrl) },
    workletModuleUrl: new URL(SPESSASYNTH_PROCESSOR_URL, location.href).href,
  });
```

- URLs are absolute: the app resolves them against its configured asset base
  URL. The adapter fetches nothing else; the host CSP must allow those URLs
  (#11, #16). Asset identity and license are #23.
- `soundFont` is `{ url }` or `{ bytes }`. The engine never transfers or
  mutates the bytes (it copies them if it must transfer), so one buffer can
  serve every engine instance.
- The renderer side is symmetric: `ScoreRendererFactory = () => ScoreRenderer`,
  with fonts bound by the app when it creates the factory (§2.8).

## 5. Synchronization and P-01 (#7)

### 5.1 Highlight

On each position notification, the UI computes
`activeNoteIds(snapshot.plan, tick)` from the **committed** plan and, when the
set changed, calls `renderer.setPlaybackHighlight(ids)`. It clears the set
(`[]`) when the engine leaves `playing` and `paused`.

### 5.2 Accepting a newer revision (P-01)

When the UI accepts a newer canonical revision of the displayed score (same
score ID, higher revision):

1. `engine.stop()`: old notes and pedal are released synchronously.
2. `renderer.setPlaybackHighlight([])`.
3. `renderer.update(newScore)` and
   `engine.load(compilePlaybackPlan(newScore))`.
4. When the load resolves `loaded`, the engine is `ready` at tick 0 and
   silent, even if loop is on: the product's "paused at tick 0" is the engine
   state `ready`. Only an explicit Play (a new `play()` from a user gesture)
   starts the new plan.

`load()` silences on its own; the explicit `stop()` keeps the old audio from
sounding under the new notation even while the UI defers the load. Nothing is
replaced for a duplicate or older revision, a rejected edit, or a tempo or
loop change (local state, kept across loads). A result of **another score
ID** is the host switching scores (possibly back to one shown earlier): it
replaces the displayed score with the same four steps, unless it is older
than a revision of that score the player already accepted (a stale result,
ignored). The player cannot tell a switch back from a late duplicate of the
same revision: a host that must not switch back orders its results. Among competing loads only the
latest commits; the UI ignores `superseded` outcomes. Invariant: whenever the
engine is `playing`, `snapshot.plan.scoreId`/`revision` equal the revision
the renderer shows. How #7 orders `update` and `load` and handles a failed
update to keep it (for example, loading only after a successful update) is
#7's decision.

## 6. Tests

This contract owns no test group: it is types, two error classes and three
constants. The owners are #5 (REN-01..03, REN-I01), #6 (AUDIO-01..07), #7
(UI-01..05) and #11 (MCP-UI-01..03, hosting the real adapters). #7's port
fakes must follow this contract (state table, superseded outcomes, highlight
layer), so a green component test is not built on a fake that the real
adapters contradict.

## 7. Exported names

- `@sheet-music/renderer-core`: types `Bounds`, `LayoutMap`, `NoteLayout`,
  `StaffLayout`, `SystemLayout`, `RenderOptions`, `RenderResult`,
  `RenderTheme`, `ScoreRenderer`, `ScoreRendererFactory`, `RenderErrorCode`;
  class `RenderError`.
- `@sheet-music/playback-core`: types `PlaybackPlan`, `PlaybackEvent`,
  `SustainPedalEvent`, `HighlightSpan`, `PlaybackCompiler`,
  `ActiveNoteIdsQuery`, `PlaybackEngine`, `PlaybackState`,
  `PlaybackSnapshot`, `LoadOutcome`, `Unsubscribe`, `PlaybackAssetConfig`,
  `SoundFontSource`, `CreatePlaybackEngine`, `PlaybackEngineFactory`,
  `PlaybackErrorCode`; class `PlaybackError`; constants `PPQ`,
  `TICKS_PER_WHOLE_NOTE`, `TEMPO_MULTIPLIER_RANGE`. #6 adds
  `compilePlaybackPlan` and `activeNoteIds`, and the shared engine controller
  adapters build on: `createPlaybackController`, types `SynthDriver` and
  `PlaybackTicker` (PLAYBACK_POLICY_V1.md §6).

What the apps wire (#11, #15), from the package roots only:

- `@sheet-music/renderer-vexflow`: `createVexFlowRendererFactory`
  (a `ScoreRendererFactory`), type `VexFlowRendererOptions`,
  `loadBundledFonts`.
- `@sheet-music/playback-spessasynth`: `createSpessaSynthEngine` (a
  `CreatePlaybackEngine`), `SPESSASYNTH_PROCESSOR_URL`, and the #23 asset
  API `PIANO_SOUNDFONT`, `PIANO_SOUNDFONT_DIRECTORY`, `resolvePianoAssetUrl`,
  `checkSoundFontAsset`, types `SoundFontAssetManifest`, `AssetFileReader`
  (PLAYBACK_POLICY_V1.md §7).
- `@sheet-music/score-ui`: `ScorePlayer`, types `ScorePlayerArtifact`,
  `ScorePlayerPorts`, `ScorePlayerProps`, `ScorePlayerTheme`.
