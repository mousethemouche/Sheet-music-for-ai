/**
 * SPEC-02 (issue #2): structure and MVP limits. One or two staves, 1..32
 * aligned bars (two hands x 32 bars count as 32), hand order, bar numbering,
 * clef defaults, and one compact table of bounded collections and texts.
 */
import { type ErrorPath, type ScoreSpecInput, buildScoreIndex } from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import {
  F01,
  F02,
  F07,
  F11_FOUR_ANNOTATIONS,
  F11_FIVE_ANNOTATIONS,
  F11_ONE_BAR,
  F11_THIRTY_THREE_BARS,
  F11_THIRTY_TWO_BARS,
  F11_THREE_STAVES,
  type EventInput,
  bar,
  chord,
  member,
  note,
  score,
  staff,
  voice,
} from '../src';
import { accepted, at, codesAndPaths, measureAt, rejected, summarize, variant } from './support';

/** F01's single bar with `count` identical voices. */
function withVoices(count: number): ScoreSpecInput {
  return variant(F01, (draft) => {
    const measure = measureAt(draft, 0, 0);
    const template = at(measure.voices, 0);
    measure.voices = Array.from({ length: count }, (_, voiceIndex) => ({
      id: `v${voiceIndex + 1}`,
      events: template.events.map((event, eventIndex) => ({
        ...event,
        id: `v${voiceIndex + 1}-e${eventIndex + 1}`,
      })),
    }));
  });
}

/** One 2/1 bar (two whole notes long) filled with `count` thirty-second notes. */
function withThirtySeconds(count: number): ScoreSpecInput {
  const events: EventInput[] = Array.from({ length: count }, (_, index) =>
    note(`t${index + 1}`, 'C4', 'thirtySecond'),
  );
  return score({
    id: 'thirty-seconds',
    timeSignature: { numerator: 2, denominator: 1 },
    staves: [staff('rh', 'right', [bar('m1', 1, [voice('v1', events)])])],
  });
}

const WHITE_KEYS = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'];

/** One whole-note chord of `count` distinct white keys from C4 upward. */
function withChordOf(count: number): ScoreSpecInput {
  return score({
    id: 'big-chord',
    staves: [
      staff('rh', 'right', [
        bar('m1', 1, [
          voice('v1', [
            chord(
              'c1',
              WHITE_KEYS.slice(0, count).map((spelled, index) =>
                member(`c1-${index + 1}`, spelled),
              ),
              'whole',
            ),
          ]),
        ]),
      ]),
    ],
  });
}

function withAnnotationText(text: string): ScoreSpecInput {
  return variant(F01, (draft) => {
    draft.annotations = [{ id: 'a1', color: 'pink', noteIds: ['f01-n1'], text }];
  });
}

describe('SPEC-02 structure and limits', () => {
  it('accepts one staff with one bar', () => {
    expect(accepted(F11_ONE_BAR).staves).toHaveLength(1);
  });

  it('accepts two hands of 32 aligned bars and counts them as 32 bars', () => {
    const index = buildScoreIndex(accepted(F11_THIRTY_TWO_BARS));
    expect(index.bars).toHaveLength(32);
    expect(index.bars.map((info) => info.number)).toEqual(
      Array.from({ length: 32 }, (_, i) => i + 1),
    );
    expect(index.totalDuration).toEqual({ numerator: 32, denominator: 1 });
  });

  const staffAndBarCounts: {
    name: string;
    input: ScoreSpecInput;
    code: string;
    detail: string;
    path: ErrorPath;
  }[] = [
    {
      name: 'zero staves',
      input: variant(F01, (draft) => {
        draft.staves = [];
      }),
      code: 'SCORE_VALIDATION_FAILED',
      detail: 'INVALID_VALUE',
      path: ['staves'],
    },
    {
      name: 'three staves',
      input: F11_THREE_STAVES,
      code: 'MVP_LIMIT_EXCEEDED',
      detail: 'TOO_MANY_STAVES',
      path: ['staves'],
    },
    {
      name: 'zero bars',
      input: variant(F01, (draft) => {
        at(draft.staves, 0).measures = [];
      }),
      code: 'SCORE_VALIDATION_FAILED',
      detail: 'INVALID_VALUE',
      path: ['staves', 0, 'measures'],
    },
  ];

  it.each(staffAndBarCounts)('rejects $name', ({ input, code, detail, path }) => {
    expect(summarize(rejected(input))).toEqual({ code, details: [{ code: detail, path }] });
  });

  it('rejects 33 bars on each hand as one MVP limit per staff', () => {
    expect(summarize(rejected(F11_THIRTY_THREE_BARS))).toEqual({
      code: 'MVP_LIMIT_EXCEEDED',
      details: [
        { code: 'TOO_MANY_MEASURES', path: ['staves', 0, 'measures'] },
        { code: 'TOO_MANY_MEASURES', path: ['staves', 1, 'measures'] },
      ],
    });
  });

  const mismatchedHands: { name: string; input: ScoreSpecInput; path: ErrorPath; ids: string[] }[] =
    [
      {
        name: 'the left hand has one bar fewer',
        input: variant(F02, (draft) => {
          at(draft.staves, 1).measures.pop();
        }),
        path: ['staves', 1, 'measures'],
        ids: ['f02-rh', 'f02-lh'],
      },
      {
        name: 'the left hand names its first bar differently',
        input: variant(F02, (draft) => {
          measureAt(draft, 1, 0).id = 'f02-lh-m1';
        }),
        path: ['staves', 1, 'measures', 0],
        ids: ['f02-m1', 'f02-lh-m1'],
      },
      {
        name: 'only the left hand changes meter locally',
        input: variant(F02, (draft) => {
          const measure = measureAt(draft, 1, 1);
          measure.timeSignature = { numerator: 4, denominator: 4 };
        }),
        path: ['staves', 1, 'measures', 1],
        ids: ['f02-m2'],
      },
    ];

  it.each(mismatchedHands)('rejects hands whose bars differ: $name', ({ input, path, ids }) => {
    expect(summarize(rejected(input))).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [{ code: 'MEASURE_ALIGNMENT_MISMATCH', path, ids }],
    });
  });

  it('rejects hands that disagree on the kind of a bar', () => {
    const input = variant(F07, (draft) => {
      measureAt(draft, 1, 2).kind = 'pickup';
    });
    expect(summarize(rejected(input)).details).toEqual([
      { code: 'MEASURE_KIND_INVALID', path: ['staves', 1, 'measures', 2], ids: ['f07-m3'] },
      { code: 'MEASURE_ALIGNMENT_MISMATCH', path: ['staves', 1, 'measures', 2], ids: ['f07-m3'] },
    ]);
  });

  it.each([
    { name: 'two right hands', hands: ['right', 'right'] as const },
    { name: 'the left hand above the right hand', hands: ['left', 'right'] as const },
  ])('rejects $name', ({ hands }) => {
    const input = variant(F02, (draft) => {
      at(draft.staves, 0).hand = hands[0];
      at(draft.staves, 1).hand = hands[1];
    });
    expect(summarize(rejected(input)).details).toEqual([
      { code: 'STAFF_HANDS_INVALID', path: ['staves'], ids: ['f02-rh', 'f02-lh'] },
    ]);
  });

  it('rejects bar numbers that are not 1-based and consecutive, on every staff', () => {
    const input = variant(F02, (draft) => {
      measureAt(draft, 0, 1).number = 3;
      measureAt(draft, 1, 1).number = 3;
    });
    expect(summarize(rejected(input)).details).toEqual([
      {
        code: 'MEASURE_NUMBER_INVALID',
        path: ['staves', 0, 'measures', 1, 'number'],
        ids: ['f02-m2'],
      },
      {
        code: 'MEASURE_NUMBER_INVALID',
        path: ['staves', 1, 'measures', 1, 'number'],
        ids: ['f02-m2'],
      },
    ]);
  });

  it('fills an omitted clef from the hand and keeps an explicit one', () => {
    const input = variant(F02, (draft) => {
      delete at(draft.staves, 0).clef;
      delete at(draft.staves, 1).clef;
    });
    expect(accepted(input).staves.map((part) => part.clef)).toEqual(['treble', 'bass']);

    const trebleLeftHand = variant(F02, (draft) => {
      at(draft.staves, 1).clef = 'treble';
    });
    expect(accepted(trebleLeftHand).staves.map((part) => part.clef)).toEqual(['treble', 'treble']);
  });

  const tagList = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => `tag-${index + 1}`);

  const limitTable: {
    name: string;
    input: ScoreSpecInput;
    rejectedWith?: { detail: string; path: ErrorPath };
  }[] = [
    { name: '0 annotations', input: F01 },
    { name: '4 annotations', input: F11_FOUR_ANNOTATIONS },
    {
      name: '5 annotations',
      input: F11_FIVE_ANNOTATIONS,
      rejectedWith: { detail: 'TOO_MANY_ANNOTATIONS', path: ['annotations'] },
    },
    { name: 'annotation text of 80 characters', input: withAnnotationText('é'.repeat(80)) },
    {
      name: 'annotation text of 80 emoji (160 UTF-16 units)',
      input: withAnnotationText('🎹'.repeat(80)),
    },
    {
      name: 'annotation text of 81 characters',
      input: withAnnotationText('a'.repeat(81)),
      rejectedWith: { detail: 'TEXT_TOO_LONG', path: ['annotations', 0, 'text'] },
    },
    { name: '4 voices in a bar', input: withVoices(4) },
    {
      name: '5 voices in a bar',
      input: withVoices(5),
      rejectedWith: { detail: 'TOO_MANY_ITEMS', path: ['staves', 0, 'measures', 0, 'voices'] },
    },
    { name: '64 events in a voice', input: withThirtySeconds(64) },
    {
      name: '65 events in a voice',
      input: withThirtySeconds(65),
      rejectedWith: {
        detail: 'TOO_MANY_ITEMS',
        path: ['staves', 0, 'measures', 0, 'voices', 0, 'events'],
      },
    },
    { name: 'a chord of 10 notes', input: withChordOf(10) },
    {
      name: 'a chord of 11 notes',
      input: withChordOf(11),
      rejectedWith: {
        detail: 'TOO_MANY_ITEMS',
        path: ['staves', 0, 'measures', 0, 'voices', 0, 'events', 0, 'notes'],
      },
    },
    { name: '16 tags', input: { ...F01, metadata: { tags: tagList(16) } } },
    {
      name: '17 tags',
      input: { ...F01, metadata: { tags: tagList(17) } },
      rejectedWith: { detail: 'TOO_MANY_ITEMS', path: ['metadata', 'tags'] },
    },
    { name: 'a title of 120 characters', input: { ...F01, metadata: { title: 't'.repeat(120) } } },
    {
      name: 'a title of 121 characters',
      input: { ...F01, metadata: { title: 't'.repeat(121) } },
      rejectedWith: { detail: 'TEXT_TOO_LONG', path: ['metadata', 'title'] },
    },
  ];

  it.each(limitTable)('limit: $name', ({ input, rejectedWith }) => {
    if (rejectedWith === undefined) {
      expect(accepted(input).id).toBe(input.id);
    } else {
      expect(summarize(rejected(input))).toEqual({
        code: 'MVP_LIMIT_EXCEEDED',
        details: [{ code: rejectedWith.detail, path: rejectedWith.path }],
      });
    }
  });

  it('reports SCORE_VALIDATION_FAILED when a limit is exceeded together with another violation', () => {
    const input = variant(withAnnotationText('a'.repeat(81)), (draft) => {
      Object.assign(draft.tempo, { bpm: 0 });
    });
    const error = rejected(input);
    expect(error.code).toBe('SCORE_VALIDATION_FAILED');
    expect(codesAndPaths(error)).toEqual([
      { code: 'INVALID_VALUE', path: ['tempo', 'bpm'] },
      { code: 'TEXT_TOO_LONG', path: ['annotations', 0, 'text'] },
    ]);
  });
});
