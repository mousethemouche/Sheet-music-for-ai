# ADR-002 — ScoreOperations as the canonical mutation contract

- **Status:** Accepted
- **Date:** 2026-09-28
- **Decision owners:** Product / Engineering
- **Scope:** MVP v1

## Context

`ScoreSpec v1` is the canonical music-domain representation of a score. The product also needs a safe, AI-friendly way to modify an existing score through MCP, REST, or future interfaces.

Allowing the model or any external interface to submit arbitrary JSON Patch operations would expose the internal document shape directly, make invariants harder to protect, couple clients to storage details, and make destructive or stale edits easier to apply accidentally.

The mutation API therefore needs its own explicit domain contract.

## Decision

We will define a versioned, closed set of typed commands named **`ScoreOperation`**. All edits to an existing `ScoreSpec` MUST be expressed as one or more domain operations and applied through the application/domain layer.

No external interface may mutate canonical score JSON directly.

```text
Natural language
      |
      v
LLM / MCP / REST
      |
      v
ScoreOperation[]
      |
      v
EditScore use case
      |
      v
Validate expectedRevision
      |
      v
Apply operations atomically
      |
      v
Validate resulting ScoreSpec
      |
      v
revision + 1
```

## Command envelope

Edits are submitted with optimistic concurrency:

```ts
type EditScoreCommand = {
  scoreId: string
  expectedRevision: number
  operations: ScoreOperation[]
}
```

If `expectedRevision` does not match the current score revision, the command fails with a structured `REVISION_CONFLICT` error and no operation is applied.

All operations in a command are atomic: either every operation succeeds and the resulting score is valid, or the complete edit is rejected.

## MVP operation set

The v1 operation set is intentionally small. It should describe user intent, not low-level JSON structure.

### Global score operations

- `set_tempo`
- `set_time_signature`
- `set_key_signature`
- `set_tonal_context`
- `set_playback_feel`
- `set_title`
- `set_tags`

### Structural operations

- `insert_measures`
- `replace_measures`
- `delete_measures`

For the MVP, measure-level replacement is the primary escape hatch for complex generative edits. We prefer replacing one or more complete musical measures over introducing many low-level note-array mutation commands prematurely.

### Musical transformation operations

- `transpose`

Targets may reference the whole score or explicit stable IDs such as staff/measure IDs. The operation describes musical intent (for example, semitone transposition), while the domain implementation is responsible for preserving valid written pitch and score invariants.

### Harmony / pedagogical operations

- `set_chord_symbol`
- `remove_chord_symbol`
- `set_harmonic_analysis`
- `remove_harmonic_analysis`
- `set_fingering`
- `remove_fingering`
- `set_articulations`
- `add_slur`
- `remove_slur`
- `set_dynamic`
- `remove_dynamic`
- `set_pedal`
- `remove_pedal`
- `set_scale_degree`
- `remove_scale_degree`
- `add_annotation`
- `update_annotation`
- `remove_annotation`

These operations target stable domain IDs. They MUST NOT contain renderer coordinates or VexFlow-specific identifiers.

## Representative TypeScript shape

Exact shapes, targeting, spelling, no-op and error behavior are fixed in [SCORE_OPERATIONS_V1.md](SCORE_OPERATIONS_V1.md); the types below were refined accordingly. Value types (`KeySignature`, `ChordSymbol`, `Voice`, `Slur`, ...) are the ScoreSpec v1 types of ADR-001.

```ts
type ScoreOperation =
  | { type: "set_tempo"; bpm: number }
  | { type: "set_time_signature"; numerator: number; denominator: number }
  | { type: "set_key_signature"; keySignature: KeySignature | null }
  | { type: "set_tonal_context"; tonalContext: TonalContext | null }
  | { type: "set_playback_feel"; playbackFeel: PlaybackFeel | null }
  | { type: "set_title"; title: string | null }
  | { type: "set_tags"; tags: string[] }
  | { type: "insert_measures"; position: "before" | "after"; measureId: string; bars: BarContent[] }
  | { type: "replace_measures"; measureIds: string[]; bars: BarContent[] }
  | { type: "delete_measures"; measureIds: string[] }
  | { type: "transpose"; semitones: number; target: { measureIds?: string[]; staffIds?: string[] } }
  | { type: "set_chord_symbol"; harmonyId: string; measureId?: string; offset?: Fraction; chord: ChordSymbol }
  | { type: "remove_chord_symbol"; harmonyId: string }
  | { type: "set_harmonic_analysis"; harmonyId: string; measureId?: string; offset?: Fraction; analysis: HarmonicAnalysis }
  | { type: "remove_harmonic_analysis"; harmonyId: string }
  | { type: "set_fingering"; noteId: string; fingering: Fingering }
  | { type: "remove_fingering"; noteId: string }
  | { type: "set_articulations"; noteId: string; articulations: Articulation[] }
  | { type: "add_slur"; slur: Slur }
  | { type: "remove_slur"; slurId: string }
  | { type: "set_dynamic"; dynamic: DynamicEvent }
  | { type: "remove_dynamic"; dynamicId: string }
  | { type: "set_pedal"; pedal: PedalEvent }
  | { type: "remove_pedal"; pedalId: string }
  | { type: "set_scale_degree"; scaleDegree: ScaleDegreeLabel }
  | { type: "remove_scale_degree"; scaleDegreeId: string }
  | { type: "add_annotation"; annotation: Annotation }
  | { type: "update_annotation"; annotationId: string; color?: string; noteIds?: string[]; text?: string }
  | { type: "remove_annotation"; annotationId: string }

// One new bar for every staff at once (bar numbers are reassigned).
type BarContent = {
  id: string
  kind?: "full" | "pickup" | "incomplete"
  timeSignature?: TimeSignature
  actualDuration?: Fraction
  staves: Array<{ staffId: string; voices: Voice[] }>
}
```

Example:

```json
{
  "scoreId": "score_123",
  "expectedRevision": 7,
  "operations": [
    {
      "type": "transpose",
      "target": {
        "measureIds": ["m3", "m4"]
      },
      "semitones": 2
    }
  ]
}
```

## Targeting rules

Operations target domain entities through stable IDs whenever possible:

- `scoreId`
- `staffId`
- `measureId`
- `voiceId`
- `eventId`
- `noteId`
- `annotationId`

Human-relative selectors such as “third note in bar 2” MUST be resolved by the AI/application layer before applying the operation; they are not part of the canonical mutation contract.

## Validation

Every edit follows this pipeline:

1. Validate command schema.
2. Load current score.
3. Check `expectedRevision`.
4. Validate operation preconditions and targets.
5. Apply all operations to an in-memory copy.
6. Run full `ScoreSpec` domain validation on the result.
7. Persist only if the result is valid.
8. Increment revision exactly once per successful command.

Expected structured errors include at least:

- `REVISION_CONFLICT`
- `TARGET_NOT_FOUND`
- `INVALID_OPERATION`
- `SCORE_VALIDATION_FAILED`
- `MVP_LIMIT_EXCEEDED`

## Identity rules

Operations MUST preserve stable IDs for musical objects that remain conceptually unchanged.

A measure replacement may introduce new IDs for newly generated material, but unaffected measures, notes, annotations, and other entities retain their previous identity.

## Renderer and playback independence

`ScoreOperation` is part of the music/application contract and MUST NOT depend on:

- VexFlow types or coordinates;
- SpessaSynth or MIDI-library types;
- MCP SDK types;
- NestJS or persistence-specific DTOs.

The flow remains:

```text
ScoreOperation[]
      |
      v
ScoreSpec
   /      \
  v        v
VexFlow   Playback compiler
```

Rendering and playback react to the resulting canonical score; they are never mutated directly by an operation.

## MCP implications

The MCP `edit_score` tool will accept the command envelope and typed operations rather than arbitrary score JSON patches.

The MCP layer is responsible only for transport/schema translation. It delegates execution to the same `EditScore` application use case used by any REST or internal interface.

## Non-goals for v1

We will NOT initially add one operation for every possible note-level edit. In particular, do not add generic operations such as:

- `set_json_path`
- `replace_array_item`
- `move_svg_element`
- renderer-specific mutations
- unrestricted JSON Patch

If a natural-language edit cannot be expressed cleanly by the v1 semantic operations, `replace_measures` is the safe generative fallback for the affected musical passage.

Tuplet changes, pickup/incomplete-measure rewrites, and other deeply rhythmic edits may use `replace_measures` rather than requiring low-level note-array patch operations.

Additional note-level operations may be introduced later only when repeated real product use cases justify them.

## Consequences

### Positive

- The AI gets a small, explicit action vocabulary.
- Domain invariants remain enforceable after every edit.
- Clients do not couple to internal JSON layout.
- VexFlow and SpessaSynth remain replaceable adapters.
- Optimistic concurrency prevents stale model responses from silently overwriting newer changes.
- Operations are straightforward to log, test, replay, and inspect.

### Trade-offs

- Some complex edits regenerate complete measures rather than patching individual notes.
- The operation vocabulary must evolve intentionally as product use cases expand.
- Application/domain code must implement transformations such as transposition instead of delegating them to a renderer.

## Follow-up

Implementation should include:

- discriminated-union TypeScript types;
- Zod schemas for every operation;
- `EditScore` application use case;
- operation appliers/handlers;
- optimistic concurrency;
- atomic multi-operation application;
- structured errors;
- fixture-based tests proving identity preservation and domain validation;
- MCP `edit_score` integration only after this domain contract is implemented.
