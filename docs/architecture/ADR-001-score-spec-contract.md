# ADR-001 — ScoreSpec v1 as the canonical music-domain contract

- **Status:** Accepted
- **Date:** 2026-09-28
- **Decision owners:** Product / Engineering
- **Scope:** MVP v1

## Context

The product needs a stable, AI-friendly representation of short piano scores that can be:

- created and edited through natural-language requests;
- rendered by VexFlow;
- played by an independent playback engine such as SpessaSynth;
- annotated pedagogically;
- saved and restored without depending on a rendering or playback library;
- evolved without leaking infrastructure-specific types into the domain.

Using VexFlow objects, MIDI, MusicXML, alphaTab JSON, or any renderer-specific structure as the source of truth would couple the product domain to an implementation detail.

The domain therefore needs its own canonical score contract.

## Decision

We will use a versioned JSON document named **`ScoreSpec`** as the canonical representation of a score.

`ScoreSpec` describes **musical meaning and product-level metadata**, not graphical layout or audio implementation details.

VexFlow and SpessaSynth are adapters downstream of this contract and MUST NOT appear in the domain model or MCP contracts.

```text
Natural language / MCP / REST
           |
           v
      Application layer
           |
           v
        ScoreSpec
        /       \
       v         v
VexFlow adapter  Playback compiler
       |         |
       v         v
     SVG      PlaybackPlan / MIDI
                 |
                 v
          SpessaSynth adapter
```

## Architectural boundary

### ScoreSpec owns

- score identity and revision;
- musical structure;
- measures and voices;
- notes, rests and chords;
- written pitch and rhythmic duration;
- tempo and time signature;
- key signature / tonal context;
- staff/hand/clef information;
- tuplets and pickup/incomplete measures;
- swing feel;
- articulations and phrasing slurs;
- dynamics and crescendo/diminuendo;
- sustain-pedal spans;
- chord symbols;
- harmonic analysis / Roman numerals;
- melodic scale-degree labels;
- piano fingering;
- pedagogical annotations;
- stable IDs required by AI editing and UI synchronization.

### ScoreSpec does NOT own

- x/y coordinates;
- stave widths;
- note-head pixel positions;
- stem lengths;
- beam slopes;
- collision avoidance;
- SVG or Canvas primitives;
- SoundFont details;
- WebAudio nodes;
- SpessaSynth objects;
- VexFlow objects;
- renderer-specific or playback-engine-specific state.

Those concerns belong to adapters.

## ScoreSpec v1

The TypeScript examples below define the intended contract. Runtime validation will be implemented with Zod or an equivalent schema validator.

Precise semantics (units, bar alignment, local meters, pickups, tuplet groups, ties, spans, colors, limits, errors) are fixed in [SCORESPEC_V1_SEMANTICS.md](SCORESPEC_V1_SEMANTICS.md); the types below were refined accordingly.

```ts
export type ScoreSpec = {
  version: 1
  id: string
  revision: number

  metadata: {
    title?: string
    tags?: string[]
  }

  tempo: Tempo
  timeSignature: TimeSignature
  keySignature?: KeySignature
  tonalContext?: TonalContext
  playbackFeel?: PlaybackFeel

  staves: Staff[]
  harmony?: HarmonyEvent[]
  slurs?: Slur[]
  dynamics?: DynamicEvent[]
  pedal?: PedalEvent[]
  scaleDegrees?: ScaleDegreeLabel[]
  annotations: Annotation[]
}

export type Tempo = {
  bpm: number // quarter notes per minute, whatever the meter; 20..400
}

// Exact musical time in WHOLE notes (1/4 = one quarter note); never floats.
export type Fraction = {
  numerator: number
  denominator: number
}

export type TimeSignature = {
  numerator: number
  denominator: number
}

export type KeySignature = {
  fifths: -7 | -6 | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
}

export type TonalContext = {
  tonic: PitchClass
  mode:
    | "major"
    | "minor"
    | "ionian"
    | "dorian"
    | "phrygian"
    | "lydian"
    | "mixolydian"
    | "aeolian"
    | "locrian"
}

export type PlaybackFeel =
  | { type: "straight" }
  | {
      type: "swing"
      subdivision?: "eighth" | "sixteenth" // default eighth (P-02)
      ratio?: { long: number; short: number } // integers, long >= short; default 2:1 (P-02)
      displayText?: string
    }

export type Staff = {
  id: string
  hand: "right" | "left"
  clef?: "treble" | "bass" // default from hand: right treble, left bass
  measures: Measure[] // same bars (ids, kinds, meters) on every staff
}

export type Measure = {
  id: string // bar ID, shared by the aligned measure of every staff
  number: number // 1-based bar position, pickup included
  kind?: "full" | "pickup" | "incomplete"
  timeSignature?: TimeSignature // local meter for this bar only
  actualDuration?: Fraction // required for pickup/incomplete bars
  voices: Voice[]
}

export type Voice = {
  id: string
  events: MusicalEvent[]
}

export type MusicalEvent = NoteEvent | ChordEvent | RestEvent
```

## Pitch

Written pitch is stored explicitly instead of only as a MIDI number because enharmonic spelling matters to notation and pedagogy.

```ts
export type Pitch = {
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B"
  alter: -2 | -1 | 0 | 1 | 2
  octave: number
}
```

For example, `F#4` and `Gb4` may produce the same sounding MIDI pitch, but they remain distinct written pitches.

## Rhythm

Musical duration is represented semantically, not as floating-point seconds.

```ts
export type Duration = {
  value:
    | "whole"
    | "half"
    | "quarter"
    | "eighth"
    | "sixteenth"
    | "thirtySecond"
  dots?: 0 | 1 | 2
  tuplet?: {
    groupId: string // shared by the consecutive members of one group
    actual: number
    normal: number
  }
}
```

A separate timeline compiler converts durations into integer ticks for playback and synchronization.

Recommended internal resolution for v1: `PPQ = 960`.

## Notes, chords and rests

```ts
export type Fingering = 1 | 2 | 3 | 4 | 5

export type NoteEvent = {
  id: string
  type: "note"
  pitch: Pitch
  duration: Duration
  fingering?: Fingering
  articulations?: Articulation[]
  tie?: Tie
}

// Pairs with the same written pitch in the next event of the same voice.
export type Tie = {
  start?: boolean
  end?: boolean
}

export type ChordEvent = {
  id: string
  type: "chord"
  duration: Duration
  notes: Array<{
    id: string
    pitch: Pitch
    fingering?: Fingering
    articulations?: Articulation[]
    tie?: Tie // chord members are tied individually
  }>
}

export type RestEvent = {
  id: string
  type: "rest"
  duration: Duration
}
```

Individual notes inside a chord MUST have stable IDs so the product can target a single note for coloring, annotation, playback highlighting, or later editing.

## Extended notation required in ScoreSpec v1

These capabilities are part of MVP v1 because they are common in piano/jazz teaching material and must be representable by the AI without falling back to renderer-specific hacks.

### Articulations

```ts
export type Articulation =
  | "accent"
  | "staccato"
  | "tenuto"
  | "marcato"
```

Articulations are attached to note/chord content as musical semantics. Rendering and playback adapters decide how to display and interpret them.

### Tuplets

Tuplets are represented on rhythmic duration through an `actual:normal` ratio.

Examples:

- triplet = `{ actual: 3, normal: 2 }`;
- quintuplet = `{ actual: 5, normal: 4 }`.

Nested/arbitrarily complex tuplet notation is not required for v1, but ordinary jazz/classical tuplets are.

### Pickup and incomplete measures

`Measure.kind` explicitly permits:

- `full`;
- `pickup`;
- `incomplete`.

Domain validation allows under-filled duration only when the measure is explicitly marked accordingly.

### Swing feel

Swing is first-class performance metadata rather than a renderer hack.

```ts
export type PlaybackFeel =
  | { type: "straight" }
  | {
      type: "swing"
      subdivision?: "eighth" | "sixteenth" // default eighth (P-02)
      ratio?: { long: number; short: number } // integers, long >= short; default 2:1 (P-02)
      displayText?: string
    }
```

The playback compiler applies the timing feel. The renderer may display a conventional "Swing" indication when requested.

### Phrasing slurs

Phrasing/slur semantics are distinct from ties.

```ts
export type Slur = {
  id: string
  startNoteId: string
  endNoteId: string
}
```

A tie means sustained pitch continuity; a slur represents phrasing/articulation across notes.

### Dynamics

```ts
export type DynamicMark =
  | "ppp" | "pp" | "p" | "mp"
  | "mf" | "f" | "ff" | "fff"

export type DynamicEvent =
  | {
      id: string
      type: "mark"
      eventId: string
      marking: DynamicMark
    }
  | {
      id: string
      type: "hairpin"
      direction: "crescendo" | "diminuendo"
      startEventId: string
      endEventId: string
    }
```

Dynamics are rendered notation and may influence playback velocity/expression through the neutral playback compiler.

### Piano sustain pedal

```ts
export type PedalEvent = {
  id: string
  type: "sustain"
  startEventId: string
  endEventId: string
}
```

The domain expresses the musical pedal span. VexFlow handles visual notation; the playback adapter handles sustain behavior.

### Melodic scale-degree labels

Roman numerals describe harmonic function. Melodic scale degrees are a separate pedagogical concept.

```ts
export type ScaleDegreeLabel = {
  id: string
  noteId: string
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7
  alter?: -2 | -1 | 0 | 1 | 2
  display?: string
}
```

Examples include `1`, `b3`, `#4`, `5`, `b7`.

These labels remain structured so the AI can reason about them and the renderer can choose a consistent visual position.


## Chord symbols and harmonic analysis

Chord notation and harmonic analysis are structured musical data, not free-form pedagogical annotations.

```ts
export type PitchClass = {
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B"
  alter: -2 | -1 | 0 | 1 | 2
}

export type ChordSymbol = {
  root: PitchClass
  quality?:
    | "major"
    | "minor"
    | "dominant"
    | "diminished"
    | "half-diminished"
    | "augmented"
  extension?: 6 | 7 | 9 | 11 | 13
  alterations?: string[]
  bass?: PitchClass
  display?: string
}

export type HarmonicAnalysis = {
  romanNumeral: string
  function?: string
}

export type HarmonyEvent = {
  id: string
  measureId: string
  offset?: Fraction // position in the bar, whole notes; default 0 (replaces `beat`)
  chord?: ChordSymbol
  analysis?: HarmonicAnalysis
}
```

Examples supported by the contract include:

- `Cmaj7`
- `Dm7`
- `G7(b9)`
- `F#m7b5`
- `C/E`
- Roman numerals such as `I`, `ii7`, `V7/ii`, `bVI`, `iiø7`.

`display` exists as an escape hatch for notation conventions while the structured fields remain available to the domain and the AI.

## Pedagogical annotations

Annotations intentionally remain minimal in v1.

```ts
export type Annotation = {
  id: string
  color: string // "#rgb", "#rrggbb" or CSS name; stored as lowercase "#rrggbb"
  noteIds: string[]
  text: string
}
```

The color visually associates targeted notes with explanatory text shown above the stave.

The domain stores the relationship (`noteIds`, `color`, `text`) but never graphical coordinates.

## Stable identity

Stable IDs are required for:

- AI edits;
- annotations;
- playback cursor synchronization;
- renderer layout maps;
- optimistic concurrency;
- future partial score updates.

IDs are required on at least:

- score;
- staff;
- measure;
- voice;
- event;
- note;
- harmony event;
- annotation.

An unchanged musical object SHOULD retain its ID across revisions.

## Revision and concurrency

Every score has an integer `revision`.

Mutating operations will supply `expectedRevision`.

If the persisted/current revision differs, the application returns a structured revision-conflict error rather than silently overwriting newer state.

## Domain invariants for MVP v1

At minimum, validation MUST enforce:

1. `version === 1`.
2. Piano only.
3. One or two staves maximum.
4. Right-hand staff uses treble clef by default; left-hand staff uses bass clef by default. The contract permits explicit clef values.
5. Maximum 32 measures per score artifact.
6. Time signature values must be valid.
7. Measure/voice rhythmic totals must be coherent with the time signature, allowing explicitly supported pickup/incomplete-measure behavior only when added to the contract.
8. Every referenced `noteId` must exist.
9. Maximum 4 visible pedagogical annotations for MVP v1.
10. Annotation text should be concise; target maximum is approximately 80 characters.
11. Fingering values are integers from 1 through 5.
12. IDs must be unique within the score.
13. Floating-point seconds are not accepted as canonical rhythmic duration.
14. Renderer coordinates and library-specific objects are forbidden in the canonical contract.
15. Key signatures are limited to conventional -7..+7 fifths.
16. Tuplet ratios must be positive integers and rhythm validation must account for the ratio.
17. Under-filled measures are valid only when explicitly marked pickup/incomplete.
18. Swing ratio values must be positive and playback semantics must remain deterministic.
19. Slur/tie/dynamic/pedal/scale-degree references must resolve to existing stable IDs.
20. Scale degrees are 1..7 with validated alterations.
21. Pedal and hairpin spans must have an ordered valid start/end target.

## Renderer contract

VexFlow receives the score through an adapter.

The adapter translates domain concepts into VexFlow objects and delegates engraving/layout to VexFlow.

The application MUST NOT calculate engraving details such as beam slope, stem height, accidental placement, or collision resolution.

The renderer should return a neutral `LayoutMap` keyed by stable domain IDs so overlays and playback highlighting can target rendered notes without exposing VexFlow types to the rest of the application.

```ts
export type LayoutMap = {
  notes: Record<
    string,
    {
      x: number
      y: number
      width: number
      height: number
      systemId: string
    }
  >
}
```

These coordinates are ephemeral renderer output and are NEVER persisted into `ScoreSpec`.

## Playback contract

Playback is compiled from `ScoreSpec` into a renderer-independent `PlaybackPlan` or MIDI representation.

```ts
export type PlaybackEvent = {
  noteId: string
  startTick: number
  durationTicks: number
  midiNote: number
  velocity: number
}
```

The playback adapter may initially use SpessaSynth, but SpessaSynth types and state MUST NOT leak into `ScoreSpec`, the application layer, REST contracts, or MCP contracts.

## AI editing

The AI will not mutate arbitrary JSON paths directly.

Edits are expressed as typed domain operations such as:

- set tempo;
- set time signature;
- replace measures;
- insert measures;
- delete measures;
- transpose a target range;
- add/remove pedagogical annotations.

The application validates operations, applies them to `ScoreSpec`, validates the resulting score, increments `revision`, and returns the new canonical state.

This ADR deliberately separates the canonical score contract from the exact MCP tool schema; MCP is an inbound adapter over the same application use cases.

## Persistence

The canonical persisted value is `ScoreSpec`, initially stored as JSONB.

Do not persist derived representations as the source of truth:

- VexFlow objects;
- SVG;
- MIDI;
- audio buffers;
- SpessaSynth state;
- layout coordinates.

Derived outputs may be cached later, but they remain disposable.

## Dependency rules

The following imports are forbidden:

```text
music-domain -> vexflow
music-domain -> spessasynth
music-domain -> @modelcontextprotocol/*
music-domain -> nestjs
music-domain -> supabase

music-application -> vexflow
music-application -> spessasynth
```

Only adapter packages may depend on VexFlow or SpessaSynth.

## Consequences

### Positive

- Renderer and playback engine remain replaceable.
- The MCP and REST APIs can share the same application use cases.
- AI edits target stable domain concepts instead of graphical coordinates.
- Saved scores are independent of third-party library versions.
- Music notation semantics such as enharmonic spelling, Roman numerals, fingering and chord symbols remain first-class structured data.
- Renderer complexity is delegated to VexFlow instead of reimplemented in the application.

### Costs

- We must maintain a domain schema and adapters.
- The schema cannot cover every notation feature on day one.
- Adding a musical feature requires explicitly extending the contract and its validators/adapters.

These costs are accepted because the MVP deliberately supports a narrow piano-learning domain rather than a complete notation editor.

## Deliberately out of scope for ScoreSpec v1

Unless required by a validated product use case, v1 does not attempt to model the full notation standard, including exhaustive support for:

- exhaustive ornaments;
- grace-note systems;
- nested/exotic tuplet systems beyond ordinary v1 ratios;
- lyrics;
- multiple instruments;
- orchestral layout;
- engraving-specific overrides.

Features are added incrementally when product requirements require them.

## Evolution policy

`ScoreSpec.version` versions the persisted contract.

Backward-incompatible schema changes require:

1. a new schema version;
2. an explicit migration path;
3. updated validation fixtures;
4. updated renderer and playback adapter tests.

Renderer or playback-library changes alone MUST NOT require a ScoreSpec version change.

## Acceptance criteria for implementing this ADR

- [ ] `ScoreSpecV1` is defined in `packages/music-domain` or `packages/music-contracts` without renderer/playback imports.
- [ ] Runtime validation exists for all MVP invariants.
- [ ] Fixtures cover one-staff and two-staff piano scores.
- [ ] Fixtures cover chord symbols, Roman numerals, fingering and pedagogical annotations.
- [ ] Fixtures cover key signatures/tonality, tuplets, pickup measures and swing feel.
- [ ] Fixtures cover accent/staccato/tenuto/marcato and phrasing slurs.
- [ ] Fixtures cover dynamic marks, crescendo/diminuendo and sustain pedal.
- [ ] Fixtures cover melodic scale-degree labels.
- [ ] Stable note IDs survive non-destructive edits.
- [ ] A VexFlow adapter can render a valid ScoreSpec without leaking VexFlow types upstream.
- [ ] A playback compiler can derive playback events/MIDI from the same ScoreSpec without leaking SpessaSynth types upstream.
- [ ] Dependency-boundary tests prevent domain/application imports from VexFlow and SpessaSynth.
- [ ] Persisted score JSON is round-trip safe under ScoreSpec v1 validation.
