/**
 * SPEC-04 (issue #2): written pitch and labels. F#4 and Gb4 stay distinct;
 * key fifths -7..7, fingerings 1..5 and scale degrees 1..7 with bounded
 * alterations; chord symbols, Roman analysis and degrees remain separate data.
 * Sounding MIDI numbers are asserted in #6, not here.
 */
import {
  type ErrorPath,
  type ScoreSpecInput,
  buildScoreIndex,
  formatWrittenPitch,
  writtenPitchToKey,
  writtenPitchesEqual,
} from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import {
  F01,
  F03,
  F03_ORACLE,
  F05,
  F05_ORACLE,
  bar,
  chord,
  member,
  pitch,
  score,
  staff,
  voice,
} from '../src';
import {
  accepted,
  at,
  codesAndPaths,
  eventAt,
  eventPath,
  rejected,
  summarize,
  variant,
} from './support';

const firstNote = eventPath(0, 0, 0, 0);

/** A single whole-note chord made of the given spellings. */
function wholeChord(spellings: string[]): ScoreSpecInput {
  return score({
    id: 'chord',
    staves: [
      staff('rh', 'right', [
        bar('m1', 1, [
          voice('v1', [
            chord(
              'c1',
              spellings.map((spelled, index) => member(`c1-${index + 1}`, spelled)),
              'whole',
            ),
          ]),
        ]),
      ]),
    ],
  });
}

/** F01 with its first note respelled. */
function firstNoteAs(spelled: string): ScoreSpecInput {
  return variant(F01, (draft) => {
    const event = eventAt(draft, 0, 0, 0, 0);
    if (event.type === 'note') {
      event.pitch = pitch(spelled);
    }
  });
}

describe('SPEC-04 pitch and labels', () => {
  it('keeps F#4 and Gb4 as different written pitches of the same key', () => {
    const index = buildScoreIndex(accepted(F05));
    const sharp = index.noteTarget(F05_ORACLE.sharpNoteId)?.pitch;
    const flat = index.noteTarget(F05_ORACLE.flatNoteId)?.pitch;
    if (sharp === undefined || flat === undefined) {
      throw new Error('F05 notes must be indexed');
    }
    expect(sharp).toEqual({ step: 'F', alter: 1, octave: 4 });
    expect(flat).toEqual({ step: 'G', alter: -1, octave: 4 });
    expect(writtenPitchesEqual(sharp, flat)).toBe(false);
    expect([formatWrittenPitch(sharp), formatWrittenPitch(flat)]).toEqual([
      F05_ORACLE.writtenSpellings['f05-fs'],
      F05_ORACLE.writtenSpellings['f05-gb'],
    ]);
    expect(writtenPitchToKey(sharp)).toBe(writtenPitchToKey(flat));
  });

  it('allows two spellings of one key in a chord but not the same written pitch twice', () => {
    expect(accepted(wholeChord(['F#4', 'Gb4'])).id).toBe('chord');
    expect(summarize(rejected(wholeChord(['C4', 'E4', 'E4'])))).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        {
          code: 'CHORD_DUPLICATE_PITCH',
          path: [...firstNote, 'notes', 2, 'pitch'],
          ids: ['c1', 'c1-3'],
        },
      ],
    });
  });

  it.each([
    { name: 'A0, the lowest piano key', spelled: 'A0' },
    { name: 'C8, the highest piano key', spelled: 'C8' },
    { name: 'B#3 (spelled above the octave line)', spelled: 'B#3' },
  ])('accepts $name', ({ spelled }) => {
    expect(accepted(firstNoteAs(spelled)).id).toBe('f01');
  });

  it.each([
    { name: 'G#0, below A0', spelled: 'G#0' },
    { name: 'C#8, above C8', spelled: 'C#8' },
    { name: 'Cb0, whose spelling reaches below the keyboard', spelled: 'Cb0' },
  ])('rejects $name as out of the piano range', ({ spelled }) => {
    expect(summarize(rejected(firstNoteAs(spelled))).details).toEqual([
      { code: 'PITCH_OUT_OF_RANGE', path: [...firstNote, 'pitch'], ids: ['f01-n1'] },
    ]);
  });

  const scalarTable: {
    name: string;
    edit: (draft: ScoreSpecInput) => void;
    rejectedAt?: { code: string; path: ErrorPath };
  }[] = [
    { name: 'key signature -7 fifths', edit: (draft) => (draft.keySignature = { fifths: -7 }) },
    { name: 'key signature +7 fifths', edit: (draft) => (draft.keySignature = { fifths: 7 }) },
    {
      name: 'key signature -8 fifths',
      edit: (draft) => (draft.keySignature = { fifths: -8 }),
      rejectedAt: { code: 'INVALID_VALUE', path: ['keySignature', 'fifths'] },
    },
    {
      name: 'key signature +8 fifths',
      edit: (draft) => (draft.keySignature = { fifths: 8 }),
      rejectedAt: { code: 'INVALID_VALUE', path: ['keySignature', 'fifths'] },
    },
    {
      name: 'key signature 1.5 fifths',
      edit: (draft) => (draft.keySignature = { fifths: 1.5 }),
      rejectedAt: { code: 'INVALID_TYPE', path: ['keySignature', 'fifths'] },
    },
    {
      name: 'fingering 1',
      edit: (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { fingering: 1 }),
    },
    {
      name: 'fingering 5',
      edit: (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { fingering: 5 }),
    },
    {
      name: 'fingering 0',
      edit: (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { fingering: 0 }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...firstNote, 'fingering'] },
    },
    {
      name: 'fingering 6',
      edit: (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { fingering: 6 }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...firstNote, 'fingering'] },
    },
    {
      name: 'pitch alteration +3',
      edit: (draft) =>
        Object.assign(eventAt(draft, 0, 0, 0, 0), { pitch: { step: 'C', alter: 3, octave: 4 } }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...firstNote, 'pitch', 'alter'] },
    },
    {
      name: 'pitch step H',
      edit: (draft) =>
        Object.assign(eventAt(draft, 0, 0, 0, 0), { pitch: { step: 'H', alter: 0, octave: 4 } }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...firstNote, 'pitch', 'step'] },
    },
    {
      name: 'pitch octave 9',
      edit: (draft) =>
        Object.assign(eventAt(draft, 0, 0, 0, 0), { pitch: { step: 'C', alter: 0, octave: 9 } }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...firstNote, 'pitch', 'octave'] },
    },
    {
      name: 'a repeated articulation',
      edit: (draft) =>
        Object.assign(eventAt(draft, 0, 0, 0, 0), { articulations: ['accent', 'accent'] }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...firstNote, 'articulations'] },
    },
    {
      name: 'an unsupported articulation',
      edit: (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { articulations: ['fermata'] }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...firstNote, 'articulations', 0] },
    },
    {
      name: 'an unsupported mode',
      edit: (draft) =>
        (draft.tonalContext = { tonic: { step: 'C', alter: 0 }, mode: 'blues' as 'major' }),
      rejectedAt: { code: 'INVALID_VALUE', path: ['tonalContext', 'mode'] },
    },
  ];

  it.each(scalarTable)('scalar: $name', ({ edit, rejectedAt }) => {
    const input = variant(F01, edit);
    if (rejectedAt === undefined) {
      expect(accepted(input).id).toBe('f01');
    } else {
      expect(codesAndPaths(rejected(input))).toEqual([rejectedAt]);
    }
  });

  it('keeps chord symbols, Roman analysis and scale degrees as separate data (F03)', () => {
    const value = accepted(F03);
    expect(
      (value.harmony ?? []).map((event) => ({
        id: event.id,
        display: event.chord?.display,
        romanNumeral: event.analysis?.romanNumeral,
      })),
    ).toEqual(
      F03_ORACLE.harmony.map(({ id, display, romanNumeral }) => ({ id, display, romanNumeral })),
    );
    expect(value.harmony?.[1]?.chord).toEqual({
      root: { step: 'G', alter: 0 },
      quality: 'dominant',
      extension: 7,
      alterations: ['b9'],
      display: 'G7(b9)',
    });
    expect(
      Object.fromEntries((value.scaleDegrees ?? []).map((label) => [label.noteId, label.degree])),
    ).toEqual(F03_ORACLE.scaleDegrees);
  });

  const harmonyPath: ErrorPath = ['harmony', 0];
  const harmonyTable: {
    name: string;
    edit: (draft: ScoreSpecInput) => void;
    rejectedAt?: { code: string; path: ErrorPath };
  }[] = [
    {
      name: 'analysis without a chord symbol',
      edit: (draft) => delete at(draft.harmony, 0).chord,
    },
    {
      name: 'a chord symbol without analysis',
      edit: (draft) => delete at(draft.harmony, 0).analysis,
    },
    {
      name: 'neither chord symbol nor analysis',
      edit: (draft) => {
        const event = at(draft.harmony, 0);
        delete event.chord;
        delete event.analysis;
      },
      rejectedAt: { code: 'INVALID_VALUE', path: harmonyPath },
    },
    {
      name: 'chord extension 8',
      edit: (draft) => Object.assign(at(draft.harmony, 0).chord ?? {}, { extension: 8 }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...harmonyPath, 'chord', 'extension'] },
    },
    {
      name: 'chord quality "sus"',
      edit: (draft) => Object.assign(at(draft.harmony, 0).chord ?? {}, { quality: 'sus' }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...harmonyPath, 'chord', 'quality'] },
    },
    {
      name: 'a blank Roman numeral',
      edit: (draft) => Object.assign(at(draft.harmony, 0).analysis ?? {}, { romanNumeral: '  ' }),
      rejectedAt: { code: 'INVALID_VALUE', path: [...harmonyPath, 'analysis', 'romanNumeral'] },
    },
    {
      name: 'scale degree 0',
      edit: (draft) => Object.assign(at(draft.scaleDegrees, 0), { degree: 0 }),
      rejectedAt: { code: 'INVALID_VALUE', path: ['scaleDegrees', 0, 'degree'] },
    },
    {
      name: 'scale degree 8',
      edit: (draft) => Object.assign(at(draft.scaleDegrees, 0), { degree: 8 }),
      rejectedAt: { code: 'INVALID_VALUE', path: ['scaleDegrees', 0, 'degree'] },
    },
    {
      name: 'scale degree alteration -2',
      edit: (draft) => Object.assign(at(draft.scaleDegrees, 0), { alter: -2, display: 'bb4' }),
    },
    {
      name: 'scale degree alteration +3',
      edit: (draft) => Object.assign(at(draft.scaleDegrees, 0), { alter: 3 }),
      rejectedAt: { code: 'INVALID_VALUE', path: ['scaleDegrees', 0, 'alter'] },
    },
  ];

  it.each(harmonyTable)('harmony and degrees: $name', ({ edit, rejectedAt }) => {
    const input = variant(F03, edit);
    if (rejectedAt === undefined) {
      expect(accepted(input).id).toBe('f03');
    } else {
      expect(codesAndPaths(rejected(input))).toEqual([rejectedAt]);
    }
  });

  it('rejects a harmony position outside its bar', () => {
    const input = variant(F03, (draft) => {
      at(draft.harmony, 1).offset = { numerator: 1, denominator: 1 };
    });
    expect(summarize(rejected(input)).details).toEqual([
      { code: 'POSITION_OUT_OF_RANGE', path: ['harmony', 1, 'offset'], ids: ['f03-h2'] },
    ]);
  });

  it('rejects two harmony events at the same bar position, comparing offsets by value', () => {
    const input = variant(F03, (draft) => {
      at(draft.harmony, 2).measureId = 'f03-m1';
      at(draft.harmony, 2).offset = { numerator: 2, denominator: 4 };
    });
    expect(summarize(rejected(input)).details).toEqual([
      { code: 'ATTACHMENT_CONFLICT', path: ['harmony'], ids: ['f03-m1', 'f03-h2', 'f03-h3'] },
    ]);
  });

  it('rejects two scale-degree labels on one note', () => {
    const input = variant(F03, (draft) => {
      at(draft.scaleDegrees, 1).noteId = 'f03-rh-n1';
    });
    expect(summarize(rejected(input)).details).toEqual([
      {
        code: 'ATTACHMENT_CONFLICT',
        path: ['scaleDegrees'],
        ids: ['f03-rh-n1', 'f03-sd1', 'f03-sd2'],
      },
    ]);
  });
});
