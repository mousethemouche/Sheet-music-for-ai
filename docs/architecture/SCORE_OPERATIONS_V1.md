# ScoreOperations v1

Exact contract of the typed score edits of issue #3.
[ADR-002](ADR-002-score-operations.md) remains the decision record; this page
fixes the shapes and behaviors it leaves open. The implementation is
`packages/music-domain/src/operations` (`applyScoreEdit`), and the rules below
are what it enforces. Document terms (bar, measure, note, event) and every
ScoreSpec rule come from [SCORESPEC_V1_SEMANTICS.md](SCORESPEC_V1_SEMANTICS.md).

## 1. Edit pipeline

```ts
applyScoreEdit(score: ScoreSpec, command: unknown): Result<ScoreSpec>;

type ScoreEdit = {
  expectedRevision: number; // integer >= 0
  operations: ScoreOperation[]; // 1..64, applied in order
};
```

The command is the domain part of ADR-002's `EditScoreCommand`: the
application layer (#13) resolves `scoreId`, loads the score and passes
`{ expectedRevision, operations }` (the object is closed, so a `scoreId` key is
`UNKNOWN_FIELD`).

| Step | Check                                                     | Failure                                               |
| ---- | --------------------------------------------------------- | ----------------------------------------------------- |
| 1    | Command schema (shapes, scalars, limits of the payloads)  | `INVALID_OPERATION` (or `MVP_LIMIT_EXCEEDED`, see §8) |
| 2    | `expectedRevision === score.revision`                     | `REVISION_CONFLICT`                                   |
| 3    | Each operation, in order, on a private copy               | `TARGET_NOT_FOUND`, `INVALID_OPERATION`               |
| 4    | `validateScoreSpec` on the final document                 | `SCORE_VALIDATION_FAILED` (or `MVP_LIMIT_EXCEEDED`)   |
| 5    | `revision = score.revision + 1`, once for the whole batch | -                                                     |

- **Atomic.** The first failure ends the edit and only an error is returned.
  There is no partial result and nothing to roll back: the function is pure.
- **Immutable.** Neither `score` nor `command` is mutated (both may be deeply
  frozen). The success value is a new, deeply frozen canonical score (colors
  canonical, clefs filled), exactly as `validateScoreSpec` returns it.
- **Intermediate states may be invalid.** Only the final document is
  validated, so an edit can, for example, change the meter and then replace
  the bars, or add a slur before inserting the bar that holds its end note.
- **Revision.** Every successful edit returns revision + 1, even when its
  operations changed nothing (§3.3). The stale-revision race against storage
  is #9/#13.

## 2. Targeting

Operations name elements by stable ID only: staff, bar (measure), note (a
`NoteEvent` or one chord member), event, harmony event, slur, dynamic, pedal
span, scale-degree label, annotation. There are no positions, indices, paths,
renderer coordinates or human-relative selectors ("third note of bar 2"): the
AI/application resolves those before building the command.

Two kinds of IDs appear in an operation:

- **Target**: the element the operation changes (`noteId` of
  `set_fingering`, `slurId` of `remove_slur`, the bars of a structural
  operation, the selection of `transpose`...). It must exist when the
  operation is applied, after the earlier operations of the batch:
  `TARGET_NOT_FOUND` otherwise, with detail `REFERENCE_NOT_FOUND` (no element
  has the ID) or `REFERENCE_KIND_MISMATCH` (the ID names another kind, e.g. a
  chord ID where a chord member is needed).
- **Stored reference**: an ID the operation writes into the document (slur,
  dynamic and pedal anchors, `scaleDegree.noteId`, `annotation.noteIds`, a
  harmony event's `measureId`, the IDs of new content). It is checked by the
  final validation (`REFERENCE_NOT_FOUND`, `DUPLICATE_ID`...), so the batch may
  create the referenced content before or after.

## 3. General rules

### 3.1 Payload conventions

- Required score values are flattened, as in ADR-002: `set_tempo { bpm }`,
  `set_time_signature { numerator, denominator }`.
- Optional score values are given whole under their ScoreSpec name, and
  `null` removes them: `keySignature`, `tonalContext`, `playbackFeel`,
  `title`.
- Layer items (slur, dynamic, pedal span, scale-degree label, annotation) are
  given as complete ScoreSpec items and reuse the ScoreSpec schemas. Removals
  take the item ID (`slurId`, `dynamicId`...).
- An optional list left empty by an operation is removed from the document
  (`tags`, `articulations`, `harmony`, `slurs`, `dynamics`, `pedal`,
  `scaleDegrees`), so "none" has one form. `annotations` is required and stays
  `[]`.
- ID lists in an operation (`measureIds`, `staffIds`) never repeat an ID
  (`INVALID_VALUE`).

### 3.2 `set_*`, `add_*`, `update_*`, `remove_*`

- `set_<layer>` with an item (`set_dynamic`, `set_pedal`, `set_scale_degree`)
  creates the item when its ID is new and **replaces it completely** when it
  exists (in place, keeping its position in the list).
- `add_slur` and `add_annotation` always create; an ID already in use fails
  the final validation (`DUPLICATE_ID`).
- `update_annotation` changes only the given fields of an existing
  annotation.
- `remove_<layer>` needs an existing item.

### 3.3 No-ops and repeated removals

- An operation whose result equals the current state (setting the current
  tempo, `set_title` null without a title, removing a fingering the note does
  not have, `remove_chord_symbol` on a harmony event without chord symbol,
  `transpose` by 0) **succeeds** and changes nothing; the edit still returns
  revision + 1.
- Removing an item that does not exist is **`TARGET_NOT_FOUND`**, whether it
  never existed, was removed by an earlier revision, or was removed earlier in
  the same batch. A stale AI view of the score is surfaced, not ignored.
- The distinction: clearing an _attribute_ of an existing target is
  idempotent; removing an _identified item_ requires the item.

### 3.4 Nothing cascades

No operation silently removes or rewrites other material. Structural
operations leave references into removed content in place; the final
validation then rejects the edit with every dangling reference
(`REFERENCE_NOT_FOUND` with its path and ID), and the edit must repair them
explicitly in the same batch: remove the slur/dynamic/pedal/label/harmony/
annotation, update the annotation's `noteIds`, or reuse the removed IDs in the
new content. Teaching material is never discarded implicitly (US-D1: the AI
updates or removes annotations that no longer match).

## 4. Operation reference

Types below are the validated shapes (`ScoreOperation`); `Fraction`,
`PitchClass`, `ChordSymbol`, `HarmonicAnalysis`, `Voice`, `Slur`,
`DynamicEvent`, `PedalEvent`, `ScaleDegreeLabel`, `Annotation` and the other
value types are the ScoreSpec v1 types (ADR-001) with the same ranges and
limits.

### 4.1 Global score operations

| Operation            | Shape                                                         | Effect                                                                  |
| -------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `set_tempo`          | `{ type, bpm: number }` (20..400, quarter notes per minute)   | Sets `tempo`.                                                           |
| `set_time_signature` | `{ type, numerator: 1..32, denominator: 1\|2\|4\|8\|16\|32 }` | Sets the score meter only (§5.4).                                       |
| `set_key_signature`  | `{ type, keySignature: { fifths: -7..7 } \| null }`           | Sets or removes the key signature. Stored pitches are never respelled.  |
| `set_tonal_context`  | `{ type, tonalContext: { tonic: PitchClass, mode } \| null }` | Sets or removes the tonal context. Not cross-checked with key or notes. |
| `set_playback_feel`  | `{ type, playbackFeel: PlaybackFeel \| null }`                | Sets or removes the feel (P-02). Written durations are never rewritten. |
| `set_title`          | `{ type, title: string \| null }` (1..120 characters)         | Sets or removes `metadata.title`.                                       |
| `set_tags`           | `{ type, tags: string[] }` (0..16, each 1..40 characters)     | Replaces the tag list; `[]` removes it.                                 |

### 4.2 Structural operations

```ts
type BarContent = {
  id: string; // bar ID, shared by every staff
  kind?: 'full' | 'pickup' | 'incomplete';
  timeSignature?: TimeSignature; // local meter of this bar
  actualDuration?: Fraction; // pickup/incomplete bars
  staves: Array<{ staffId: string; voices: Voice[] }>; // every staff exactly once
};

type InsertMeasures = {
  type: 'insert_measures';
  position: 'before' | 'after';
  measureId: string; // target bar
  bars: BarContent[]; // 1..32
};
type ReplaceMeasures = {
  type: 'replace_measures';
  measureIds: string[]; // target bars: one contiguous range, 1..32, any order
  bars: BarContent[]; // 1..32 replacement bars (the count may differ)
};
type DeleteMeasures = {
  type: 'delete_measures';
  measureIds: string[]; // target bars, 1..32, need not be contiguous
};
```

See §5.

### 4.3 Transposition

```ts
type Transpose = {
  type: 'transpose';
  semitones: number; // integer, -87..87 (up is positive)
  target: {
    measureIds?: string[]; // absent: every bar
    staffIds?: string[]; // absent: every staff
  }; // {} is the whole score; both lists: their intersection
};
```

See §6.

### 4.4 Harmony and pedagogical operations

| Operation                  | Shape                                                                            | Effect                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_chord_symbol`         | `{ type, harmonyId, measureId?, offset?: Fraction, chord: ChordSymbol }`         | Existing harmony event: replaces its chord symbol, keeps its analysis; a given `measureId`/`offset` moves the event. New ID: creates `{ id, measureId, offset?, chord }`; `measureId` is then required (`INVALID_OPERATION` otherwise), `offset` absent means 0. |
| `remove_chord_symbol`      | `{ type, harmonyId }`                                                            | Removes the chord symbol, keeps the analysis. An event left with neither part is removed.                                                                                                                                                                        |
| `set_harmonic_analysis`    | `{ type, harmonyId, measureId?, offset?: Fraction, analysis: HarmonicAnalysis }` | Same as `set_chord_symbol` for the Roman analysis; the chord symbol is kept.                                                                                                                                                                                     |
| `remove_harmonic_analysis` | `{ type, harmonyId }`                                                            | Removes the analysis, keeps the chord symbol; an empty event is removed.                                                                                                                                                                                         |
| `set_fingering`            | `{ type, noteId, fingering: 1..5 }`                                              | Sets the fingering of one note or one chord member (a chord ID is `REFERENCE_KIND_MISMATCH`).                                                                                                                                                                    |
| `remove_fingering`         | `{ type, noteId }`                                                               | Removes it (no-op when absent).                                                                                                                                                                                                                                  |
| `set_articulations`        | `{ type, noteId, articulations: Articulation[] }` (0..4, distinct)               | Replaces the note's articulation set; `[]` removes it.                                                                                                                                                                                                           |
| `add_slur`                 | `{ type, slur: Slur }`                                                           | Appends the slur. Anchors, order and staff are checked on the final document.                                                                                                                                                                                    |
| `remove_slur`              | `{ type, slurId }`                                                               | Removes it.                                                                                                                                                                                                                                                      |
| `set_dynamic`              | `{ type, dynamic: DynamicEvent }` (mark or hairpin)                              | Creates or completely replaces `dynamic.id`.                                                                                                                                                                                                                     |
| `remove_dynamic`           | `{ type, dynamicId }`                                                            | Removes it.                                                                                                                                                                                                                                                      |
| `set_pedal`                | `{ type, pedal: PedalEvent }`                                                    | Creates or completely replaces `pedal.id`.                                                                                                                                                                                                                       |
| `remove_pedal`             | `{ type, pedalId }`                                                              | Removes it.                                                                                                                                                                                                                                                      |
| `set_scale_degree`         | `{ type, scaleDegree: ScaleDegreeLabel }`                                        | Creates or completely replaces `scaleDegree.id`.                                                                                                                                                                                                                 |
| `remove_scale_degree`      | `{ type, scaleDegreeId }`                                                        | Removes it.                                                                                                                                                                                                                                                      |
| `add_annotation`           | `{ type, annotation: Annotation }`                                               | Appends it; its color is stored canonical (`DodgerBlue` becomes `#1e90ff`).                                                                                                                                                                                      |
| `update_annotation`        | `{ type, annotationId, color?, noteIds?, text? }` (at least one field)           | Replaces the given fields.                                                                                                                                                                                                                                       |
| `remove_annotation`        | `{ type, annotationId }`                                                         | Removes it.                                                                                                                                                                                                                                                      |

A note attribute (fingering, articulations) and a teaching color always
belong to one written note: to finger or color a chord, target its members.
Chord symbol and Roman analysis are independent parts of one harmony event.
A slur changes phrasing only (never pitch, rhythm or ties), and the feel
changes playback only (never written durations).

## 5. Structural semantics

### 5.1 New bars

- A `BarContent` is one bar for **every staff at once**: the bar-level fields
  (`id`, `kind`, `timeSignature`, `actualDuration`) are given once, so the
  hands are aligned by construction. `staves` lists each staff of the score
  exactly once (`INVALID_OPERATION` if one is missing or repeated;
  `TARGET_NOT_FOUND` for an unknown `staffId`). Its voices are ordinary
  ScoreSpec voices.
- There is no `number`: after every structural operation all bars are
  renumbered 1..n (a pickup is bar 1).
- A new bar may use a new ID or **reuse the ID of a bar it replaces** (and
  the IDs of the notes it replaces). Reusing IDs keeps harmony events, slurs,
  dynamics, pedal spans, labels and annotations attached; new IDs require the
  batch to repair those references (§3.4).
- Every other ScoreSpec rule (voice fill, pickup only first, tuplets, ties,
  33-bar limit, duplicate IDs...) is checked on the final document.

### 5.2 Insert, replace, delete

- `insert_measures` puts `bars` before or after the target bar in every staff.
  Before the first bar and after the last bar are the edge positions.
- `replace_measures` removes one contiguous range of bars (`INVALID_OPERATION`
  if the listed bars leave a gap) from every staff and puts `bars` in its
  place; the replacement may have more or fewer bars.
- `delete_measures` removes the listed bars from every staff. Deleting every
  bar is `INVALID_OPERATION` (a score keeps at least one bar).
- Unaffected bars keep their IDs, content and every attached layer; only
  their `number` changes.
- A tie into or out of a replaced/inserted/deleted range must still pair on
  the final document, otherwise `TIE_UNMATCHED` (ties are never removed
  silently).

### 5.3 Pickup and incomplete bars, tuplets

Rewriting a pickup, an incomplete bar or a tuplet is done with
`replace_measures` (ADR-002 non-goals): the replacement declares `kind` and
`actualDuration` explicitly. Inserting before a pickup makes it a later bar,
which the final validation rejects (`MEASURE_KIND_INVALID`).

### 5.4 Meter changes

`set_time_signature` changes the score meter only. Bars without a local
override must still fit it; local overrides (`measure.timeSignature`) and
notes are untouched. A meter change that the music does not fit is
`SCORE_VALIDATION_FAILED` with one `VOICE_DURATION_MISMATCH` per voice, and
nothing is applied. To change 4/4 to 7/4, send `set_time_signature` and a
`replace_measures` with 7/4 content **in the same batch**; the intermediate
state (7/4 meter, 4/4 bars) is never validated. A local meter change is a
`replace_measures` whose bar carries `timeSignature`.

## 6. Transposition

### 6.1 Selection

The selection is a set of staff x bar cells: `staffIds` (default all) times
`measureIds` (default all). Every written note in a selected cell (notes and
chord members) moves by `semitones`; rests, rhythm, IDs, ties, fingering,
articulations and every layer stay unchanged. Unknown staff or bar IDs are
`TARGET_NOT_FOUND`. The selection is the **whole score** when it contains
every staff and every bar (`target: {}` or explicit full lists).

### 6.2 Spelling policy (key-aware)

A shift is spelled with **one interval** for the whole operation, chosen from
the current key signature (`fifths`, or 0 when absent):

1. A multiple of 12 semitones is an octave shift: every spelling is kept.
2. Otherwise the candidate intervals are the spellings of the shift on the
   circle of fifths (for +1: minor second, -5 fifths, or augmented unison, +7
   fifths; for +2: major second, +2, or diminished third, -10...). The chosen
   interval is the one whose transposed key signature (`fifths + interval`) is
   closest to C (fewest accidentals); a tie (6 sharps or 6 flats) goes to the
   flat key.
3. Each note moves by that interval: the letter moves by the interval's letter
   distance and the accidental is whatever keeps the exact number of
   semitones, so the sounding key moves by exactly `semitones`.
4. If that would need a triple sharp or flat, the note is respelled on the
   neighboring letter in the direction of the excess (C### becomes D#).

| Key      | Shift | Interval / new key       | Example                   |
| -------- | ----- | ------------------------ | ------------------------- |
| C (none) | +2    | major 2nd, D major       | C4-E4-G4 -> **D4-F#4-A4** |
| C        | -3    | minor 3rd down, A major  | C4-E4-G4 -> A3-C#4-E4     |
| C        | +1    | minor 2nd, Db major      | C4-E4-G4 -> Db4-F4-Ab4    |
| Bb (-2)  | +1    | augmented unison, B (+5) | C4-E4-G4 -> C#4-E#4-G#4   |
| C        | +6    | diminished 5th, Gb (-6)  | C4-E4-G4 -> Gb4-Bb4-Db5   |
| any      | +12   | octave                   | C4-E4-G4 -> C5-E5-G5      |

Tied notes have the same written pitch and move by the same interval, so a tie
whose two notes are both selected stays valid, including ties from chord
members. A selection that moves only one end of a tie fails the final
validation (`TIE_UNMATCHED`). A note that would leave A0-C8 rejects the
operation: `INVALID_OPERATION` with one `PITCH_OUT_OF_RANGE` detail per note
(path `["operations", i, "semitones"]`, `ids: [noteId]`).

### 6.3 Harmonic context never goes stale

| Shift                            | Key signature, tonal context                                    | Chord symbols                                                 | Roman numerals, functions, scale-degree labels |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Octave (any selection)           | unchanged                                                       | unchanged                                                     | unchanged (no pitch class changes)             |
| Whole score, not an octave       | moved: `fifths + interval` (when present); tonic moved likewise | root and bass moved by the interval; `display` rewritten      | unchanged: they are relative to the moved key  |
| Part of the score, not an octave | unchanged (the passage is written with explicit accidentals)    | **rejected** if a harmony event is attached to a selected bar | **rejected** if a label is on a moved note     |

- A rejection is `INVALID_OPERATION`, one `OPERATION_INVALID` detail per
  stale item (path `["operations", i, "target"]`, `ids: [harmonyId]` or
  `[scaleDegreeId]`). The edit removes or replaces those items **before** the
  `transpose` in the same batch, and may set new ones after it.
- **Chord display text** is rewritten only when it is safely recognizable:
  it starts with the root's name (ASCII accidentals, e.g. `F#`, `Bb`),
  followed by a suffix with no other note name and no `/`, and ends with
  `/bass` exactly when the chord has a structured `bass`. `Dm7` becomes `Em7`,
  `G7(b9)` becomes `A7(b9)`, `G/B` becomes `A/C#`. Any other display (for
  example `Dm7/C` without a structured bass) rejects the whole-score transposition
  with `OPERATION_INVALID` on that harmony event: replace the chord symbol (or
  drop its display) before transposing.
- Annotation text is free text and is not interpreted. Annotations keep their
  notes (IDs are preserved); the AI updates their text with
  `update_annotation` when it names pitches.

## 7. Annotations and P-03 in a batch

P-03 is checked on the final document only. An `add_annotation` or
`update_annotation` that gives a note a second canonical color rejects the
whole edit (`SCORE_VALIDATION_FAILED`, `ANNOTATION_COLOR_CONFLICT` with
`ids: [noteId, ...annotationIds sorted]`); there is no "last wins". The same
batch may repair the conflict explicitly (narrow or recolor or remove the
other annotation), in which case the edit succeeds. A replacement or deletion
that removes annotated notes needs the same explicit repair (§3.4).

## 8. Errors

`Result<ScoreSpec>` with the ScoreSpec `DomainError` shape
(SCORESPEC_V1_SEMANTICS.md §14). Paths of steps 1-3 point into the command
(`["operations", i, ...]`); paths of step 4 point into the resulting document.

| Top-level code            | When                                                                                                       | Detail codes                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `INVALID_OPERATION`       | Malformed command: unknown `type`, empty batch, unknown field (`op`, `path`, `value`), wrong type or range | `INVALID_VALUE`, `INVALID_TYPE`, `UNKNOWN_FIELD`                       |
| `INVALID_OPERATION`       | Well-formed operation that cannot apply to the current state                                               | `OPERATION_INVALID`; `PITCH_OUT_OF_RANGE` for transposition            |
| `MVP_LIMIT_EXCEEDED`      | Every problem is an exceeded limit (command or result), e.g. 65 operations or a 33-bar result              | `TOO_MANY_ITEMS`, `TOO_MANY_MEASURES`, `TEXT_TOO_LONG`, ...            |
| `REVISION_CONFLICT`       | `expectedRevision` differs from the score revision                                                         | `REVISION_MISMATCH` at `["expectedRevision"]`, `ids: [scoreId]`        |
| `TARGET_NOT_FOUND`        | A target ID does not exist (§2)                                                                            | `REFERENCE_NOT_FOUND`, `REFERENCE_KIND_MISMATCH`                       |
| `SCORE_VALIDATION_FAILED` | The final document breaks a ScoreSpec rule                                                                 | every ScoreSpec validation code, including `ANNOTATION_COLOR_CONFLICT` |

Messages never quote free text from the command; they mention IDs (already
pattern-checked), schema keys, spellings and numbers only.

## 9. Scope, ownership and tests

- The domain function is pure and storage-free. Persistence, the atomic
  revision write and the database compare-and-swap race are #9; the
  `EditScore` use case and the MCP `edit_score` transport (stale revision on
  the wire, persisted rollback) are #13; lifecycle/owner checks are #18;
  promotion/TTL races are #22.
- Audible expression (dynamics, pedal, articulations, swing) is #6; how the
  client replaces a revision is #7.
- Unit tests (`packages/test-fixtures/test/ops-0N-*.test.ts`, because
  music-domain may not import the fixtures package):

| Test   | File                                   | Covers                                                                   |
| ------ | -------------------------------------- | ------------------------------------------------------------------------ |
| OPS-01 | `ops-01-dispatch.test.ts`              | one before/operation/after case per operation type; malformed commands   |
| OPS-02 | `ops-02-batch-revision.test.ts`        | revision + 1 per batch, stale revision, atomic failure, invalid interim  |
| OPS-03 | `ops-03-structure.test.ts`             | insert/replace/delete across hands, edges, limits, meter + replacement   |
| OPS-04 | `ops-04-references-colors.test.ts`     | dangling references and P-03 rejected; explicit repairs accepted         |
| OPS-05 | `ops-05-transposition.test.ts`         | spelling policy, descending, octave, range, ties, harmonic context       |
| OPS-06 | `ops-06-semantic-independence.test.ts` | per-member attributes, chord/Roman independence, slur/feel, no-op policy |

| Concern                               | Module (`packages/music-domain/src/operations`) |
| ------------------------------------- | ----------------------------------------------- |
| Command and operation schemas, limits | `schema.ts`                                     |
| Pipeline and dispatch                 | `apply.ts`                                      |
| Working copy, lookups, errors         | `draft.ts`                                      |
| Global operations                     | `global.ts`                                     |
| Insert/replace/delete                 | `structure.ts`                                  |
| Transposition and spelling            | `transpose.ts`, `spelling.ts`                   |
| Harmony, note attributes, layers      | `layers.ts`                                     |
