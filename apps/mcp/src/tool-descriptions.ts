/**
 * Model-facing descriptions of the five tools. They teach the ScoreSpec v1
 * format, the ScoreOperations v1 edit commands, the MVP limits and the save
 * consent rule; the JSON Schemas published with the tools only describe the
 * request envelope (docs/architecture/MCP_SERVER.md §3). Numbers come from the
 * domain limit tables so the text follows them.
 */
import { PAYLOAD_LIMITS } from '@sheet-music/music-contracts';
import { MVP_LIMITS } from '@sheet-music/music-domain';

const L = MVP_LIMITS;

const ERRORS = `On failure nothing is stored and the result is an error whose text is JSON { code, message, details: [{ code, path, message, ids? }] }; path points into your request (or into the resulting score): fix exactly what it names and call again.`;

export const CREATE_SCORE_DESCRIPTION = `Create a new PIANO score (sheet music) and show it to the user as an interactive score they can read and play. The score is stored as a private, temporary DRAFT (see expiresAt); it is NOT added to the user's library (only save_score does that, when the user asks).

Send { score }: a ScoreSpec v1 JSON document WITHOUT "id" and "revision" (the server assigns them: the result has scoreId and revision 1). Keep examples short, about 8 bars unless the user asks for more; at most ${L.measures} bars. Split longer music into several scores.

ScoreSpec v1 (all objects are closed: no extra fields):
- Top level: { version: 1, metadata: { title?, tags? }, tempo: { bpm } (quarter notes per minute, 20-400), timeSignature: { numerator, denominator }, keySignature?: { fifths: -7..7 }, tonalContext?: { tonic: { step, alter }, mode }, playbackFeel?, staves, harmony?, slurs?, dynamics?, pedal?, scaleDegrees?, annotations: [] }.
- Piano only: 1 or ${L.staves} staves { id, hand: "right"|"left", clef?: "treble"|"bass", measures }; with two staves, right hand first.
- Bars are shared: the i-th measure of every staff has the same bar id, number (1-based position), kind, timeSignature and actualDuration.
- Measure: { id, number, kind?: "full"|"pickup"|"incomplete", timeSignature? (this bar only), actualDuration? (required for pickup/incomplete), voices: [{ id, events }] } with 1-${L.voicesPerMeasure} voices. Every voice fills its bar exactly: write silence as rests.
- Events: { id, type: "note", pitch, duration, fingering?: 1-5, articulations?: ["accent"|"staccato"|"tenuto"|"marcato"], tie?: { start?: true, end?: true } } | { id, type: "chord", duration, notes: [{ id, pitch, fingering?, articulations?, tie? }] } (2-${L.notesPerChord} notes, each with its own id) | { id, type: "rest", duration }.
- pitch: { step: "C".."B", alter: -2..2, octave: 0..8 }; octave 4 contains middle C (C4). alter is the written accidental, not relative to the key (F# is alter 1 even in G major).
- duration: { value: "whole"|"half"|"quarter"|"eighth"|"sixteenth"|"thirtySecond", dots?: 1|2, tuplet?: { groupId, actual, normal } }. Tuplet members are consecutive events of one voice in one bar sharing one groupId and ratio: an eighth triplet is three eighths with { groupId: "t1", actual: 3, normal: 2 }.
- Musical time (actualDuration, harmony offset) is an exact fraction of a WHOLE note: { numerator: 1, denominator: 4 } is one quarter note.
- IDs: 1-64 characters [A-Za-z0-9_.:-] starting with a letter or digit, unique in the score (a bar id is shared by its staves, a tuplet groupId by its members). Choose readable, stable IDs: edits target them.
- Layers refer to IDs: harmony [{ id, measureId, offset?, chord?: { root: { step, alter }, quality?: "major"|"minor"|"dominant"|"diminished"|"half-diminished"|"augmented", extension?: 6|7|9|11|13, alterations?, bass?, display? }, analysis?: { romanNumeral, function? } }], slurs [{ id, startNoteId, endNoteId }], dynamics [{ id, type: "mark", eventId, marking: "ppp".."fff" } | { id, type: "hairpin", direction: "crescendo"|"diminuendo", startEventId, endEventId }], pedal [{ id, type: "sustain", startEventId, endEventId }], scaleDegrees [{ id, noteId, degree: 1-7, alter?, display? }].
- playbackFeel: { type: "straight" } or { type: "swing", subdivision?: "eighth"|"sixteenth", ratio?: { long, short }, displayText? } (swing defaults to eighths at 2:1).
- Teaching annotations: at most ${L.annotations}, each { id, color: "#rrggbb" or a CSS color name, noteIds, text } with text up to ${L.annotationTextLength} characters. One note carries at most ONE teaching color: two annotations of different colors on the same note are rejected (ANNOTATION_COLOR_CONFLICT); reuse the same color or split the notes.

${ERRORS}`;

export const EDIT_SCORE_DESCRIPTION = `Change an existing score (draft or saved) with typed operations, applied in order as ONE atomic edit, and show the updated score. The score keeps its ID; its revision increases by exactly 1. Editing a saved score updates the library copy directly.

- scoreId: from create_score, get_score or search_scores. expectedRevision: the revision you last received. If the score changed since, the edit fails with REVISION_CONFLICT and nothing changes: call get_score and rebuild the edit.
- operations: 1-${PAYLOAD_LIMITS.operationsPerEdit} objects with a "type". Target elements by stable ID only (never by position); give new content new unique IDs and keep the IDs of what does not change. Only the final score is validated, so one batch may change the meter and then replace the bars.
- Score: set_tempo { bpm }, set_time_signature { numerator, denominator } (bars must still fit), set_key_signature { keySignature | null }, set_tonal_context { tonalContext | null }, set_playback_feel { playbackFeel | null }, set_title { title | null }, set_tags { tags }.
- Bars: insert_measures { position: "before"|"after", measureId, bars }, replace_measures { measureIds (one contiguous range), bars }, delete_measures { measureIds }. A bar is { id, kind?, timeSignature?, actualDuration?, staves: [{ staffId, voices }] } with every staff exactly once and no number (bars are renumbered).
- transpose { semitones: -87..87, target: { measureIds?, staffIds? } } ({} is the whole score; spelling follows the key).
- Harmony and teaching: set_chord_symbol / set_harmonic_analysis { harmonyId, measureId?, offset?, chord | analysis }, remove_chord_symbol / remove_harmonic_analysis { harmonyId }, set_fingering { noteId, fingering }, remove_fingering { noteId }, set_articulations { noteId, articulations }, add_slur { slur }, remove_slur { slurId }, set_dynamic { dynamic }, remove_dynamic { dynamicId }, set_pedal { pedal }, remove_pedal { pedalId }, set_scale_degree { scaleDegree }, remove_scale_degree { scaleDegreeId }, add_annotation { annotation }, update_annotation { annotationId, color?, noteIds?, text? }, remove_annotation { annotationId }.
- Nothing cascades: removing or replacing notes that slurs, dynamics, pedal, labels, harmony or annotations refer to must repair those references in the same batch. The ${L.measures}-bar, ${L.annotations}-annotation and one-color-per-note (ANNOTATION_COLOR_CONFLICT) rules apply to the result.
- Items (slur, dynamic, pedal, scaleDegree, annotation, voices) use the ScoreSpec v1 shapes described in create_score.

${ERRORS}`;

export const SAVE_SCORE_DESCRIPTION = `Save a draft score permanently in the user's private library, with a library title and optional tags.

Call this ONLY when the user has explicitly asked, in their own words, to save this score, or has approved your proposal to save it. Never save on your own initiative or because the user asked for a score. There is no confirmation flag: the call itself is the save request, and nothing you write in the arguments can stand for the user's consent. Tell the user the title and tags you will use.

- scoreId and expectedRevision: from the latest create_score, edit_score or get_score result (a different revision is REVISION_CONFLICT: call get_score).
- title: 1-${PAYLOAD_LIMITS.titleLength} characters; tags: 0-${PAYLOAD_LIMITS.tags}, each 1-${PAYLOAD_LIMITS.tagLength} characters (whitespace is normalized; duplicates ignoring case are dropped).
- The saved score keeps its ID and revision; later edit_score calls update it directly, with no new save.
- Repeating the same save returns outcome "already_saved" and writes nothing. Saving an already saved score with another revision, title or tags fails with ALREADY_SAVED: library titles and tags cannot be changed.
- An expired or unknown draft is NOT_FOUND: create the score again.

${ERRORS}`;

export const GET_SCORE_DESCRIPTION = `Read the current version of one of the user's scores (a live draft or a saved score) and show it to the user. The result text contains the canonical ScoreSpec v1 JSON with every ID, so use it before editing a score you have not just created or edited (for example a saved score found with search_scores, or after a transposition). Reading changes nothing and does not extend a draft's expiry.

- scoreId: a score ID from create_score, edit_score, save_score or search_scores.
- A missing, expired or foreign score is NOT_FOUND.

${ERRORS}`;

export const SEARCH_SCORES_DESCRIPTION = `Search the user's saved library (drafts are never listed). Returns summaries { scoreId, title, tags, revision, createdAt, updatedAt }, most recently updated first, and page info; use get_score to open one.

- query: optional text (up to ${PAYLOAD_LIMITS.searchQueryLength} characters) matched case-insensitively inside titles and tags; empty means every score.
- tags: optional filters (up to ${PAYLOAD_LIMITS.searchTags}); a score must carry all of them (case-insensitive).
- limit: 1-${PAYLOAD_LIMITS.pageSizeMax} (default ${PAYLOAD_LIMITS.pageSizeDefault}); offset: 0-${PAYLOAD_LIMITS.pageOffsetMax}. page.nextOffset is the offset of the next page, or null.
- No match is an empty list, not an error.

${ERRORS}`;
