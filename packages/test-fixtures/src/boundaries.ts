/**
 * F11 boundary inputs (TEST_PLAN §4): 32/33 bars, 2/3 staves, 4/5 annotations,
 * invalid references and malformed payloads. Names ending in a limit that is
 * exceeded, or in INVALID/MALFORMED, are rejected by validateScoreSpec.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import {
  type AnnotationInput,
  type StaffInput,
  bar,
  cloneFixture,
  frozen,
  note,
  score,
  staff,
  voice,
} from './builders';
import { F01 } from './catalog';

const HANDS: readonly StaffInput['hand'][] = ['right', 'left', 'left'];
const PITCHES: readonly string[] = ['C5', 'C3', 'C2'];

/** `staffCount` staves of `barCount` aligned bars, each bar one whole note. */
function wholeNoteScore(id: string, barCount: number, staffCount: number): ScoreSpecInput {
  const barNumbers = Array.from({ length: barCount }, (_, index) => index + 1);
  return score({
    id,
    staves: Array.from({ length: staffCount }, (_, staffIndex) =>
      staff(
        `${id}-s${staffIndex + 1}`,
        HANDS[staffIndex] ?? 'left',
        barNumbers.map((number) =>
          bar(`${id}-m${number}`, number, [
            voice(`${id}-s${staffIndex + 1}-m${number}-v1`, [
              note(`${id}-s${staffIndex + 1}-m${number}-n1`, PITCHES[staffIndex] ?? 'C3', 'whole'),
            ]),
          ]),
        ),
      ),
    ),
  });
}

/** One staff, one bar: the smallest valid score. */
export const F11_ONE_BAR: ScoreSpecInput = frozen(wholeNoteScore('f11-one', 1, 1));
/** Two hands x 32 aligned bars: the largest valid score (32 bars, not 64). */
export const F11_THIRTY_TWO_BARS: ScoreSpecInput = frozen(wholeNoteScore('f11-32', 32, 2));
/** Two hands x 33 bars. INVALID (MVP limit). */
export const F11_THIRTY_THREE_BARS: ScoreSpecInput = frozen(wholeNoteScore('f11-33', 33, 2));
/** Three staves. INVALID (MVP limit). */
export const F11_THREE_STAVES: ScoreSpecInput = frozen(wholeNoteScore('f11-three', 1, 3));

const ANNOTATION_COLORS: readonly string[] = ['#e91e63', '#1e88e5', '#43a047', '#fb8c00'];

function annotated(count: number): ScoreSpecInput {
  const annotations: AnnotationInput[] = Array.from({ length: count }, (_, index) => ({
    id: `f11-a${index + 1}`,
    color: ANNOTATION_COLORS[index % ANNOTATION_COLORS.length] ?? '#000000',
    noteIds: [`f01-n${(index % 4) + 1}`],
    text: `Teaching note ${index + 1}`,
  }));
  return { ...cloneFixture(F01), id: 'f11-annotated', annotations };
}

/** Four annotations on F01's four notes. Valid. */
export const F11_FOUR_ANNOTATIONS: ScoreSpecInput = frozen(annotated(4));
/** Five annotations (the fifth reuses the first note and color, so only the count is wrong). INVALID. */
export const F11_FIVE_ANNOTATIONS: ScoreSpecInput = frozen(annotated(5));

/** F01 plus one dangling reference in every referencing layer. INVALID. */
export const F11_INVALID_REFERENCES: ScoreSpecInput = frozen({
  ...cloneFixture(F01),
  id: 'f11-refs',
  harmony: [{ id: 'f11-h1', measureId: 'f11-missing-bar', analysis: { romanNumeral: 'I' } }],
  slurs: [{ id: 'f11-s1', startNoteId: 'f01-n1', endNoteId: 'f11-missing-note' }],
  dynamics: [{ id: 'f11-d1', type: 'mark', eventId: 'f11-missing-event', marking: 'mf' }],
  pedal: [{ id: 'f11-p1', type: 'sustain', startEventId: 'f01-n1', endEventId: 'f11-missing-end' }],
  scaleDegrees: [{ id: 'f11-sd1', noteId: 'f11-missing-degree-note', degree: 1 }],
  annotations: [
    { id: 'f11-a1', color: 'red', noteIds: ['f11-missing-annotated'], text: 'Missing' },
  ],
});

/** Payloads that are not ScoreSpec v1 documents at all. Each is INVALID. */
export const F11_MALFORMED: readonly { readonly name: string; readonly input: unknown }[] = frozen([
  { name: 'null', input: null },
  { name: 'a string', input: 'C4 D4 E4 F4' },
  { name: 'an array', input: [] },
  { name: 'an empty object', input: {} },
  { name: 'staves not an array', input: { ...cloneFixture(F01), staves: 'rh' } },
]);
