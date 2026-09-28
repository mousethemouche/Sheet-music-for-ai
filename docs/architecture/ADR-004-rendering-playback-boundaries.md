# ADR-004 — Independent rendering and playback pipelines

- **Status:** Accepted
- **Date:** 2026-09-28
- **Scope:** MVP v1

## Decision

Rendering and playback are two independent downstream projections of the same canonical `ScoreSpec`.

```text
                    ScoreSpec
                   /         \
                  v           v
         RendererAdapter   TimelineCompiler
              |               |
              v               v
           VexFlow       PlaybackPlan/MIDI
                              |
                              v
                         PlaybackEngine
                              |
                              v
                         SpessaSynth
```

VexFlow and SpessaSynth must never call each other directly.

## Renderer port

The renderer consumes `ScoreSpec` and returns an ephemeral neutral layout result keyed by stable domain IDs.

```ts
interface ScoreRenderer {
  render(score: ScoreSpec, target: HTMLElement): Promise<RenderResult>
  update(score: ScoreSpec): Promise<RenderResult>
  destroy(): void
}

type RenderResult = {
  layoutMap: LayoutMap
}
```

VexFlow handles engraving/layout. The app does not reimplement beam/stem/accidental/collision algorithms.

## Playback pipeline

The music domain is compiled into a neutral tick-based `PlaybackPlan`.

```ts
type PlaybackEvent = {
  noteId: string
  startTick: number
  durationTicks: number
  midiNote: number
  velocity: number
}
```

The SpessaSynth adapter consumes a neutral plan or a generated MIDI sequence. No SpessaSynth types are allowed upstream.

## Synchronization

Playback position is expressed in neutral ticks.

A synchronization controller maps current ticks to active note IDs, then asks the renderer/UI to highlight those IDs.

```text
PlaybackEngine -> tick position -> Timeline -> active noteIds -> UI highlight
```

## Pedagogical annotation rendering

V1 annotations are domain data: `noteIds + color + text`.

VexFlow renders/colorizes notation. A React overlay may use the neutral `LayoutMap` to place explanatory text above the staff.

Coordinates are ephemeral and are never persisted in `ScoreSpec`.

## Replaceability rule

Replacing VexFlow or SpessaSynth must require changing only their adapter packages plus composition wiring, not the domain, MCP contracts, persistence schema, or application use cases.
