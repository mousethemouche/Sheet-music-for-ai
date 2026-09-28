# Sheet Music for AI — MVP User Stories

Priority legend:

- **P0** — required for the MVP product promise.
- **P1** — important for a usable MVP, but can follow the first end-to-end slice if necessary.
- **Later** — explicitly outside MVP v1.

---

## Epic A — Generate musical examples in conversation

### US-A1 — Generate a piano score from natural language — P0

**As a** piano-playing musician  
**I want** to ask an AI for a musical example in natural language  
**So that** I can see the idea as notation without entering notes manually.

#### Acceptance criteria

- Given a valid musical request, the AI can produce a readable piano score artifact.
- The artifact is shown inside the AI experience rather than requiring the user to recreate it elsewhere.
- The user does not need to use a notation editor to obtain the result.
- The artifact can use one or two staves depending on the musical material.
- Piano is the only instrument exposed in MVP v1.

---

### US-A2 — Generate concise musical excerpts — P0

**As a** musician  
**I want** generated examples to stay reasonably short  
**So that** they remain readable and useful inside a conversation.

#### Acceptance criteria

- The normal/default target is approximately 8 measures.
- Examples of up to 16 measures are considered normal when the musical idea needs more space.
- A single score section cannot exceed 32 measures in MVP v1.
- If a request would require more than 32 measures, the AI splits the response into multiple score sections/examples.
- Odd meters such as 7/4 are valid and do not change the measure-count rule.

---

## Epic B — Hear the score

### US-B1 — Play and pause the generated score — P0

**As a** musician  
**I want** to hear the generated notation immediately  
**So that** I can understand the musical idea by ear as well as visually.

#### Acceptance criteria

- A generated score can be played without leaving the score experience.
- Playback can be paused.
- Playback uses a piano sound.
- Playback corresponds to the currently displayed score.

---

### US-B2 — Change playback tempo — P0

**As a** musician  
**I want** to change playback tempo  
**So that** I can study difficult material at a useful speed.

#### Acceptance criteria

- The user can adjust tempo without rewriting the score.
- Changing tempo affects subsequent playback immediately.
- Tempo changes do not create a duplicate score artifact.

---

### US-B3 — Loop an example — P0

**As a** musician  
**I want** to loop the musical excerpt  
**So that** I can repeatedly listen to or practice the same material.

#### Acceptance criteria

- Looping can be enabled and disabled.
- When enabled, playback restarts at the end of the excerpt.
- Loop state does not create a duplicate score artifact.

---

## Epic C — Explain the music visually

### US-C1 — Color notes for pedagogical explanation — P0

**As a** musician  
**I want** the AI to highlight specific notes with color  
**So that** I can visually connect an explanation to the relevant musical material.

#### Acceptance criteria

- The AI can apply a freely chosen color to one or more selected notes.
- Unrelated notes remain visually distinct from the highlighted group.
- Multiple annotation colors can coexist in the same score when readability allows it.
- The user is not required to manually select or paint the notes.

---

### US-C2 — Display same-color explanatory text above the staff — P0

**As a** musician  
**I want** each highlighted note group to have a matching explanation  
**So that** I understand why those notes matter.

#### Acceptance criteria

- Each annotation can contain short explanatory text.
- The annotation text uses the same color as the notes it explains.
- Text is placed above/outside the staff rather than inside the notation lines.
- Annotation text must not obscure noteheads, rhythms, stems, or staff lines.
- The target maximum is 4 visible annotations per excerpt.
- Annotation copy should normally remain around 80 characters or fewer.
- If the requested explanation becomes too dense, the AI simplifies, merges, or splits the example rather than making the score unreadable.

---

## Epic D — Refine the same score through conversation

### US-D1 — Modify the active score conversationally — P0

**As a** musician  
**I want** to ask the AI to change the current score in natural language  
**So that** I can explore variations without operating a notation editor.

#### Acceptance criteria

- The user can request changes such as transposition, difficulty, phrase changes, meter changes, added/removed measures, or simpler hand parts.
- The AI updates the current artifact rather than creating a new independent artifact by default.
- The updated score replaces the prior current state in the conversation.
- Playback reflects the updated score.
- Existing annotations may be updated or removed when they no longer match the music.

---

### US-D2 — Preserve artifact identity across revisions — P0

**As a** musician  
**I want** an exercise to remain the same logical object while I refine it  
**So that** my library is not polluted with every intermediate variation.

#### Acceptance criteria

- Multiple conversational revisions retain one logical score identity.
- Revisions do not automatically create new saved-library entries.
- If the score has already been saved, later revisions continue to apply to that same logical saved item unless the user explicitly asks to create a separate copy in a future version.

---

## Epic E — Save useful scores intentionally

### US-E1 — AI can suggest saving a useful score — P1

**As a** musician  
**I want** the AI to suggest saving a useful exercise when appropriate  
**So that** valuable material is easy to keep without interrupting every generation with a form.

#### Acceptance criteria

- The AI may propose a save after a useful artifact has been created/refined.
- The suggestion can include a proposed title and free-form tags based on conversation context.
- The suggestion does not itself persist data.

---

### US-E2 — Require explicit confirmation before saving — P0

**As a** user  
**I want** to approve every save  
**So that** the AI cannot clutter my library without my consent.

#### Acceptance criteria

- A score is not persisted unless the user explicitly confirms the save.
- Silence, continued conversation, or AI inference does not count as confirmation.
- The user can decline without losing the active conversational score.
- The save operation persists the current version of the artifact only after confirmation.

---

### US-E3 — Save lightweight metadata — P1

**As a** musician  
**I want** saved scores to have a title and flexible tags  
**So that** I can organize them without maintaining folders or a taxonomy.

#### Acceptance criteria

- Each saved score has a title.
- Each saved score may have zero or more free-form tags.
- Tags are not restricted to predefined categories.
- The AI may suggest title/tags, but the user remains in control of whether the save happens.
- Folder hierarchies are not required.

---

## Epic F — Retrieve saved material

### US-F1 — Browse saved scores — P1

**As a** musician  
**I want** a minimal view of my saved scores  
**So that** I can return to useful material later.

#### Acceptance criteria

- The user can access a list/library of saved scores.
- Each item exposes enough information to identify it, including at least its title and tags.
- The library does not require folders, playlists, social metadata, or course structures.

---

### US-F2 — Search and filter saved scores — P1

**As a** musician  
**I want** to find scores by text and tags  
**So that** I can quickly recover a previous exercise or example.

#### Acceptance criteria

- The user can search saved material using text.
- The user can use free-form tags to narrow/find relevant items.
- A matching saved item can be reopened.

---

### US-F3 — Reopen and continue a saved score — P1

**As a** musician  
**I want** to reopen a saved score and continue working with it through the AI  
**So that** saved material remains a living learning artifact rather than a static archive.

#### Acceptance criteria

- Reopening restores the current musical content.
- Relevant playback state such as tempo is restored where appropriate.
- The reopened artifact can again be modified conversationally.
- Continuing to modify it preserves the same logical artifact identity.

---

# Cross-cutting acceptance criteria

These requirements apply across the MVP.

## AI-first interaction

- Core score creation and transformation does not require a mouse-driven notation workflow.
- Manual UI exists only where it is genuinely faster/clearer than language, especially playback controls and minimal library navigation.

## Readability

- Musical notation remains legible in the primary conversation context.
- Pedagogical text does not overlap the staff.
- The product prefers splitting/simplifying content over rendering an overloaded artifact.

## Scope discipline

The following are not acceptance requirements for MVP v1:

- audio or microphone transcription;
- MIDI performance grading;
- automatic “correct/incorrect” practice scoring;
- practice streaks/mastery tracking;
- social sharing;
- teacher accounts;
- paid content;
- multi-instrument notation;
- mouse-based score editing;
- advanced engraving controls.

---

# MVP end-to-end acceptance scenario

The MVP passes product acceptance when this scenario works:

1. User: “Show me an 8-bar bebop II–V–I exercise for piano and highlight the chromatic approach notes.”
2. AI returns a readable piano score.
3. Relevant notes are colored and a same-color explanation appears above the staff.
4. User plays the score, changes tempo, and loops it.
5. User: “Make it slightly harder and put it in 7/4.”
6. The same score artifact updates and remains playable/readable.
7. AI proposes saving the result with a title and free-form tags.
8. User explicitly confirms.
9. The score appears in the saved library.
10. The user can later retrieve it through search/tags and continue modifying the same logical artifact.
