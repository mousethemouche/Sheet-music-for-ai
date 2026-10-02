/**
 * SPEC-05 (issue #2): references and spans. IDs are unique, chord members are
 * separately addressable, dangling or wrong-kind targets and reversed,
 * cross-staff or overlapping spans are rejected, tie endpoints must match, and
 * slurs stay distinct from same-pitch ties. One valid combined expression
 * fixture (F08) plus targeted negative variants.
 */
import { type ErrorPath, type ScoreSpecInput, buildScoreIndex } from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import {
  type ChordNoteInput,
  F02,
  F02_ORACLE,
  F07,
  F08,
  F08_ORACLE,
  F11_INVALID_REFERENCES,
  RICH_WIRE_FIXTURE,
  RICH_WIRE_ORACLE,
  bar,
  chord,
  member,
  note,
  pitch,
  score,
  staff,
  voice,
} from '../src';
import {
  accepted,
  at,
  eventAt,
  eventPath,
  measureAt,
  rejected,
  summarize,
  variant,
  voiceAt,
} from './support';

interface Expected {
  readonly code: string;
  readonly path: ErrorPath;
  readonly ids: readonly string[];
}

function expectOnly(input: ScoreSpecInput, details: readonly Expected[]): void {
  expect(summarize(rejected(input))).toEqual({ code: 'SCORE_VALIDATION_FAILED', details });
}

describe('SPEC-05 references and spans', () => {
  describe('the valid expression fixture (F08)', () => {
    it('keeps slurs and ties distinct, including a slur over a repeated, untied pitch', () => {
      const value = accepted(F08);
      const index = buildScoreIndex(value);
      expect(index.ties.map((pair) => [pair.from.id, pair.to.id])).toEqual(F08_ORACLE.tiePairs);
      expect((value.slurs ?? []).map((slur) => slur.id)).toEqual(F08_ORACLE.slurIds);
      const [repeatedFrom, repeatedTo] = F08_ORACLE.repeatedPitchSlur.noteIds;
      expect(value.slurs?.[1]).toEqual({
        id: 'f08-s2',
        startNoteId: repeatedFrom,
        endNoteId: repeatedTo,
      });
      expect(index.ties.some((pair) => pair.to.id === repeatedTo)).toBe(false);
    });

    it('accepts adjacent pedal spans (a pedal change) and a pedal held on one event', () => {
      const spans = buildScoreIndex(accepted(F08));
      expect(spans.location('f08-lh-n3')?.onset).toEqual({ numerator: 2, denominator: 1 });
      expect(accepted(F08).pedal?.map((span) => [span.startEventId, span.endEventId])).toEqual([
        ['f08-lh-n3', 'f08-lh-n3'],
        ['f08-lh-n4', 'f08-lh-n5'],
      ]);
    });
  });

  describe('stable IDs', () => {
    it('addresses each chord member separately, with its chord, staff, bar, voice and position', () => {
      const index = buildScoreIndex(accepted(F02));
      const third = index.noteTarget('f02-c1-e');
      expect(third).toMatchObject({
        id: 'f02-c1-e',
        eventId: F02_ORACLE.chordId,
        pitch: pitch('E4'),
        location: {
          staffId: 'f02-rh',
          measureId: 'f02-m1',
          voiceId: 'f02-rh-m1-v1',
          onset: { numerator: 0, denominator: 1 },
          duration: { numerator: 1, denominator: 2 },
        },
      });
      expect(index.get('f02-c1-e')?.kind).toBe('chordNote');
      expect(index.notesOfEvent(F02_ORACLE.chordId).map((target) => target.id)).toEqual(
        F02_ORACLE.chordMemberIds,
      );
      expect(index.get(F02_ORACLE.chordId)?.kind).toBe('event');
      expect(index.noteTarget(F02_ORACLE.chordId)).toBeUndefined();
      expect(index.location('f02-lh-n2')?.onset).toEqual({ numerator: 1, denominator: 4 });
    });

    const duplicates: { name: string; input: ScoreSpecInput; details: Expected[] }[] = [
      {
        name: 'two events with one ID',
        input: variant(F02, (draft) => {
          eventAt(draft, 0, 0, 0, 2).id = 'f02-rh-n1';
        }),
        details: [{ code: 'DUPLICATE_ID', path: eventPath(0, 0, 0, 2), ids: ['f02-rh-n1'] }],
      },
      {
        name: 'a chord member reusing a note ID',
        input: variant(F02, (draft) => {
          const event = eventAt(draft, 0, 0, 0, 0);
          if (event.type === 'chord') {
            at(event.notes, 1).id = 'f02-lh-n1';
          }
        }),
        details: [{ code: 'DUPLICATE_ID', path: eventPath(1, 0, 0, 0), ids: ['f02-lh-n1'] }],
      },
      {
        name: 'a bar ID reused by another bar',
        input: variant(F02, (draft) => {
          measureAt(draft, 0, 1).id = 'f02-m1';
          measureAt(draft, 1, 1).id = 'f02-m1';
        }),
        details: [
          { code: 'DUPLICATE_ID', path: ['staves', 0, 'measures', 1], ids: ['f02-m1'] },
          { code: 'DUPLICATE_ID', path: ['staves', 1, 'measures', 1], ids: ['f02-m1'] },
        ],
      },
      {
        name: 'a tuplet group ID equal to an event ID',
        input: variant(RICH_WIRE_FIXTURE, (draft) => {
          for (const index of [2, 3, 4]) {
            const tuplet = eventAt(draft, 0, 1, 0, index).duration.tuplet;
            if (tuplet !== undefined) {
              tuplet.groupId = 'rich-rh-n3';
            }
          }
        }),
        details: [
          {
            code: 'DUPLICATE_ID',
            path: [...eventPath(0, 1, 0, 2), 'duration', 'tuplet', 'groupId'],
            ids: ['rich-rh-n3'],
          },
        ],
      },
      {
        name: 'an annotation reusing a note ID',
        input: variant(F02, (draft) => {
          draft.annotations = [
            { id: 'f02-rh-n2', color: 'red', noteIds: ['f02-rh-n1'], text: 'Clash' },
          ];
        }),
        details: [{ code: 'DUPLICATE_ID', path: ['annotations', 0], ids: ['f02-rh-n2'] }],
      },
    ];

    it.each(duplicates)('rejects $name', ({ input, details }) => {
      expectOnly(input, details);
    });
  });

  describe('references must resolve to the right kind of element', () => {
    it('rejects a dangling reference in every referencing layer (F11)', () => {
      expectOnly(F11_INVALID_REFERENCES, [
        {
          code: 'REFERENCE_NOT_FOUND',
          path: ['harmony', 0, 'measureId'],
          ids: ['f11-missing-bar'],
        },
        { code: 'REFERENCE_NOT_FOUND', path: ['slurs', 0, 'endNoteId'], ids: ['f11-missing-note'] },
        {
          code: 'REFERENCE_NOT_FOUND',
          path: ['dynamics', 0, 'eventId'],
          ids: ['f11-missing-event'],
        },
        { code: 'REFERENCE_NOT_FOUND', path: ['pedal', 0, 'endEventId'], ids: ['f11-missing-end'] },
        {
          code: 'REFERENCE_NOT_FOUND',
          path: ['scaleDegrees', 0, 'noteId'],
          ids: ['f11-missing-degree-note'],
        },
        {
          code: 'REFERENCE_NOT_FOUND',
          path: ['annotations', 0, 'noteIds', 0],
          ids: ['f11-missing-annotated'],
        },
      ]);
    });

    it('rejects a dangling hairpin start', () => {
      const input = variant(F08, (draft) => {
        Object.assign(at(draft.dynamics, 1), { startEventId: 'f08-nowhere' });
      });
      expectOnly(input, [
        {
          code: 'REFERENCE_NOT_FOUND',
          path: ['dynamics', 1, 'startEventId'],
          ids: ['f08-nowhere'],
        },
      ]);
    });

    const wrongKinds: { name: string; input: ScoreSpecInput; path: ErrorPath; id: string }[] = [
      {
        name: 'a slur ending on a rest',
        input: variant(F07, (draft) => {
          draft.slurs = [{ id: 's1', startNoteId: 'f07-rh-n1', endNoteId: 'f07-lh-r1' }];
        }),
        path: ['slurs', 0, 'endNoteId'],
        id: 'f07-lh-r1',
      },
      {
        name: 'an annotation targeting a whole chord instead of a member',
        input: variant(F02, (draft) => {
          draft.annotations = [{ id: 'a1', color: 'red', noteIds: ['f02-c1'], text: 'Chord' }];
        }),
        path: ['annotations', 0, 'noteIds', 0],
        id: 'f02-c1',
      },
      {
        name: 'a dynamic mark on a chord member instead of an event',
        input: variant(F02, (draft) => {
          draft.dynamics = [{ id: 'd1', type: 'mark', eventId: 'f02-c1-e', marking: 'mf' }];
        }),
        path: ['dynamics', 0, 'eventId'],
        id: 'f02-c1-e',
      },
      {
        name: 'a harmony event anchored to an event instead of a bar',
        input: variant(F02, (draft) => {
          draft.harmony = [{ id: 'h1', measureId: 'f02-c1', analysis: { romanNumeral: 'I' } }];
        }),
        path: ['harmony', 0, 'measureId'],
        id: 'f02-c1',
      },
      {
        name: 'a scale degree on a voice',
        input: variant(F02, (draft) => {
          draft.scaleDegrees = [{ id: 'sd1', noteId: 'f02-rh-m1-v1', degree: 1 }];
        }),
        path: ['scaleDegrees', 0, 'noteId'],
        id: 'f02-rh-m1-v1',
      },
      {
        name: 'a pedal ending on a bar ID',
        input: variant(F02, (draft) => {
          draft.pedal = [
            { id: 'p1', type: 'sustain', startEventId: 'f02-lh-n1', endEventId: 'f02-m2' },
          ];
        }),
        path: ['pedal', 0, 'endEventId'],
        id: 'f02-m2',
      },
    ];

    it.each(wrongKinds)('rejects $name', ({ input, path, id }) => {
      expectOnly(input, [{ code: 'REFERENCE_KIND_MISMATCH', path, ids: [id] }]);
    });
  });

  describe('spans are ordered in musical time, on one staff, without overlap', () => {
    const spans: { name: string; edit: (draft: ScoreSpecInput) => void; expected: Expected[] }[] = [
      {
        name: 'a reversed slur',
        edit: (draft) =>
          Object.assign(at(draft.slurs, 0), { startNoteId: 'f08-rh-n4', endNoteId: 'f08-rh-n1' }),
        expected: [{ code: 'SPAN_ORDER_INVALID', path: ['slurs', 0], ids: ['f08-s1'] }],
      },
      {
        name: 'a slur that starts and ends on one note',
        edit: (draft) => Object.assign(at(draft.slurs, 0), { endNoteId: 'f08-rh-n1' }),
        expected: [{ code: 'SPAN_ORDER_INVALID', path: ['slurs', 0], ids: ['f08-s1'] }],
      },
      {
        name: 'a reversed crescendo',
        edit: (draft) =>
          Object.assign(at(draft.dynamics, 1), {
            startEventId: 'f08-rh-n4',
            endEventId: 'f08-rh-n1',
          }),
        expected: [{ code: 'SPAN_ORDER_INVALID', path: ['dynamics', 1], ids: ['f08-d2'] }],
      },
      {
        name: 'a reversed pedal span',
        edit: (draft) =>
          Object.assign(at(draft.pedal, 1), { startEventId: 'f08-lh-n5', endEventId: 'f08-lh-n4' }),
        expected: [{ code: 'SPAN_ORDER_INVALID', path: ['pedal', 1], ids: ['f08-p2'] }],
      },
      {
        name: 'a slur from the right hand to the left hand',
        edit: (draft) => Object.assign(at(draft.slurs, 0), { endNoteId: 'f08-lh-n2' }),
        expected: [{ code: 'SPAN_CROSS_STAFF', path: ['slurs', 0], ids: ['f08-s1'] }],
      },
      {
        name: 'a hairpin from the right hand to the left hand',
        edit: (draft) => Object.assign(at(draft.dynamics, 1), { endEventId: 'f08-lh-n1' }),
        expected: [{ code: 'SPAN_CROSS_STAFF', path: ['dynamics', 1], ids: ['f08-d2'] }],
      },
      {
        name: 'a pedal span anchored on both staves',
        edit: (draft) => Object.assign(at(draft.pedal, 0), { endEventId: 'f08-rh-n11' }),
        expected: [{ code: 'SPAN_CROSS_STAFF', path: ['pedal', 0], ids: ['f08-p1'] }],
      },
      {
        name: 'overlapping pedal spans',
        edit: (draft) => Object.assign(at(draft.pedal, 1), { startEventId: 'f08-lh-n3' }),
        expected: [{ code: 'SPAN_OVERLAP', path: ['pedal', 1], ids: ['f08-p1', 'f08-p2'] }],
      },
      {
        name: 'overlapping hairpins on one staff',
        edit: (draft) =>
          draft.dynamics?.push({
            id: 'f08-d5',
            type: 'hairpin',
            direction: 'diminuendo',
            startEventId: 'f08-rh-n3',
            endEventId: 'f08-rh-n5',
          }),
        expected: [{ code: 'SPAN_OVERLAP', path: ['dynamics', 4], ids: ['f08-d2', 'f08-d5'] }],
      },
      {
        name: 'two dynamic marks on one event',
        edit: (draft) =>
          draft.dynamics?.push({ id: 'f08-d5', type: 'mark', eventId: 'f08-rh-n1', marking: 'mf' }),
        expected: [
          {
            code: 'ATTACHMENT_CONFLICT',
            path: ['dynamics'],
            ids: ['f08-rh-n1', 'f08-d1', 'f08-d5'],
          },
        ],
      },
    ];

    it.each(spans)('rejects $name', ({ edit, expected }) => {
      expectOnly(variant(F08, edit), expected);
    });

    it('accepts a hairpin on a single event and hairpins overlapping on different staves', () => {
      const input = variant(F08, (draft) => {
        draft.dynamics?.push(
          {
            id: 'f08-d5',
            type: 'hairpin',
            direction: 'crescendo',
            startEventId: 'f08-lh-n1',
            endEventId: 'f08-lh-n1',
          },
          {
            id: 'f08-d6',
            type: 'hairpin',
            direction: 'diminuendo',
            startEventId: 'f08-rh-n5',
            endEventId: 'f08-rh-n5',
          },
        );
      });
      expect(accepted(input).dynamics).toHaveLength(6);
    });
  });

  describe('ties', () => {
    it('pairs a tied chord member with the same written pitch in the next event (rich fixture)', () => {
      const index = buildScoreIndex(accepted(RICH_WIRE_FIXTURE));
      expect(index.ties.map((pair) => [pair.from.id, pair.to.id])).toEqual(
        RICH_WIRE_ORACLE.tiePairs,
      );
    });

    /** A whole-note chord in bar 1 followed by one in bar 2, in the same voice lane. */
    const chordToChord = (first: ChordNoteInput[], second: ChordNoteInput[]): ScoreSpecInput =>
      score({
        id: 'chord-ties',
        staves: [
          staff('rh', 'right', [
            bar('m1', 1, [voice('m1-v1', [chord('c1', first, 'whole')])]),
            bar('m2', 2, [voice('m2-v1', [chord('c2', second, 'whole')])]),
          ]),
        ],
      });
    const memberTie = (measure: number, memberIndex: number): ErrorPath => [
      ...eventPath(0, measure, 0, 0),
      'notes',
      memberIndex,
      'tie',
    ];

    it('ties chord members to chord members across a bar line, pitch by pitch', () => {
      const input = chordToChord(
        [member('c1-c', 'C4', { tie: { start: true } }), member('c1-e', 'E4')],
        [member('c2-c', 'C4', { tie: { end: true } }), member('c2-g', 'G4')],
      );
      const index = buildScoreIndex(accepted(input));
      expect(index.ties.map((pair) => [pair.from.id, pair.to.id])).toEqual([['c1-c', 'c2-c']]);
    });

    const chordTies: { name: string; input: ScoreSpecInput; expected: Expected[] }[] = [
      {
        name: 'the tie end sits on a different-pitch member of the next chord',
        input: chordToChord(
          [member('c1-c', 'C4', { tie: { start: true } }), member('c1-e', 'E4')],
          [member('c2-c', 'C4'), member('c2-g', 'G4', { tie: { end: true } })],
        ),
        expected: [
          { code: 'TIE_UNMATCHED', path: memberTie(0, 0), ids: ['c1-c', 'c2-c'] },
          { code: 'TIE_UNMATCHED', path: memberTie(1, 1), ids: ['c2-g'] },
        ],
      },
      {
        name: 'the next chord has no member of the same written pitch',
        input: chordToChord(
          [member('c1-c', 'C4', { tie: { start: true } }), member('c1-e', 'E4')],
          [member('c2-d', 'D4'), member('c2-g', 'G4')],
        ),
        expected: [{ code: 'TIE_UNMATCHED', path: memberTie(0, 0), ids: ['c1-c'] }],
      },
    ];

    it.each(chordTies)('rejects a chord-member tie when $name', ({ input, expected }) => {
      expectOnly(input, expected);
    });

    const n9 = [...eventPath(0, 2, 0, 0), 'tie'];
    const n10 = [...eventPath(0, 2, 0, 1), 'tie'];
    const ties: { name: string; edit: (draft: ScoreSpecInput) => void; expected: Expected[] }[] = [
      {
        name: 'the next note has a different pitch',
        edit: (draft) => Object.assign(eventAt(draft, 0, 2, 0, 1), { pitch: pitch('A4') }),
        expected: [
          { code: 'TIE_UNMATCHED', path: n9, ids: ['f08-rh-n9'] },
          { code: 'TIE_UNMATCHED', path: n10, ids: ['f08-rh-n10'] },
        ],
      },
      {
        name: 'the next note is an enharmonic respelling (Abb4 after G4)',
        edit: (draft) => Object.assign(eventAt(draft, 0, 2, 0, 1), { pitch: pitch('Abb4') }),
        expected: [
          { code: 'TIE_UNMATCHED', path: n9, ids: ['f08-rh-n9'] },
          { code: 'TIE_UNMATCHED', path: n10, ids: ['f08-rh-n10'] },
        ],
      },
      {
        name: 'the tie end has no start',
        edit: (draft) => delete (eventAt(draft, 0, 2, 0, 0) as { tie?: unknown }).tie,
        expected: [{ code: 'TIE_UNMATCHED', path: n10, ids: ['f08-rh-n10'] }],
      },
      {
        name: 'the tie start reaches a note without tie.end',
        edit: (draft) => delete (eventAt(draft, 0, 2, 0, 1) as { tie?: unknown }).tie,
        expected: [{ code: 'TIE_UNMATCHED', path: n9, ids: ['f08-rh-n9', 'f08-rh-n10'] }],
      },
      {
        name: 'a tie into a rest',
        edit: (draft) => {
          voiceAt(draft, 0, 2, 0).events.splice(1, 1, {
            id: 'f08-rh-r1',
            type: 'rest',
            duration: { value: 'quarter' },
          });
          draft.slurs = draft.slurs?.filter((slur) => slur.id !== 'f08-s2') ?? [];
        },
        expected: [{ code: 'TIE_UNMATCHED', path: n9, ids: ['f08-rh-n9'] }],
      },
      {
        name: 'a tie from the last note of the score',
        edit: (draft) => Object.assign(eventAt(draft, 0, 3, 0, 3), { tie: { start: true } }),
        expected: [
          { code: 'TIE_UNMATCHED', path: [...eventPath(0, 3, 0, 3), 'tie'], ids: ['f08-rh-n15'] },
        ],
      },
    ];

    it.each(ties)('rejects a tie when $name', ({ edit, expected }) => {
      expectOnly(variant(F08, edit), expected);
    });

    it('ties across a bar line in the same voice position', () => {
      const input = score({
        id: 'bar-tie',
        staves: [
          staff('rh', 'right', [
            bar('m1', 1, [
              voice('m1-v1', [
                note('n1', 'C4', 'half'),
                note('n2', 'E4', 'half', { tie: { start: true } }),
              ]),
            ]),
            bar('m2', 2, [
              voice('m2-v1', [
                note('n3', 'E4', 'half', { tie: { end: true } }),
                note('n4', 'C4', 'half'),
              ]),
            ]),
          ]),
        ],
      });
      expect(
        buildScoreIndex(accepted(input)).ties.map((pair) => [pair.from.id, pair.to.id]),
      ).toEqual([['n2', 'n3']]);
    });
  });
});
