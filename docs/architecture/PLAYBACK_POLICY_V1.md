# Playback policy v1

How issue #6 turns a canonical ScoreSpec into sound. The port contract is
[RENDER_PLAYBACK_PORTS.md](RENDER_PLAYBACK_PORTS.md) (ADR-004); this page
records the choices it leaves to #6: tick rounding, swing, the P-02
expression constants, how unisons sound, how the engine controller schedules,
and how the SpessaSynth adapter works.

| Concern                                          | Module                                     |
| ------------------------------------------------ | ------------------------------------------ |
| `compilePlaybackPlan`, `activeNoteIds`           | `packages/playback-core/src/compiler.ts`   |
| Tick rounding and swing                          | `packages/playback-core/src/timeline.ts`   |
| Expression policy (velocity, gate)               | `packages/playback-core/src/expression.ts` |
| Engine controller (`createPlaybackController`)   | `packages/playback-core/src/controller.ts` |
| SpessaSynth driver and `createSpessaSynthEngine` | `packages/playback-spessasynth/src/`       |

The compiler is pure and deterministic: no clock, no randomness, no
humanization. The same score always gives a deep-equal plan.

## 1. Versioning

`plan.expressionPolicyVersion` is **1**. The constants and rules of §4 and §5
are engineering choices made to render notation audibly and predictably, not
musical laws chosen by the product owner. Changing any of them (a level, a
boost, a gate, a precedence rule, the unison rule) increments the version and
updates the AUDIO-05 table. Tick rounding (§2) and swing (§3) are fixed by
P-02 and the ports contract and do not depend on this version.

## 2. Ticks

- PPQ 960: a whole note is 3840 ticks. ScoreSpec positions are exact
  whole-note fractions (`buildScoreIndex` onsets).
- **Rounding rule**: an absolute position `p` becomes `round(p × 3840)`,
  halves rounded up (positions are never negative). Integer arithmetic only.
- A duration is always the difference of two rounded positions and is never
  rounded on its own, so rounding never accumulates. A 7:4 sixteenth
  (1/28 whole note = 137 1/7 ticks) gives members of 137 or 138 ticks
  (137, 137, 137, 138, 137, 137, 137 from a bar line) and the group still
  lasts exactly 960.
- `totalTicks` is the rounded end of the last bar. Every bar line of a valid
  score whose bars are metric (pickups excepted) is a whole number of ticks.

## 3. Swing (P-02)

- `playbackFeel` absent or `straight`: straight.
- `swing` without `ratio` is 2:1; without `subdivision` it swings eighths.
  An explicit ratio or subdivision wins. `1:1` is straight.
- The swung unit is the subdivision `u` (1/8 or 1/16); a **pair** is `2u`.
  Inside each pair the position is warped piecewise linearly: the first half
  is stretched to `2u × long / (long + short)` and the second half compressed
  to the rest. 2:1 eighths start at 0/640 in each quarter, 3:2 at 0/576.
- Pairs are laid out per bar, from the bar line. In a pickup the grid is
  aligned as if the bar were complete (the pickup is the end of a notional
  full bar). A pair cut by a bar line (odd meters such as 7/8, pickups that
  start mid-pair, short final bars) stays straight, so bar lines, pair
  boundaries and hand alignment never move.
- **Tuplets are not swung twice**: a tuplet group is warped as a block. Its
  start and end follow the swing grid and its members stay evenly spaced
  between them. A group that fills whole pairs (the usual eighth triplet on a
  beat) therefore keeps its written 320-tick spacing.
- Swing changes only performance ticks (events, highlights, pedal). The
  ScoreSpec and its written durations are never changed.

## 4. Expression policy v1

### 4.1 Velocity

| Dynamic level | ppp | pp  | p   | mp  | mf  | f   | ff  | fff |
| ------------- | --- | --- | --- | --- | --- | --- | --- | --- |
| MIDI velocity | 16  | 32  | 48  | 64  | 80  | 96  | 112 | 127 |

- Dynamics are per staff (SCORESPEC_V1_SEMANTICS §8). A staff starts at
  **mf (80)**. A mark sets its staff's level from its onset; the other staff is
  unaffected.
- A **hairpin** ramps linearly, in written time, from the level at its start
  to its target:
  - the first mark on the staff after the hairpin's start and within its span
    (`onset(start) < onset(mark) <= onset(end) + duration(end)`), when that
    mark goes in the hairpin's direction; the ramp then ends at the mark;
  - otherwise one level (16) up or down, clamped to 1..127, reached at the end
    of the span.
    After the ramp, the reached level holds until the next mark.
- The attack's articulation adds **marcato +24**, else **accent +16** (they do
  not add up). The result is rounded (halves up) and clamped to 1..127.
- A tie chain takes the velocity of its first note (its attack).

### 4.2 Gate (how long a key is held)

The gate is a share of the **notated** span (swing applied) of the note that
ends the sound:

| Note that ends the sound                             | Gate |
| ---------------------------------------------------- | ---- |
| unmarked                                             | 9/10 |
| slurred (inside a slur, not its last note)           | 1/1  |
| tenuto                                               | 1/1  |
| staccato                                             | 1/2  |
| portato: staccato under a slur, or staccato + tenuto | 3/4  |

- `durationTicks = max(1, round(notated × gate))`, halves up. A gate never
  exceeds 1: no note is ever held past its notated end.
- A **slur** covers the notes of its start note's staff and voice lane whose
  onset is at or after the start note and strictly before the end note
  (chord members included). The last note of a slur is released like an
  unmarked note.
- A **tie chain** sounds from its first note's start to the gated end of its
  last note: `durationTicks = (lastStart − firstStart) + gate(last)`.

### 4.3 Precedence

- **Articulation over slur**: the note's own staccato or tenuto decides its
  gate; a staccato under a slur is portato.
- **Slur and rest**: legato is at most the notated value, so a slur never
  fills a written rest, and a rest inside a slur stays silent.
- **Slur and repeated pitch**: two slurred notes of the same pitch that are
  not tied are two attacks: the first ends exactly where the second starts
  (note-off before note-on at that tick). A slur never becomes a tie.
- **Pedal**: the sustain pedal changes no gate, velocity or highlight. A
  staccato note under the pedal keeps its short note-off; the synthesizer
  sustains the sound. Pedal events come only from ScoreSpec pedal spans, never
  from slurs or ties: `down` at the start of the span, `up` at its end, `up`
  before `down` at a pedal change.
- **Highlight**: a written note is highlighted for its notated span (swing
  applied, gate not applied), tied continuations from their own start.

## 5. Sounds and ordering

- One event per key press: every chord member is its own event; a tie chain
  (chord members included) is one event carrying its continuations in
  `tiedNoteIds`.
- Events are sorted by `startTick`, then by document order of their first
  note (staff, bar, voice, event, chord member). Highlights likewise.
- **One key never overlaps itself**: a sound ends at the next attack of the
  same key. Two sounds of one key attacked at the same tick (a unison between
  voices or staves) merge into one event: the note first in document order
  keeps it, with the longer duration and the higher velocity. Both written
  notes keep their highlight spans.

## 6. Engine controller

`createPlaybackController(driver, ticker)` implements the whole engine port
(§4 of the ports contract: state table, load tokens, errors, snapshot,
positions) once, over two small interfaces an adapter provides:

- `SynthDriver`: `prepare` (load assets; shared by concurrent calls; retries
  after a failure), `resume` (called synchronously inside `play()`, so within
  the user gesture), `currentTime` (audio clock, seconds), `noteOn`,
  `noteOff`, `sustain` (each with an audio-clock time), `silence`,
  `onFailure`, `dispose`.
- `PlaybackTicker`: a repeating callback (the browser adapter: every 25 ms).

Rules:

- **Look-ahead scheduling**: on each tick, the controller hands the driver
  every action due within **100 ms** of the audio clock, timestamped on that
  clock, in tick order (note-offs, then pedal up, pedal down, note-ons at one
  tick). Each action is handed over at most once per pass. Handed times never
  go back: an action is timed no earlier than the latest one already handed
  over (see the tempo multiplier below).
- **Position** is `anchorTick + (audioTime − anchorTime) × ticksPerSecond`,
  with `ticksPerSecond = 960 × bpm × multiplier / 60`, less the start of the
  current pass when looping. It is reported on each tick while it changes and
  once after every discrete move. It follows the audio clock, so it freezes if
  the output is suspended.
- **silence()** releases every note and the pedal at once and cancels
  everything already handed over for the current time or later. stop, pause,
  seek, load and audio failure call it; destroy disposes the driver, which
  stops everything. Resuming or seeking to tick
  `t` hands over actions from `t` on (a note attacked exactly at `t` sounds),
  never re-strikes a note attacked earlier, and first sets the pedal to its
  state just before `t`.
- **End of a pass** (position reaches `totalTicks`): the plan's own
  note-offs and pedal-up have been handed over and sound by then (every event
  ends by `totalTicks`, every `down` has a later `up`), so release tails ring
  naturally. Loop off: `ready` at 0; `silence()` is called only if something
  is still pending (after a tempo change inside the look-ahead).
- **Loop on**: passes join without a gap. Once a pass is fully handed over,
  the look-ahead hands over the next pass's first actions timed from the
  exact end of the pass (sample-accurate, independent of the 25 ms ticker
  phase and of timer jitter), after the last actions of the pass, so its
  note-offs and pedal-up come first at the boundary. The position wraps to the
  new pass when the audio clock crosses the boundary. Only one pass is handed
  over ahead, and only while its start is still to come: if the timer stalled
  past the boundary, the new pass starts at tick 0 from the current audio
  time. Turning loop off once the next pass has been handed over takes it back
  (`silence()`, then playing on from the current position without re-striking),
  so the next pass never sounds.
- **Tempo multiplier** changes re-anchor at the current position: no jump.
  Actions already handed over (at most 100 ms ahead) keep their times. After
  a tempo rise, actions timed at the new, faster rate could fall before ones
  already handed over at the old rate (a note-off before its own note-on,
  which would hold the key): they are timed at the latest handed time
  instead, so the few notes inside the look-ahead at the change are
  shortened, never held.
- A `play()` still waiting for `resume` is cancelled (resolves without
  playing) by load, stop, pause and destroy; a second `play()` meanwhile
  returns the same promise.
- A `load()` plan is checked cheaply before it takes a token: `ppq` 960,
  positive `bpm` and `totalTicks`, integer sorted ticks, durations `>= 1`
  ending by `totalTicks`, keys 21..108, velocities 1..127, no key overlapping
  itself, pedal ticks sorted within the plan.

## 7. SpessaSynth adapter

`createSpessaSynthEngine(assets, options?)` (`@sheet-music/playback-spessasynth`)
is the controller over `SpessaSynthDriver` and a 25 ms `setInterval` ticker.
`options.decoderStartTimeoutMs` exists for tests; apps use the default.

- **Choice: direct note scheduling**, not SpessaSynth's `Sequencer`. The plan
  is already a timed, ID-carrying event list; the sequencer would require
  building a MIDI file and would own position, seek, loop and tempo, which
  the port defines with semantics (load tokens, no re-strike after seek,
  pedal state at the target, no position after stop) that must be testable
  without audio. The driver uses a `WorkletSynthesizer` and timestamps each
  `noteOn`/`noteOff`/CC64 with the AudioContext time (sample-accurate).
- **Cancelling**: SpessaSynth cannot remove timed messages it has queued. On
  `silence()` the driver mutes the current MIDI channel (CC7 = 0), cuts every
  voice (`stopAll(true)`), queues All Sound Off on that channel 25 ms after
  its last queued message, and continues on another channel (volume 100,
  pedal up). A channel is reused only 50 ms after its last queued message, so
  a muted queue never sounds again. Channel 10 (GM drums) is never used; 15
  channels rotate, all on program 0.
- **Assets** (ports contract §4.6, asset identity in #23): `soundFont` is
  fetched from its absolute URL, or copied from the injected bytes (the
  synthesizer transfers the buffer it receives, so the caller's buffer is
  never detached or changed). `workletModuleUrl` must serve the
  `spessasynth_processor.min.js` of the pinned `spessasynth_lib` (4.3.14): the
  processor and the library share a private message protocol. The adapter
  fetches nothing else. The processor decodes the `.sf3` samples with
  WebAssembly; a page CSP without `'wasm-unsafe-eval'` makes it fail without
  any message, so the load waits at most `DEFAULT_DECODER_START_TIMEOUT_MS`
  (15 s) for the decoder's ready report and then rejects `ASSET_LOAD_FAILED`
  (the player's "Audio unavailable" with Retry), never a load that stays
  pending. Because only `playback-spessasynth` may import
  SpessaSynth, its root exports what apps need to wire it (#11, #15, #16):
  `SPESSASYNTH_PROCESSOR_URL` (a Vite asset import of that file: the app's
  Vite build emits it and this is its URL, relative to the page or a `data:`
  URL when the build inlines assets; the app resolves it to an absolute URL
  and its CSP must allow it) and the #23 asset API: `PIANO_SOUNDFONT` (file,
  hashes, license, required notices, attribution text to show),
  `resolvePianoAssetUrl(assetBaseUrl, file?)` for the published asset
  directory, and `checkSoundFontAsset` for a build or deploy check.
- **Dependencies**: `spessasynth_lib` is the runtime dependency. The package
  also declares `spessasynth_core` (4.3.22), which no `src` file imports: it
  pins the version the SoundFont extraction script
  (`assets/soundfonts/piano/scripts/extract-grand-piano.mjs`) resolves from
  this package. It belongs in `devDependencies`; moving it changes
  `pnpm-lock.yaml` and is left to a lockfile update.
- **User gesture**: the AudioContext is created during `load()` (suspended
  without a gesture; worklet, synthesizer and SoundFont still load) and
  resumed only by `play()`, which the UI calls directly from its click or key
  handler.
- **Errors**: SoundFont fetch failure, worklet module failure and a
  SoundFont that does not decode (reported by SpessaSynth as an event, not a
  rejection, so the driver races it) are `ASSET_LOAD_FAILED`; any other
  failure to start is `PLAYBACK_FAILED`, including an audio processor error
  (`processorerror`) before the synthesizer is ready. A failed load closes
  the audio context it opened; the next `load()` retries from scratch. A
  processor error once ready is reported through `onFailure` (engine `error`
  when playing).
- **dispose** destroys the synthesizer and closes the AudioContext.

## 8. Tests

| Group    | File (`packages/playback-core/test/`) | Covers                                                                                                                                                |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUDIO-01 | `audio-01-pitch-time.test.ts`         | F01 keys/ticks, 0.5 s quarter at 120 bpm, chords, hands, rests, spelling, unison                                                                      |
| AUDIO-02 | `audio-02-rhythm.test.ts`             | dotted values, triplets, quintuplets, septuplet rounding, no drift, local meter, pickup                                                               |
| AUDIO-03 | `audio-03-swing.test.ts`              | straight, default and explicit ratios, sixteenth swing, tuplets, pickup                                                                               |
| AUDIO-04 | `audio-04-ties-legato.test.ts`        | ties, tied chord member, slur gates, repeated pitch, rests, no pedal                                                                                  |
| AUDIO-05 | `audio-05-expression.test.ts`         | the §4 table on F08, hairpin into a mark, precedence, pedal, determinism                                                                              |
| AUDIO-06 | `audio-06-engine-state.test.ts`       | state transitions, pause/seek/stop/loop/tempo, tempo rise without held keys, seamless loop join, endpoints, failures, destroy, half-open active notes |
| AUDIO-07 | `audio-07-async-resources.test.ts`    | load tokens, recoverable asset failures, malformed plans, listeners, pending play                                                                     |

Expected numbers are written in the tests or come from the
`@sheet-music/test-fixtures` oracles. Engine tests use a fake driver that
models held keys and pedal from what it is handed, and a fake 25 ms clock.

The real adapter check is
`packages/playback-spessasynth/test/spessasynth-engine.mcpui.test.ts`
(`pnpm test:mcp-ui`): in Chromium, with the #23 piano asset and the pinned
worklet (`SPESSASYNTH_PROCESSOR_URL` from the package root), the engine loads before any gesture, sounds after a real click (the
output's peak level, not a waveform), moves its position, stops to silence,
sounds again, and closes its AudioContext on destroy; unreachable SoundFont
or worklet URLs and undecodable bytes reject `ASSET_LOAD_FAILED`. MCP-UI-01
(#11) reuses this adapter inside the real View rather than repeating it.

`playback-spessasynth` typechecks its browser `src` on its own
(`tsconfig.json`: DOM and Vite client types, no Node types) and its tests
with Node types added (`test/tsconfig.json`), so a Node API used by mistake
in `src` fails `pnpm typecheck`.
