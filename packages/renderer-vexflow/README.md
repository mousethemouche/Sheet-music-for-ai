# @sheet-music/renderer-vexflow

The VexFlow 5.0.0 adapter of the renderer port (issue #5, ADR-004). It
implements `ScoreRenderer` from `@sheet-music/renderer-core` exactly as
[RENDER_PLAYBACK_PORTS.md](../../docs/architecture/RENDER_PLAYBACK_PORTS.md)
§2 specifies; this page records the adapter's own decisions.

```ts
import { createVexFlowRendererFactory } from '@sheet-music/renderer-vexflow';

// App wiring (web or MCP View): inject this into score-ui.
const rendererFactory = createVexFlowRendererFactory();
```

## Fonts, offline

VexFlow 5 draws every music glyph as SMuFL text and measures it with a canvas
(`measureText`), so layout is only right once the real fonts are loaded.

- The adapter imports the `vexflow/bravura` entry point. That build embeds
  Bravura (music) and Academico (text, regular and bold) as base64 WOFF2
  `data:` URLs and registers them with the CSS Font Loading API at import
  time. Nothing is fetched: VexFlow only falls back to its jsDelivr
  `Font.HOST_URL` when a font is loaded by name without a URL, which this
  adapter never does. The larger `vexflow` entry (Petaluma, Gonville...) is
  not used.
- `loadBundledFonts()` (the default `loadFonts`) awaits
  `document.fonts.load()` for `30pt Bravura`, `12pt Academico` and
  `bold 12pt Academico`. `render`, `update` and `resize` call it before
  engraving; a missing Font Loading API, an unregistered face or a face that
  fails to load rejects with `RENDER_FAILED`.
- **CSP:** `data:` font sources are subject to `font-src`. The page that
  hosts the renderer (the MCP View iframe, the web app) must allow
  `font-src data:`; otherwise every render fails with `RENDER_FAILED`
  (checked by MCP-UI-01, #11, and the deploy headers, #16).
- An app that must serve the fonts itself registers `Bravura` and
  `Academico` (regular and bold) `FontFace`s in the document and passes
  `createVexFlowRendererFactory({ loadFonts })`, where `loadFonts` resolves
  once they are loaded.

## Mapping

| ScoreSpec               | VexFlow construct                                            | Anchor / placement                                                                                                         |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| staff, clef             | `Stave` per bar, `addClef` at each system start              | 2 staves: brace + connected barlines (`StaveConnector`)                                                                    |
| key signature           | `addKeySignature` at each system start                       | written pitches are never re-altered (below)                                                                               |
| meter, local meter      | `addTimeSignature`                                           | first bar and every bar whose effective meter differs                                                                      |
| pickup / incomplete bar | `Voice` of the bar's actual length                           | -                                                                                                                          |
| note, chord, rest       | one `StaveNote` per event (chord = one note, n keys)         | chord member = key index, in member order                                                                                  |
| dots                    | `Dot` per key                                                | -                                                                                                                          |
| spelled pitch           | key `f#/4`, `gb/4`...; `Accidental` only when displayed      | per staff and bar, by staff position; tie continuations show none                                                          |
| voices                  | one `Voice` per lane; 2+ voices: first stems up, others down | both staves formatted together (aligned onsets); 3+ voices: see below                                                      |
| tuplet group            | `Tuplet(members, actual:normal)` by `groupId`                | number on the stem/beam side                                                                                               |
| beams                   | `Beam` per beat (dotted quarter in 6/8, 9/8, 12/8)           | a tuplet group is beamed as a whole                                                                                        |
| tie                     | `StaveTie` (split at a system break)                         | per chord member                                                                                                           |
| slur                    | `Curve`                                                      | one curve per system it crosses                                                                                            |
| articulations           | `Articulation` `a>` `a.` `a-` `a^`                           | notehead side; marcato above; once per chord (below)                                                                       |
| fingering               | `FretHandFinger`                                             | note: above (top staff) / below (others), voices sharing a staff: see below; chord member: right of its head               |
| chord symbol            | `TextNote` in a text voice of the top staff                  | bar + offset, row above the top staff; half a space kept after it                                                          |
| Roman numeral           | `TextNote` in a text voice of the bottom staff               | bar + offset, last row below the bottom staff (see Label rows); half a space kept after it                                 |
| scale degree            | text centered under its notehead                             | note, row below its staff; labels that would touch (a chord's members): one row each, top note nearest the staff           |
| dynamic mark            | `TextDynamics` in a text voice                               | event onset, row below its staff; marks sharing an onset: one row each                                                     |
| hairpin                 | wedge path drawn by the adapter                              | start event (after its mark) to the end of the end event (before the next mark and the bar line); continued across systems |
| sustain pedal           | `PedalMarking` (text: "Ped." ... release)                    | "Ped." at the start, release before the end of the end event (below)                                                       |
| swing                   | text (`displayText`, default "Swing")                        | above the first system                                                                                                     |
| teaching color          | notehead style of the targeted key only                      | the note's own modifiers (accidental, fingering) share its color                                                           |

Text voices use invisible `GhostNote`s with exact tick multipliers, so labels
share tick contexts with the notes at their onset (and get horizontal room),
whatever the rational offset.

- **Spans across a system break.** A slur is drawn as one curve per system
  from/to that system's edge events. A hairpin is one wedge per system whose
  opening is interpolated along the whole drawn length, so a continued part
  starts as open as the previous one ended and only the real start (crescendo)
  or end (diminuendo) is a point. A pedal span writes "Ped." once, on the
  system where it starts, and its release once, on the system where it ends;
  a system it only crosses shows nothing (the pedal stays down).
- **Pedal release and short spans.** The release ends 3 px before the end of
  the span: the next event of the end event's voice (where the "Ped." of a
  pedal change starts, so the two marks never touch), or the ink of the bar
  line. When a span is too short for "Ped.", the release and these gaps at
  the bar's natural width (one short note, a whole note in a narrow bar), the
  layout gives its start event that much horizontal room. The room is an
  invisible note of that width lasting until the next position of the bar,
  where an invisible note of the same voice starts: VexFlow's justification
  never brings a voice's next note closer than the width of the one before
  it, so the room holds at any bar width, first on its system or not.
- **Hairpins and marks.** A hairpin starting on an event with a dynamic mark
  starts 6 px after the mark; one ending right before an event with a mark
  (the common "< f") stops 6 px before the mark's ink; a hairpin also stops
  6 px before the next event of its staff and before the ink of the bar line
  (a final bar line's thin line included).
- **Dynamic marks** are placed per staff. When several voices carry a mark
  at the same onset, each mark gets its own row under the staff.
- **Fingering with several voices on a staff.** The first voice's (stems up)
  goes above its notehead and the others' below, so a fingering never lands
  on a note of another voice (with one voice: above on the top staff, below
  on the others). A note on or beyond an outer staff line takes the outer
  side instead, clear of every staff and ledger line, unless another voice
  sounds a note at or beyond it at the same onset (that side is the other
  voice's) or a slur or tie is drawn there (the notehead's side).
- **Scale degrees sounding together.** Degrees are centered under their
  noteheads. Left to right, each takes the first row of its staff where it
  clears the labels already on it; at one onset the top note comes first,
  so a chord's degrees read top to bottom as its notes do (C-E-G labelled
  1-3-5 reads 5, 3, 1 under the staff).
- **Chord articulations.** ScoreSpec stores articulations per chord member;
  a chord is engraved with each articulation once. One carried by a single
  member stays on it (and takes its teaching color); one shared by several
  members goes on the first of them without a teaching color.
- **Three or four voices on a staff.** VexFlow keeps the noteheads and rests
  of at most three voices starting together apart. Where three or more start
  together, a glyph that still touches one of an earlier voice moves right
  past it, and the layout gives that onset the room.

Not drawn: the harmonic `function` of an analysis, the tempo and the title
(the UI shows metadata). Everything that is not a teaching color is painted
with `theme.ink` (VexFlow's grey staff and ledger defaults are overridden).

## Layout and LayoutMap

1. Each bar is built on placeholder staves to find VexFlow's minimum width.
   A second build, formatted at the bar's natural width, finds the onsets
   that need more room (short pedal spans, voices moved aside); the bar is
   then measured again with that room, which holds at any wider width.
2. Greedy line breaking at natural width (minimum x 1.4 + 16 px), then
   justification; a last system less than 60 % full is not stretched. Below
   the widest single bar the renderer lays out at that minimum and reports
   the width used; otherwise `LayoutMap.width` is the requested width (ink may
   reach into the right margin, such as a justified barline's stroke, but the
   surface only grows for ink past its edge).
3. Per system, a measuring pass: the bars are built on provisional staves
   and drawn into a scratch group, which is measured and removed. It gives
   the ink of each staff's notation (lines, clef and signatures, notes with
   their accidentals, articulations and fingerings, beams, tuplets, ties,
   slurs) and of each label row. Staves and rows are placed from these
   measurements (Label rows, below).
4. The bars are rebuilt on their final staves, formatted and drawn into one
   `<g>`, every row on its planned line. The horizontal layout is the same in
   both passes.
5. Systems are stacked from their measured ink with the annotation band
   (`annotationBandHeight`, only when the system holds an annotated note)
   directly above them.

### Label rows

Labels outside the staves are laid out in rows that span the whole system,
so the labels of one kind share a line. Outward from their staff:

| Side                   | Rows, nearest first                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| above the top staff    | chord symbols, swing indication (then the annotation band, from the LayoutMap)                                                            |
| below every staff      | scale degrees (one row per label sounding together), dynamics and hairpins (one more row per extra mark at a shared onset), sustain pedal |
| below the bottom staff | the same, then Roman numerals                                                                                                             |

- Scale degrees name single notes, so they stay next to them, as fingerings
  (drawn with the notes) do. Dynamics and hairpins are the staff's
  performance directions. The pedal is the outermost performance mark under
  its staff. Roman numerals are analysis, not performance: they read as one
  uninterrupted line at the bottom of the system, clear of every mark.
- Nothing is placed from glyph-size constants. Each row sits half a staff
  space beyond the measured ink before it (the staff's notation, or the
  previous row on that side); a staff keeps at least 1.5 spaces above its top
  line and 1 below its bottom line; the next staff sits 12 px below the
  lowest row of the staff above. A taller glyph, a lower note or a second
  row of marks moves everything after it, and the system's measured bounds
  (so the next system and the annotation band) follow.
- Within a row, dynamic marks sit 6 px below the line their hairpins are
  centered on; "Ped." and its release share a baseline.

`LayoutMap` coordinates are the SVG's user space, which is CSS px from the
target's top-left (no viewBox scaling, `display: block`). Notehead bounds
come from VexFlow's own glyph metrics (tight, measured with the loaded font).
System bounds are the union of the drawn ink: `getBBox()` of paths and
rectangles, canvas glyph metrics for text (an SVG text box is the whole font
line box), VexFlow's invisible pointer rectangles excluded.

The playback highlight sets an inline `fill` on each notehead glyph and
removes it to restore the engraved color (teaching color or ink); nothing is
re-laid out. The SVG carries `data-*` hooks (`data-note-id` on notehead
groups, `data-harmony-id`, `data-scale-degree-id`, `data-dynamic-id`,
`data-pedal-id`, `data-slur-id`, `data-tie-from`/`data-tie-to`,
`data-system-index`) for tests and debugging; the UI relies on the
`LayoutMap` only.

## Known limits

- Label rows are bands as wide as the system: the lowest ink anywhere on it
  (one low note, one long stem) moves the whole row, and a label never uses
  empty room beside other ink (no per-position skyline).
- Fingerings are VexFlow modifiers set next to their notehead, so one can sit
  inside the staff: a note inside the staff, a note with one voice on the
  side opposite its hand's (a right-hand note below the treble staff), a
  note lying between another voice's note and the staff (D2 over D1), a
  chord member's (right of its head, among its ledger lines).
- A voice's articulation on its notehead's side can land on another voice's
  note or fingering right below it (VexFlow places it).
- Each system is built and drawn twice (measure, then final).
- No courtesy accidentals; accidental state is per staff position (step and
  octave) for the bar.
- A voice moved aside (three or four voices starting together) keeps its
  articulations centered on its unmoved position, as VexFlow draws them.

## Tests

| Group   | File                                    | Project | Environment                                |
| ------- | --------------------------------------- | ------- | ------------------------------------------ |
| REN-01  | `test/ren-01-semantic-mapping.test.ts`  | unit    | jsdom (stubbed text metrics and `getBBox`) |
| REN-02  | `test/ren-02-identity.test.ts`          | unit    | jsdom (stubbed text metrics and `getBBox`) |
| REN-03  | `test/ren-03-lifecycle.test.ts`         | unit    | jsdom (stubbed text metrics and `getBBox`) |
| REN-I01 | `test/ren-i01-vexflow.mcpui.test.ts`    | mcp-ui  | headless Chromium, real fonts and geometry |
| REN-I02 | `test/ren-i02-label-rows.mcpui.test.ts` | mcp-ui  | headless Chromium, real fonts and geometry |

jsdom has no canvas text metrics or SVG geometry, so REN-01..03 run the real
VexFlow objects and drawing with deterministic stub metrics: they check
mapping, identity, lifecycle and the order the adapter gives things (label
rows, rows of dynamic marks), never glyph geometry. REN-I01 is the interim
real check until the MCP-UI-01/02 harness (#11) hosts it. REN-I02 engraves
every catalogue fixture with labels, the rich fixture, a crowded low bass
line and the crowded scores of `test/label-scores.ts` (pedal changes on every
beat, a one-eighth pedal then a change in a justified bar, degrees on chord
members, hairpins into marks, voices sharing a low bass staff) at 1040, 760,
520 and 320 px: no two labels (of one kind or not, except one chord's stacked
fingerings), and no label and a staff line, bar line or notehead of its own or
a neighbouring system, come within 2 px, and every label lies inside its
system's LayoutMap bounds; hand-picked fingerings of shared staves on or
beyond an outer line clear every staff and ledger line.
