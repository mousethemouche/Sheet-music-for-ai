# ScoreSpec v1 semantics

Precise meaning of the ScoreSpec v1 contract (issue #2, "Before implementation").
[ADR-001](ADR-001-score-spec-contract.md) remains the decision record and lists
the supported notation; this page fixes the details it leaves open. The runtime
implementation is `packages/music-domain` (`validateScoreSpec`), and the rules
below are what it enforces. Every notation feature listed in ADR-001 stays
supported; nothing here removes one.

Terms: a **bar** is one column of the score (bar 3 of every staff); a
**measure** is one staff's content for a bar; a **note** is one written note
head (a `NoteEvent` or one member of a `ChordEvent`); an **event** is a note,
chord or rest in a voice.

## 1. Units

| Quantity                        | Unit                             | Representation                                                  |
| ------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| Musical time (positions, spans) | whole notes                      | exact fraction `{ numerator, denominator }`: a quarter is `1/4` |
| Rhythmic duration               | note value + dots + tuplet ratio | `Duration`; its exact length is a whole-note fraction (§5)      |
| Tempo                           | quarter notes per minute         | `tempo.bpm`, `20 <= bpm <= 400`, one tempo per score            |
| Written pitch                   | step + alteration + octave       | `Pitch`; octave 4 contains middle C                             |
| Ticks, seconds, MIDI            | not stored                       | derived by the playback compiler (#6) at PPQ 960                |

- **No floating-point rhythm.** Durations are enums; positions and bar lengths
  are integer fractions (numerator 0..1,000,000, denominator 1..1,000,000,
  compared by value, so `2/8` equals `1/4`). Seconds and ticks are never
  accepted as canonical rhythm.
- **Tempo is always per quarter note**, whatever the meter: in 6/8 at
  `bpm: 120` a dotted quarter lasts 0.75 s. A quarter lasts `60 / bpm`
  seconds and a whole note `240 / bpm` seconds. There is no tempo change inside
  a v1 score; the player's tempo slider is local UI state, not ScoreSpec.
- **Tick conversion belongs to #6.** A whole note is 3840 ticks at PPQ 960.
  Some ratios are not a whole number of ticks (a 7:4 sixteenth is `1/28` whole
  note = 137 1/7 ticks); #6 converts _absolute positions_ with one documented
  rounding rule and never accumulates rounded durations, so there is no drift.

## 2. Score and staves

- `version` is exactly `1`; anything else is `UNSUPPORTED_VERSION`.
- Piano only: there is no instrument field, and staves are right or left hand.
- **One or two staves.** Zero staves is invalid; three or more is an MVP
  limit. Two staves are the right hand then the left hand, in that order
  (`STAFF_HANDS_INVALID` otherwise). A single staff may be either hand.
- **Clef.** `clef` may be omitted. The canonical output then fills it from the
  hand: right hand `treble`, left hand `bass` (ADR-001 invariant 4). An
  explicit clef is kept as given, including a treble left hand.
- `revision` is an integer `>= 0`. The application assigns and increments it
  (ADR-002); validation only checks its type.

## 3. Bars: shared alignment and counting

- **Every staff has the same bars.** Staff _k_ has exactly as many measures as
  staff 0, and its measure at position _i_ has the same `id`, `kind`,
  `timeSignature` and `actualDuration` as staff 0's (actual durations compare
  by value). Otherwise: `MEASURE_ALIGNMENT_MISMATCH`.
- **A bar ID is shared.** The aligned measures of both staves carry the same
  ID. That ID names the bar (harmony events and ADR-002 operations target bars
  by it). Combined with a staff ID it names one staff's measure. A bar ID may
  not be reused for anything else.
- **Counting.** The bar count is the number of measures per staff: two hands
  of 32 bars count as 32. The MVP maximum is 32 bars and the minimum is 1.
- **Numbering.** `number` is the 1-based position of the bar in the score,
  pickup included (a pickup is bar 1). It must equal position + 1
  (`MEASURE_NUMBER_INVALID`). How a renderer displays bar numbers is its own
  choice.

### 3.1 Local meter changes

- `measure.timeSignature` overrides the score `timeSignature` **for that bar
  only**. It does not carry forward: the next bar without an override uses the
  score time signature again. The effective meter of a bar is
  `measure.timeSignature ?? score.timeSignature`.
- An override equal to the score meter is allowed and has no effect.
- The renderer shows a meter sign at the start and wherever the effective meter
  differs from the previous bar's. `set_time_signature` (#3) changes only the
  score-level meter: bars without an override must still fit it.
- Valid meters: numerator 1..32, denominator 1, 2, 4, 8, 16 or 32.

### 3.2 Pickup and incomplete bars

- `kind` is `full` (the default when omitted), `pickup` or `incomplete`.
- A `pickup` or `incomplete` bar must declare `actualDuration`, a whole-note
  fraction with `0 < actualDuration < nominal bar length` (nominal = effective
  meter numerator/denominator). A full bar must not declare it. Violations are
  `MEASURE_KIND_INVALID`.
- Only the first bar can be a `pickup`; a short bar anywhere else is
  `incomplete`. A short first bar is always a `pickup`.
- **The actual duration is a property of the bar**: it is declared on the
  measure of every staff with the same value (checked by alignment, §3), and
  every voice of every staff in that bar fills exactly `actualDuration`. It is
  not inferred from notes.
- A pickup and a final incomplete bar need not add up to a full bar.

## 4. Voices

- Each measure has 1..4 voices; each voice has 1..64 events.
- **Every voice fills its bar exactly**: the sum of its event durations (§5)
  equals the bar's actual length (the nominal length of the effective meter,
  or `actualDuration`). Overfilling and unexplained gaps are both
  `VOICE_DURATION_MISMATCH`. Silence is written as rests. There is no
  implicit whole-bar rest: in 7/4, a silent voice is written, for example, as
  whole + half + quarter rests.
- **Voice lanes.** The voice at position _v_ of a measure continues as the
  voice at position _v_ of the same staff in the next bar. Voice IDs are unique
  per measure; the lane is the position, not the ID. Ties use lanes (§7).

## 5. Durations and tuplets

- Written length = base value × dot factor. Base values: whole `1`, half
  `1/2`, quarter `1/4`, eighth `1/8`, sixteenth `1/16`, thirtySecond `1/32`.
  Dot factors: 0 dots ×1, 1 dot ×3/2, 2 dots ×7/4.
- Sounding (metric) length = written length × `normal/actual` for a tuplet
  member, otherwise the written length. Examples: eighth triplet member `1/12`,
  eighth quintuplet (5:4) member `1/10`, sixteenth septuplet (7:4) member
  `1/28`, dotted quarter `3/8`, double-dotted half `7/8`.

### 5.1 Tuplet groups

- A tuplet member carries `duration.tuplet = { groupId, actual, normal }`.
  **Group membership is explicit**: all events with the same `groupId` form one
  group. `groupId` shares the score's ID namespace (§12) but is shared by the
  members of its group.
- Ratio: integers, `2 <= actual <= 12`, `1 <= normal <= 12`,
  `actual != normal` (`INVALID_VALUE` otherwise).
- A group (`TUPLET_GROUP_INVALID` otherwise):
  1. has at least two members;
  2. consists of consecutive events of one voice in one bar (a group never
     crosses a bar line or skips an event);
  3. uses one ratio for all its members;
  4. is complete: its total written length divided by `actual` is a plain
     value (whole, half, quarter, eighth, sixteenth or thirty-second). For
     example 3 eighths `3/8 ÷ 3 = 1/8`, or quarter + eighth `3/8 ÷ 3 = 1/8`.
     The group then lasts `normal` of those units: an eighth triplet lasts a
     quarter.
- Members may be notes, chords or rests. Nested tuplets are out of scope.

## 6. Pitch and chords

- Written pitch is a spelling: `step` C..B, `alter` -2..2 (double flat to
  double sharp), `octave` 0..8. F#4 and Gb4 are different written pitches that
  sound the same key. Pitches are stored as written; the key signature never
  alters a stored pitch (`alter` is the absolute alteration, not relative to
  the key).
- A note must lie on the 88-key piano, A0 (MIDI 21) to C8 (MIDI 108), computed
  from the spelling (B#3 is MIDI 60): `PITCH_OUT_OF_RANGE` otherwise.
- A chord has 2..10 members. Every member has its own stable ID, fingering,
  articulations and tie. Two members may not have the same written pitch
  (`CHORD_DUPLICATE_PITCH`); two spellings of one key (F#4 and Gb4) are
  allowed.
- Fingering is 1..5; articulations are a set (no repeats) of `accent`,
  `staccato`, `tenuto`, `marcato` on a note or chord member.
- `keySignature.fifths` is -7..7. `tonalContext` = tonic pitch class + mode.
  Neither is cross-checked against the other or against the notes.

## 7. Ties

- `tie: { start?: true, end?: true }` sits on a note or a chord member (at
  least one of the two must be `true`). Ties are per written note, so each
  chord member is tied individually.
- **Pairing.** A note with `tie.start` in event _E_ is tied to the note, in the
  **next event of the same lane** (the next event of its voice, or the first
  event of the same voice position in the next bar of the same staff), that has
  the **identical written pitch** (step, alter and octave; an enharmonic
  respelling is not a tie). That note must declare `tie.end`.
- Every `tie.end` must be reached by such a `tie.start`. A tie into a rest, into
  a different pitch, past the last event, or unmatched on either side is
  `TIE_UNMATCHED`.
- A tie joins continuity of one pitch; it never implies a slur, and a slur
  never implies a tie. Tied notes keep their own IDs.

## 8. Spans, anchors and attachments

References must resolve to an element of the expected kind:
`REFERENCE_NOT_FOUND` if no element has the ID, `REFERENCE_KIND_MISMATCH` if
the ID belongs to another kind (for example a rest where a note is required).

| Layer               | Anchors                                            | Scope                                  | Order                                     | Other rules                                     |
| ------------------- | -------------------------------------------------- | -------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Slur                | `startNoteId`, `endNoteId`: notes or chord members | one staff                              | start onset **strictly before** end onset | -                                               |
| Hairpin (dynamic)   | `startEventId`, `endEventId`: events               | the staff of its anchors               | start onset `<=` end onset                | hairpins on one staff never overlap             |
| Dynamic mark        | `eventId`: an event (note, chord or rest)          | the staff of its event, from its onset | -                                         | at most one mark per event                      |
| Sustain pedal       | `startEventId`, `endEventId`: events               | whole instrument                       | start onset `<=` end onset                | anchors on one staff; pedal spans never overlap |
| Harmony event       | `measureId`: a bar; `offset` (default 0)           | score (above the top staff)            | `0 <= offset < bar length`                | at most one harmony event per bar position      |
| Scale-degree label  | `noteId`: a note or chord member                   | that note                              | -                                         | at most one label per note                      |
| Teaching annotation | `noteIds`: notes or chord members                  | those notes, any staff                 | -                                         | no repeated ID in one annotation; P-03 (§11)    |

- **Ordering is by musical time**: anchors are compared by onset (whole-note
  position from the start of the score), never by array order.
- **Endpoints are inclusive**: a span covers `[onset(start), onset(end) +
duration(end))`. A pedal down on a whole note is `start = end = that note`.
  Two spans overlap when these intervals share a positive length. A pedal
  change is two spans where the second starts where the first ends.
- **Cross-staff**: slurs, hairpins and pedal spans start and end on the same
  staff (`SPAN_CROSS_STAFF`). The pedal still sounds on both hands. A dynamic
  applies to its own staff; to set both hands, mark both staves. Annotations
  may group notes of both staves.
- Violations: `SPAN_ORDER_INVALID`, `SPAN_CROSS_STAFF`, `SPAN_OVERLAP`,
  `POSITION_OUT_OF_RANGE`, `ATTACHMENT_CONFLICT`, `REFERENCE_DUPLICATE`.

## 9. Harmony and labels

- Chord symbols, Roman analysis and melodic scale degrees are separate,
  structured data. A `HarmonyEvent` carries a `chord`, an `analysis`, or both
  (never neither).
- Chord symbol: root, optional quality (`major`, `minor`, `dominant`,
  `diminished`, `half-diminished`, `augmented`), extension 6/7/9/11/13, up to 4
  alteration strings (such as `b9`, `#11`), optional slash bass and a display
  escape hatch.
- Roman numerals (`ii7`, `V7/ii`, `bVI`, `iiø7`) and harmonic function are
  bounded free text.
- Scale-degree labels: degree 1..7 with alteration -2..2 and optional display
  (`#4`, `b3`).
- The validator does not check that a label is musically correct for its note
  or key (that is pedagogy, not structure).

## 10. Playback feel (P-02)

- `playbackFeel` absent or `{ type: "straight" }` means straight.
- `{ type: "swing" }` requests swing. `subdivision` defaults to `eighth` and
  `ratio` to `2:1` **when compiled by #6**; the canonical document keeps the
  fields absent. An explicit ratio wins.
- The ratio is integers `1 <= short <= long <= 16` (`1:1` is straight timing).
  Swing never rewrites written durations. Written tuplets are not swung a
  second time (#6).
- `displayText` is an optional label such as "Swing".

## 11. Teaching annotations and colors (P-03)

- An annotation is `{ id, color, noteIds (1..32), text (1..80 characters) }`.
  Text length counts Unicode code points. Blank text (empty, or only
  whitespace and invisible format characters such as U+200B) is invalid; the
  same rule applies to every free-text field (title, tags, labels).
- **Colors** accept `#rgb`, `#rrggbb` (hex digits in any case) or a CSS named
  color (any case; `transparent` and `currentcolor` excluded). Alpha, `rgb()`,
  `hsl()` and surrounding whitespace are rejected. The canonical form, stored
  in validated output, is lowercase `#rrggbb`: `HotPink`, `#FF69B4` and
  `#ff69b4` are all `#ff69b4`, and `#F0C` is `#ff00cc`.
- **P-03**: one note carries at most one teaching color. If annotations with
  different canonical colors target the same note, the document is rejected
  with `SCORE_VALIDATION_FAILED` and one `ANNOTATION_COLOR_CONFLICT` detail per
  affected note: `path` is `["annotations"]` and `ids` is
  `[noteId, ...annotationIds sorted]`. Details follow document order of the
  notes, so the result does not depend on annotation order. Nothing is
  resolved by "last wins".
- Overlapping annotations with the **same** canonical color are valid, and so
  are disjoint annotations of different colors. The playback cursor is not an
  annotation.

## 12. Stable identity

- IDs match `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`, so they are safe to echo in
  errors.
- **One namespace per score**: staff, bar, voice, event, chord member, tuplet
  group, harmony, slur, dynamic, pedal, scale-degree and annotation IDs are all
  distinct (`DUPLICATE_ID`), with two sharing rules: a bar ID is shared by the
  aligned measures of every staff (§3), and a tuplet `groupId` is shared by its
  members (§5.1). The score `id` identifies the document and is not part of
  this namespace.
- A `NoteEvent` ID is both an event ID and a note ID. A chord's ID is an event
  ID; each of its members has a note ID.
- `buildScoreIndex(spec)` returns, for any ID: its kind and JSON path; for
  events and notes, the staff, bar, voice, lane and exact onset/duration; bar
  starts and lengths; tuplet groups; and matched tie pairs. Validation, #3, #5
  and #6 reuse it. A pickup/incomplete bar whose declared `actualDuration` no
  voice fills (already a validation error) is positioned by its nominal
  length, so building the index never fails, whatever fractions a rejected
  document declares.
- Unchanged musical objects keep their IDs across revisions (ADR-001/002).

## 13. MVP limits

A maximum exceeded is `MVP_LIMIT_EXCEEDED`; a minimum not met is an ordinary
validation failure. The ScoreSpec values live in one table, `MVP_LIMITS`, in
`packages/music-domain/src/limits.ts` (PRD: limits are configurable
heuristics). The bounds of an edit command itself (operations per edit,
largest transposition) are a second table, `OPERATION_LIMITS`, in
`packages/music-domain/src/operations/schema.ts`; see
[SCORE_OPERATIONS_V1.md](SCORE_OPERATIONS_V1.md).

| Bounded item                                 | Min | Max                | Detail code over max               |
| -------------------------------------------- | --- | ------------------ | ---------------------------------- |
| Staves                                       | 1   | 2                  | `TOO_MANY_STAVES`                  |
| Bars (per staff = per score)                 | 1   | 32                 | `TOO_MANY_MEASURES`                |
| Teaching annotations                         | 0   | 4                  | `TOO_MANY_ANNOTATIONS`             |
| Annotation text (code points)                | 1   | 80                 | `TEXT_TOO_LONG`                    |
| Notes per annotation                         | 1   | 32                 | `TOO_MANY_ITEMS`                   |
| Voices per measure                           | 1   | 4                  | `TOO_MANY_ITEMS`                   |
| Events per voice                             | 1   | 64                 | `TOO_MANY_ITEMS`                   |
| Notes per chord                              | 2   | 10                 | `TOO_MANY_ITEMS`                   |
| Title                                        | 1   | 120 characters     | `TEXT_TOO_LONG`                    |
| Tags / tag length                            | 0/1 | 16 / 40 characters | `TOO_MANY_ITEMS` / `TEXT_TOO_LONG` |
| Harmony events, slurs, dynamics, pedal spans | 0   | 256, 128, 256, 64  | `TOO_MANY_ITEMS`                   |
| Scale-degree labels                          | 0   | 512                | `TOO_MANY_ITEMS`                   |
| Chord alterations / alteration length        | 0/1 | 4 / 8 characters   | `TOO_MANY_ITEMS` / `TEXT_TOO_LONG` |
| Roman numeral                                | 1   | 16 characters      | `TEXT_TOO_LONG`                    |
| Chord display, harmonic function, swing text | 1   | 32 characters      | `TEXT_TOO_LONG`                    |
| Scale-degree display                         | 1   | 8 characters       | `TEXT_TOO_LONG`                    |
| Articulations per note                       | 0   | 4 (no repeats)     | `TOO_MANY_ITEMS`                   |

Longer music is split into several scores (PRD §7).

## 14. Errors

```ts
type DomainError = {
  code:
    | 'SCORE_VALIDATION_FAILED'
    | 'MVP_LIMIT_EXCEEDED'
    | 'INVALID_OPERATION' // ADR-002 edit pipeline (#3)
    | 'TARGET_NOT_FOUND' // ADR-002 edit pipeline (#3)
    | 'REVISION_CONFLICT'; // ADR-002 edit pipeline (#3)
  details: Array<{
    code: DetailCode;
    path: Array<string | number>; // JSON path into the submitted document
    message: string;
    ids?: string[]; // stable IDs involved
  }>;
};
type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };
```

- `validateScoreSpec(input: unknown): Result<ScoreSpec>` never throws and
  reports **every** problem it finds. First it parses the schema (shape, scalar ranges, limits).
  Only a shape-valid document then goes through the semantic checks (§2-§11).
- Top-level code: `MVP_LIMIT_EXCEEDED` when every detail is a limit detail
  (§13); otherwise `SCORE_VALIDATION_FAILED`.
- Detail codes:
  - schema: `UNSUPPORTED_VERSION`, `INVALID_TYPE` (wrong JSON type, including
    a missing field), `INVALID_VALUE` (range, enum or literal, format, blank
    text; also a missing enumerated field), `UNKNOWN_FIELD`;
  - structure: `DUPLICATE_ID`, `STAFF_HANDS_INVALID`,
    `MEASURE_ALIGNMENT_MISMATCH`, `MEASURE_NUMBER_INVALID`,
    `MEASURE_KIND_INVALID`;
  - rhythm and pitch: `VOICE_DURATION_MISMATCH`, `TUPLET_GROUP_INVALID`,
    `PITCH_OUT_OF_RANGE`, `CHORD_DUPLICATE_PITCH`, `TIE_UNMATCHED`;
  - references: `REFERENCE_NOT_FOUND`, `REFERENCE_KIND_MISMATCH`,
    `REFERENCE_DUPLICATE`, `SPAN_ORDER_INVALID`, `SPAN_CROSS_STAFF`,
    `SPAN_OVERLAP`, `POSITION_OUT_OF_RANGE`, `ATTACHMENT_CONFLICT`,
    `ANNOTATION_COLOR_CONFLICT`;
  - limits: `TOO_MANY_STAVES`, `TOO_MANY_MEASURES`, `TOO_MANY_ANNOTATIONS`,
    `TOO_MANY_ITEMS`, `TEXT_TOO_LONG`;
  - edit pipeline only (#3, `applyScoreEdit`, see
    [SCORE_OPERATIONS_V1.md](SCORE_OPERATIONS_V1.md) §8):
    `OPERATION_INVALID`, `REVISION_MISMATCH`. `validateScoreSpec` never emits
    them.
- **Safe output.** Messages never quote free text from the input (titles,
  annotation text, colors as submitted). They mention only IDs (already
  pattern-checked), schema keys, spellings and fractions. Unknown keys in a
  path are replaced by `<invalid-key>` unless they are short identifier-like
  keys.

## 15. Canonical output and immutability

- `validateScoreSpec` **never mutates its input**. On success it returns a new
  object graph (no shared references with the input) that is **deeply
  frozen** and typed `DeepReadonly`.
- The output is canonical. Missing clefs are filled from the hand (§2) and
  colors become lowercase `#rrggbb` (§11). Every other field is kept exactly
  as submitted, including fractions that are not in lowest terms. Optional
  fields are never added: `dots`, `kind`, `offset`, `playbackFeel`, the swing
  `subdivision` and `ratio` keep their documented defaults while absent.
  Validating a canonical document returns an equal document.
- Optional keys are exact: a key that is present must hold a value. An
  explicit `undefined` is rejected like a missing required field
  (`INVALID_TYPE`, or `INVALID_VALUE` for enumerated fields), which keeps JSON
  round-trips lossless.
- All objects are closed. Unknown keys, such as layout coordinates, VexFlow or
  SpessaSynth objects, or seconds, are `UNKNOWN_FIELD` (ADR-001 invariants 13
  and 14).
- Helpers (`fraction` arithmetic, pitch helpers, `buildScoreIndex`) are pure.
  Edits (#3) build a new document and validate the whole result; they cannot
  modify a validated score in place.

## 16. Out of scope for v1

Ornaments, grace notes, nested or exotic tuplets beyond §5.1, tempo changes
inside a score, lyrics, multiple instruments, cross-staff slurs/hairpins,
engraving overrides. ADR-001 "Deliberately out of scope" still applies.

## 17. Implementation map

| Concern                                | Module (`packages/music-domain/src`) |
| -------------------------------------- | ------------------------------------ |
| Schema, inferred types, limits         | `schema.ts`, `limits.ts`             |
| Validation pipeline and invariants     | `validate.ts`, `schema-issues.ts`    |
| Exact rational time, durations, meters | `rational.ts`, `duration.ts`         |
| Written pitch                          | `pitch.ts`                           |
| Colors                                 | `color.ts`                           |
| Stable-ID index                        | `score-index.ts`                     |
| Errors                                 | `errors.ts`                          |
| ScoreOperations v1 (edit pipeline)     | `operations/` (SCORE_OPERATIONS_V1)  |

The fixtures (F01-F11 and one rich wire fixture) and their independent
oracles are in `packages/test-fixtures`. The SPEC-01..07 tests are in
`packages/test-fixtures/test/`, because `music-domain` may not import any
workspace package, its tests included (see `.dependency-cruiser.cjs`).
