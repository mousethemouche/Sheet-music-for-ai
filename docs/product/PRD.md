# Sheet Music for AI — MVP Product Requirements Document

**Status:** Product scope agreed — ready for technical discovery  
**Release:** MVP v1  
**Primary interface:** AI conversation  
**Primary instrument:** Piano

## 1. Product vision

Sheet Music for AI makes musical ideas visible and audible inside an AI conversation.

The core product principle is:

> **The conversation is the interface. The score is an AI-generated artifact.**

The user should not need to operate a traditional notation editor. They ask the AI to explain, demonstrate, transform, or create a musical idea; the AI returns a readable and playable piano score and can continue modifying that same score through natural-language requests.

The long-term product may later support pedagogy, practice tracking, teacher-created libraries, sharing, and a marketplace. None of those are required to validate the MVP.

---

## 2. Problem

AI assistants can explain music in text, but music is difficult to understand from prose alone.

A musician asking questions such as:

- “Show me how walking bass changed from swing to bebop.”
- “Give me a short exercise using this harmonic idea.”
- “Make this phrase harder.”
- “What would this idea sound like in 7/4?”

needs to **see and hear** the answer, not only read about it.

Today that usually requires leaving the conversation, opening notation software, manually entering notes, and reconstructing the AI's explanation.

The MVP removes that gap.

---

## 3. Primary user

### Persona

A piano-playing musician, primarily amateur to intermediate, who already uses an AI assistant to learn, explore, understand, or practice music.

The MVP is intentionally not optimized for professional engravers, professional composers, teachers managing students, or institutions.

### Primary Job To Be Done

> **When I am trying to understand or practice a musical idea in an AI conversation, I want the AI to show it to me as readable, playable piano notation so I can move immediately from an abstract explanation to a concrete musical example.**

---

## 4. Product promise

> Ask an AI about a musical idea and get an immediately readable, playable, explainable piano score that you can refine by conversation and save when it becomes useful.

---

## 5. Product principles

### 5.1 AI-first, not editor-first

Natural language is the primary control surface. The user should not need to drag notes, position annotations, or operate notation-editing tools.

### 5.2 The score is one living artifact

When a user says “transpose it”, “make it harder”, “change the ending”, or “add two bars”, the existing score evolves. The product should not create a new library item for every variation.

### 5.3 Human approval before persistence

The AI may suggest saving a useful score, but **nothing is saved without explicit user confirmation**.

### 5.4 Readability over feature count

The MVP should prefer small, legible teaching examples over complex engraving features or long scores.

### 5.5 Pedagogy should be visually simple

Annotations exist to clarify the music, not to become a separate diagramming system.

---

## 6. Core MVP experience

### Step 1 — Ask

The user asks naturally for an explanation, example, exercise, or transformation inside the AI conversation.

Examples:

- “Show me a bebop line over a II–V–I.”
- “Explain which notes create the tension.”
- “Make this exercise easier.”
- “Put the idea in 7/4.”

### Step 2 — Generate

The AI creates a piano score artifact.

The score can contain:

- one staff when appropriate;
- a two-staff piano grand staff when appropriate;
- standard pitches and rhythms;
- chord symbols when useful;
- simple pedagogical color annotations.

### Step 3 — See and hear

The score is displayed in the conversation and can be played immediately.

Minimum playback controls:

- Play / Pause;
- tempo adjustment;
- loop.

Playback uses piano sound in MVP v1.

### Step 4 — Understand

The AI may visually explain selected notes using simple color-linked annotations.

An annotation consists conceptually of:

- a set of targeted notes;
- a freely chosen color;
- a short explanatory text using the same color.

The explanatory text is rendered **above and outside the staff** so that it never obscures notation.

The MVP does not require arrows, boxes, free-position graphics, or an annotation canvas.

Readability guardrails:

- target maximum: 4 visible annotations per excerpt;
- annotation text should remain short (approximately 80 characters or less as a default heuristic);
- if an explanation becomes too dense, the AI should simplify it or split the musical example.

These limits are product heuristics and should remain configurable rather than permanent domain rules.

### Step 5 — Iterate

The user continues the conversation, for example:

- “Slow it down.”
- “Transpose it to D.”
- “Make the left hand simpler.”
- “Add a chromatic approach.”
- “Highlight the notes that create the tension.”

These requests update the same score artifact.

### Step 6 — Save

When useful, the AI may ask whether the user wants to save the score.

Example:

> “Do you want me to save this exercise with the tags `jazz`, `bebop`, `ii-v-i`?”

The score is persisted only after explicit confirmation.

For the MVP, a saved score needs only lightweight organization:

- title;
- free-form tags;
- current score content;
- playback-relevant state such as tempo;
- creation/update timestamps.

The AI may propose the title and tags from conversation context.

### Step 7 — Retrieve

The user can later retrieve saved scores using simple search and/or tags.

The library is intentionally minimal. It is not a content-management product.

---

## 7. Musical scope

### Instrument

- Piano only.
- No instrument selector in MVP.
- Playback sound is piano.

### Staff support

- One staff for monophonic/simple material when appropriate.
- Two staves for piano material requiring right-hand / left-hand representation.

### Excerpt length

Length is constrained by measures rather than seconds.

- default target: **8 measures**;
- comfortable/common upper range: **16 measures**;
- hard MVP maximum for one artifact section: **32 measures**.

Requests longer than 32 measures should be split into multiple sections/examples rather than rendered as one oversized excerpt.

Odd and changing meters are allowed where musically valid, including examples such as 7/4.

---

## 8. MVP scope

### Must have

1. AI can create a piano score from conversational intent.
2. Score appears inline in the AI experience.
3. Score is readable as standard notation.
4. Score can be played with piano sound.
5. User can play/pause, change tempo, and loop.
6. Score can use one or two piano staves.
7. AI can update the same existing score through conversation.
8. AI can color selected notes and attach same-color explanatory text above the staff.
9. The product protects readability with simple annotation-density guardrails.
10. The AI can suggest saving a score.
11. Saving always requires explicit human confirmation.
12. Saved scores support title + free-form tags.
13. User can retrieve saved scores through a minimal library/search experience.
14. A single excerpt supports up to 32 measures, with shorter examples preferred.

### Should have if low-cost

- chord symbols;
- basic playback position feedback;
- graceful splitting of long requests into several score sections.

### Later

- pedagogical progression and curricula;
- “practiced / mastered” tracking;
- teacher-created score libraries;
- social sharing;
- paid libraries / marketplace;
- automatic performance assessment;
- audio/MIDI transcription;
- multi-instrument scores.

---

## 9. Explicit non-goals for MVP v1

The MVP is **not**:

- an online MuseScore/Sibelius replacement;
- a mouse-driven score editor;
- a DAW;
- an audio transcription product;
- a MIDI performance-grading system;
- a practice analytics platform;
- a social network;
- a marketplace;
- a teacher/student management system;
- a multi-instrument orchestration tool;
- a full publishing/engraving workflow.

---

## 10. Product rules

### PR-01 — Conversation first

Any core musical transformation that can reasonably be expressed in language should be driven by the AI rather than by adding a dedicated manual UI control.

### PR-02 — Same artifact evolves

Conversational revisions update the active score instead of creating duplicate saved exercises.

### PR-03 — No silent saves

No score may enter the user's saved library without explicit confirmation.

### PR-04 — Annotation simplicity

The AI chooses note targets, color, and explanation. It does not position annotation text pixel-by-pixel.

### PR-05 — Keep annotations outside the staff

Pedagogical text is placed above/outside the notation area.

### PR-06 — Prefer short examples

The AI should normally create concise examples and exercises. 8 measures is the default target; 32 measures is the maximum per score section in MVP.

### PR-07 — Piano-only scope

The product does not expose instrument configuration in MVP v1.

---

## 11. MVP Definition of Done

The product MVP is functionally complete when the following end-to-end scenario works reliably:

1. A user asks an AI for a piano musical example in natural language.
2. The AI creates a readable score inside the conversation.
3. The user can hear it immediately.
4. The user can play/pause, change tempo, and loop it.
5. The AI can add a simple color-linked explanation without making the staff unreadable.
6. The user can request multiple conversational changes and the same artifact evolves.
7. The AI can propose saving the useful result.
8. Nothing is saved until the user explicitly agrees.
9. The saved artifact has a title and free-form tags.
10. The user can later find and reopen that saved score.

If this loop works without requiring a conventional notation editor, the MVP satisfies its product promise.

---

## 12. Validation goals

The initial release is a product-learning MVP. The first questions are qualitative before they are growth metrics:

1. Does seeing notation materially improve AI music conversations?
2. Do users actually play the generated examples?
3. Do users naturally ask the AI to iterate on the same score?
4. Do users find enough generated artifacts valuable enough to save?
5. Which musical requests fail because of score quality, playback quality, or interaction design?
6. Are the simple color annotations genuinely useful for explanation?

Potential event metrics for the technical phase:

- score generated;
- playback started;
- tempo changed;
- loop enabled;
- score revised conversationally;
- save suggested;
- save confirmed / declined;
- saved score reopened.

No numeric success threshold is fixed yet; early usage should first establish a baseline.

---

## 13. Open product questions intentionally deferred

These do **not** block technical discovery:

- whether saved scores retain user-visible version history;
- exact library layout;
- exact annotation density thresholds after real score testing;
- whether playback cursor/highlighting is necessary for the first public build;
- future practice/progress data model;
- future teacher/social/marketplace model.

---

## 14. Product boundary before technical design

This PRD describes **what the MVP must accomplish**, not how it is implemented.

The following decisions belong to the next technical-design phase and should not be inferred from this document:

- notation interchange/storage format;
- rendering library;
- MCP tool count and schemas;
- frontend embedding mechanism;
- persistence technology;
- authentication approach;
- React/NestJS project structure;
- Vercel deployment topology.
