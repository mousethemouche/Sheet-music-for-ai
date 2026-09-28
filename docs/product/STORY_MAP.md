# Sheet Music for AI — MVP Story Map

This story map defines the **user journey and release slice** for the MVP. It is deliberately product-focused and implementation-agnostic.

## Backbone

1. Ask
2. Generate
3. See
4. Hear
5. Understand
6. Iterate
7. Save
8. Retrieve

---

## 1. Ask

### User goal
Express a musical need naturally without learning notation software.

### MVP tasks
- Ask for a musical example.
- Ask for an exercise.
- Ask for an explanation using notation.
- Ask for a transformation of an existing musical idea.
- Specify musical constraints conversationally, e.g. key, meter, difficulty, number of measures.

### Example prompts
- “Show me a bebop line over a II–V–I.”
- “Give me an 8-bar exercise for this voicing.”
- “What would this idea sound like in 7/4?”
- “Explain the tension notes visually.”

---

## 2. Generate

### User goal
Receive a concrete piano artifact from the AI.

### MVP tasks
- Generate standard piano notation.
- Use one or two staves depending on the material.
- Prefer concise examples.
- Default toward approximately 8 measures.
- Support up to 32 measures in one score section.
- Support musically valid odd meters such as 7/4.

### Release rule
Requests that exceed the useful size of one artifact should be split into multiple sections/examples rather than creating one unreadably long score.

---

## 3. See

### User goal
Read the musical answer directly in the conversation.

### MVP tasks
- Display the score inline.
- Keep notation legible at normal conversation width.
- Keep explanatory text outside the staff.
- Support one-staff and piano grand-staff examples.

---

## 4. Hear

### User goal
Immediately hear what the notation sounds like.

### MVP tasks
- Play.
- Pause.
- Change tempo.
- Loop the example.
- Use piano playback sound.

### Product expectation
Playback is part of the core value proposition, not an optional enhancement.

---

## 5. Understand

### User goal
Connect the AI's explanation to specific notes in the score.

### MVP tasks
- Color one or more notes.
- Display a short explanatory text in the same color.
- Place annotation text above/outside the staff.
- Allow multiple distinct annotation colors.

### Readability guardrails
- Target maximum of 4 visible annotations per excerpt.
- Keep each explanation concise (roughly <=80 characters by default).
- If the explanation becomes too dense, simplify or split the example.

### Not in MVP
- arrows;
- boxes;
- arbitrary shapes;
- pixel-level annotation placement;
- freehand or mouse-based annotation tools.

---

## 6. Iterate

### User goal
Refine the musical artifact through conversation instead of editing notation manually.

### MVP tasks
- Change key / transpose.
- Change difficulty.
- Change tempo-related intent.
- Add/remove measures within limits.
- Change left-hand or right-hand content.
- Change a phrase or ending.
- Add/remove pedagogical color annotations.
- Change meter where musically valid.

### Core rule
The active score is **one living artifact**. Revisions update that artifact rather than creating a new library item for every variation.

---

## 7. Save

### User goal
Keep a useful result without interrupting exploration prematurely.

### MVP tasks
- AI may suggest that a useful score be saved.
- AI may propose a title.
- AI may propose free-form tags from conversation context.
- User explicitly confirms or declines.
- On confirmation, persist the current artifact.

### Core rule
**No persistence without explicit human confirmation.**

### Minimal saved metadata
- title;
- free-form tags;
- current score content;
- playback-relevant state such as tempo;
- timestamps.

---

## 8. Retrieve

### User goal
Find useful exercises/examples again later.

### MVP tasks
- View a minimal saved-score library.
- Search by text.
- Filter/find by free-form tags.
- Reopen a saved score.
- Continue using the reopened score as an AI-manipulable artifact.

### Not in MVP
- folders;
- nested collections;
- social feeds;
- public profiles;
- marketplace discovery;
- teacher dashboards.

---

# MVP release slice

The MVP release requires one complete vertical journey:

> **Ask -> Generate -> See -> Hear -> Understand -> Iterate -> Save with confirmation -> Retrieve**

A partial release that renders notation but cannot play it, evolve it conversationally, or save/retrieve useful results does not satisfy the agreed product loop.

---

# Later story-map slices

## Practice layer
- Mark practiced.
- Track confidence/mastery.
- Build practice queues.
- Suggest next exercises.

## Teacher/content layer
- Teacher creates curated libraries.
- Organize material into topics/courses.
- Share libraries.

## Social/marketplace layer
- Publish libraries.
- Follow creators.
- Buy/sell premium libraries.

## Performance-feedback layer
- Capture MIDI/audio.
- Compare performance to score.
- Provide automated feedback.

These are explicit future layers and must not leak into MVP implementation unless they are required for forward-compatible architecture at negligible cost.
