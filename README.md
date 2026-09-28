# Sheet Music for AI

An AI-first music product that turns musical conversations into **readable, playable piano scores directly inside the conversation**.

## Product principle

> **The conversation is the interface. The score is an AI-generated artifact.**

The user asks the AI to explain, demonstrate, transform, or create a musical idea. The AI returns a playable score, can annotate it visually, and can keep evolving the same artifact through natural-language requests.

This is deliberately **not** an online notation editor.

## MVP product loop

1. Ask the AI for a musical example, explanation, exercise, or transformation.
2. Receive an inline piano score.
3. Play/pause it, change tempo, and loop it.
4. Use simple color-linked annotations to explain specific notes.
5. Refine the same score through conversation.
6. Save it only after explicit user confirmation.
7. Retrieve saved scores through a minimal library with free-form tags/search.

## MVP boundaries

- Piano only.
- One or two staves depending on the material.
- Short excerpts by default: ~8 measures; 32 measures maximum per section.
- Simple pedagogical annotations: colored notes + same-color text above the staff.
- Target maximum of 4 visible annotations per excerpt.
- No mouse-driven score editor.
- No audio/MIDI transcription or performance grading.
- No social network, teacher marketplace, or practice analytics in v1.

## Product specifications

The agreed MVP product scope lives in `docs/product/` on the `spec/mvp-v1` branch:

- [`docs/product/PRD.md`](docs/product/PRD.md) — vision, user, JTBD, product rules, scope, non-goals, Definition of Done, validation goals.
- [`docs/product/STORY_MAP.md`](docs/product/STORY_MAP.md) — end-to-end journey and MVP release slice.
- [`docs/product/USER_STORIES.md`](docs/product/USER_STORIES.md) — prioritized user stories and acceptance criteria.

## Status

**Product discovery for MVP v1 is sufficiently defined to begin technical discovery.**

Technical choices are intentionally not frozen yet. The next phase will decide the MCP contract, score representation, rendering/playback approach, persistence, React/NestJS structure, and Vercel deployment architecture from the product requirements above.
