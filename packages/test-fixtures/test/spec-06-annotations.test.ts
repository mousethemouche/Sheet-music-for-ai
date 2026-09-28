/**
 * SPEC-06 (issue #2): teaching annotations and P-03. Disjoint colors and
 * same-canonical-color overlaps are valid; different colors on one note are
 * rejected with SCORE_VALIDATION_FAILED / ANNOTATION_COLOR_CONFLICT listing
 * safe IDs, whatever the annotation order. Never last-wins. The other
 * annotation text/reference rules still apply.
 */
import { type ErrorPath, type ScoreSpecInput, canonicalizeColor } from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import {
  F07,
  F09,
  F09_COLOR_CONFLICT,
  F09_ORACLE,
  F09_SAME_COLOR_OVERLAP,
  RICH_WIRE_FIXTURE,
  RICH_WIRE_ORACLE,
} from '../src';
import { accepted, at, codesAndPaths, rejected, summarize, variant } from './support';

const conflictDetail = (noteId: string, annotationIds: string[]) => ({
  code: 'ANNOTATION_COLOR_CONFLICT',
  path: ['annotations'],
  ids: [noteId, ...annotationIds],
});

describe('SPEC-06 teaching annotations and P-03 colors', () => {
  it('accepts three pink notes with matching text (F09) and stores the canonical color', () => {
    const annotation = accepted(F09).annotations[0];
    expect(annotation).toEqual({
      id: F09_ORACLE.annotationId,
      color: F09_ORACLE.canonicalColor,
      noteIds: F09_ORACLE.noteIds,
      text: F09_ORACLE.text,
    });
  });

  it('accepts disjoint annotations in different colors', () => {
    const input = variant(F09, (draft) => {
      draft.annotations.push({
        id: 'f09-a2',
        color: '#1e90ff',
        noteIds: ['f09-n4'],
        text: 'Octave',
      });
    });
    expect(accepted(input).annotations.map((annotation) => annotation.color)).toEqual([
      '#ff69b4',
      '#1e90ff',
    ]);
  });

  it('accepts overlapping annotations whose colors are the same once canonical', () => {
    expect(
      accepted(F09_SAME_COLOR_OVERLAP).annotations.map((annotation) => annotation.color),
    ).toEqual(['#ff69b4', '#ff69b4']);
  });

  it.each([
    { input: 'HotPink', canonical: '#ff69b4' },
    { input: '#FF69B4', canonical: '#ff69b4' },
    { input: '#F0C', canonical: '#ff00cc' },
    { input: 'rebeccapurple', canonical: '#663399' },
  ])('canonicalizes $input to $canonical', ({ input, canonical }) => {
    expect(canonicalizeColor(input)).toBe(canonical);
    const score = variant(F09, (draft) => {
      at(draft.annotations, 0).color = input;
    });
    expect(accepted(score).annotations[0]?.color).toBe(canonical);
  });

  it.each(['rgb(255, 105, 180)', '#ff69b480', '#12', ' pink', 'transparent', 'not-a-color'])(
    'rejects the color %j',
    (color) => {
      const score = variant(F09, (draft) => {
        at(draft.annotations, 0).color = color;
      });
      expect(codesAndPaths(rejected(score))).toEqual([
        { code: 'INVALID_VALUE', path: ['annotations', 0, 'color'] },
      ]);
    },
  );

  it('rejects two different colors on one note with the affected IDs', () => {
    expect(summarize(rejected(F09_COLOR_CONFLICT))).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [conflictDetail(F09_ORACLE.conflict.noteId, F09_ORACLE.conflict.annotationIds)],
    });
  });

  it('reports the same conflict whatever the annotation order (no last-wins)', () => {
    const reversed = variant(F09_COLOR_CONFLICT, (draft) => {
      draft.annotations.reverse();
    });
    expect(rejected(reversed)).toEqual(rejected(F09_COLOR_CONFLICT));
  });

  it('reports one conflict per affected note, in score order', () => {
    const input = variant(F09, (draft) => {
      draft.annotations.push({
        id: 'f09-a0',
        color: 'dodgerblue',
        noteIds: ['f09-n3', 'f09-n1'],
        text: 'Outer',
      });
    });
    expect(summarize(rejected(input)).details).toEqual([
      conflictDetail('f09-n1', ['f09-a0', 'f09-a1']),
      conflictDetail('f09-n3', ['f09-a0', 'f09-a1']),
    ]);
  });

  it('checks colors per chord member: only the doubly colored member conflicts', () => {
    const { id, chordId } = RICH_WIRE_ORACLE.coloredChordMember;
    const input = variant(RICH_WIRE_FIXTURE, (draft) => {
      draft.annotations.push({
        id: 'rich-a3',
        color: 'green',
        noteIds: [`${chordId}-g`, id],
        text: 'Root and third',
      });
    });
    expect(summarize(rejected(input)).details).toEqual([
      conflictDetail(id, ['rich-a1', 'rich-a3']),
    ]);
  });

  it('keeps reporting other problems next to a color conflict', () => {
    const input = variant(F09_COLOR_CONFLICT, (draft) => {
      at(draft.annotations, 1).noteIds.push('f09-ghost');
    });
    expect(summarize(rejected(input))).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        { code: 'REFERENCE_NOT_FOUND', path: ['annotations', 1, 'noteIds', 2], ids: ['f09-ghost'] },
        conflictDetail('f09-n3', ['f09-a1', 'f09-a2']),
      ],
    });
  });

  const otherRules: {
    name: string;
    input: ScoreSpecInput;
    expected: { code: string; path: ErrorPath; ids?: string[] };
  }[] = [
    {
      name: 'blank text',
      input: variant(F09, (draft) => {
        at(draft.annotations, 0).text = '   ';
      }),
      expected: { code: 'INVALID_VALUE', path: ['annotations', 0, 'text'] },
    },
    {
      name: 'text made only of invisible characters (zero-width space, word joiner)',
      input: variant(F09, (draft) => {
        at(draft.annotations, 0).text = '\u200B\u2060';
      }),
      expected: { code: 'INVALID_VALUE', path: ['annotations', 0, 'text'] },
    },
    {
      name: 'no target notes',
      input: variant(F09, (draft) => {
        at(draft.annotations, 0).noteIds = [];
      }),
      expected: { code: 'INVALID_VALUE', path: ['annotations', 0, 'noteIds'] },
    },
    {
      name: 'the same note listed twice',
      input: variant(F09, (draft) => {
        at(draft.annotations, 0).noteIds.push('f09-n1');
      }),
      expected: {
        code: 'REFERENCE_DUPLICATE',
        path: ['annotations', 0, 'noteIds', 3],
        ids: ['f09-n1'],
      },
    },
    {
      name: 'a rest as target',
      input: variant(F07, (draft) => {
        draft.annotations = [{ id: 'a1', color: 'pink', noteIds: ['f07-lh-r1'], text: 'Silence' }];
      }),
      expected: {
        code: 'REFERENCE_KIND_MISMATCH',
        path: ['annotations', 0, 'noteIds', 0],
        ids: ['f07-lh-r1'],
      },
    },
  ];

  it.each(otherRules)('still rejects $name', ({ input, expected }) => {
    expect(summarize(rejected(input)).details).toEqual([expected]);
  });

  it('accepts visible text that also contains an invisible character', () => {
    const input = variant(F09, (draft) => {
      at(draft.annotations, 0).text = 'Root\u200B';
    });
    expect(accepted(input).annotations[0]?.text).toBe('Root\u200B');
  });
});
