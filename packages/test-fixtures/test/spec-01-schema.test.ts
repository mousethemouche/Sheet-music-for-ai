/**
 * SPEC-01 (issue #2): schema and round-trip. The rich fixture keeps its fields
 * and IDs, input is never mutated, and wrong versions, types or forbidden
 * layout/infrastructure fields fail with a safe path and code.
 */
import {
  type EntityKind,
  type ErrorPath,
  buildScoreIndex,
  validateScoreSpec,
} from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import { F01, RICH_WIRE_FIXTURE, RICH_WIRE_ORACLE, cloneFixture } from '../src';
import { accepted, codesAndPaths, eventAt, eventPath, rejected, variant } from './support';

/** Paths of frozen objects inside `value`: none means the output shares no object with the input. */
function frozenObjectPaths(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  const own = Object.isFrozen(value) ? [path] : [];
  return [
    ...own,
    ...Object.entries(value).flatMap(([key, child]) => frozenObjectPaths(child, `${path}.${key}`)),
  ];
}

describe('SPEC-01 schema and round-trip', () => {
  it('accepts the rich wire fixture and returns it field for field', () => {
    expect(validateScoreSpec(RICH_WIRE_FIXTURE)).toEqual({ ok: true, value: RICH_WIRE_FIXTURE });
  });

  it('returns an equal score after a JSON serialization round-trip', () => {
    const first = accepted(RICH_WIRE_FIXTURE);
    const second = accepted(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });

  it('keeps every stable ID of the rich fixture addressable with its kind', () => {
    const index = buildScoreIndex(accepted(RICH_WIRE_FIXTURE));
    const expectations: [readonly string[], EntityKind][] = [
      [RICH_WIRE_ORACLE.staffIds, 'staff'],
      [RICH_WIRE_ORACLE.barIds, 'measure'],
      [RICH_WIRE_ORACLE.voiceIds, 'voice'],
      [RICH_WIRE_ORACLE.eventIds, 'event'],
      [RICH_WIRE_ORACLE.chordMemberIds, 'chordNote'],
      [RICH_WIRE_ORACLE.tupletGroupIds, 'tupletGroup'],
      [RICH_WIRE_ORACLE.harmonyIds, 'harmony'],
      [RICH_WIRE_ORACLE.slurIds, 'slur'],
      [RICH_WIRE_ORACLE.dynamicIds, 'dynamic'],
      [RICH_WIRE_ORACLE.pedalIds, 'pedal'],
      [RICH_WIRE_ORACLE.scaleDegreeIds, 'scaleDegree'],
      [RICH_WIRE_ORACLE.annotationIds, 'annotation'],
    ];
    for (const [ids, kind] of expectations) {
      for (const id of ids) {
        expect(index.get(id)?.kind, id).toBe(kind);
      }
    }
    expect(index.events.map((event) => event.id)).toEqual(RICH_WIRE_ORACLE.eventIds);
    expect(index.duplicateIds).toEqual([]);
  });

  it('never mutates its input and returns a detached, deeply frozen score', () => {
    const input = variant(RICH_WIRE_FIXTURE, (draft) => {
      const [treble, bass] = draft.staves;
      if (treble === undefined || bass === undefined) {
        throw new Error('fixture has two staves');
      }
      delete treble.clef;
      delete bass.clef;
      const [firstAnnotation] = draft.annotations;
      if (firstAnnotation !== undefined) {
        firstAnnotation.color = '#E91E63';
      }
    });
    const before = JSON.stringify(input);

    const value = accepted(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(frozenObjectPaths(input)).toEqual([]);
    expect(value).not.toBe(input);
    expect(value.staves[0]).not.toBe(input.staves[0]);
    expect(value.staves.map((staff) => staff.clef)).toEqual(['treble', 'bass']);
    expect(value.annotations[0]?.color).toBe('#e91e63');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.staves[0]?.measures[1]?.voices[0]?.events[0])).toBe(true);
    expect(() => {
      Object.assign(value, { revision: 99 });
    }).toThrow(TypeError);
  });

  it('accepts deep-frozen input without writing to it', () => {
    expect(Object.isFrozen(RICH_WIRE_FIXTURE.staves[0]?.measures[0])).toBe(true);
    expect(validateScoreSpec(RICH_WIRE_FIXTURE).ok).toBe(true);
  });

  const firstNote = eventPath(0, 0, 0, 0);
  const rejections: { name: string; input: unknown; code: string; path: ErrorPath }[] = [
    {
      name: 'an unknown version',
      input: { ...cloneFixture(F01), version: 2 },
      code: 'UNSUPPORTED_VERSION',
      path: ['version'],
    },
    {
      name: 'a revision given as a string',
      input: { ...cloneFixture(F01), revision: '3' },
      code: 'INVALID_TYPE',
      path: ['revision'],
    },
    {
      name: 'a tempo given as text',
      input: variant(F01, (draft) => Object.assign(draft.tempo, { bpm: 'fast' })),
      code: 'INVALID_TYPE',
      path: ['tempo', 'bpm'],
    },
    {
      name: 'an optional field explicitly set to undefined',
      input: variant(F01, (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { tie: undefined })),
      code: 'INVALID_TYPE',
      path: [...firstNote, 'tie'],
    },
    {
      name: 'renderer coordinates on a note',
      input: variant(F01, (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { x: 120 })),
      code: 'UNKNOWN_FIELD',
      path: [...firstNote, 'x'],
    },
    {
      name: 'a duration in seconds',
      input: variant(F01, (draft) =>
        Object.assign(eventAt(draft, 0, 0, 0, 0).duration, { seconds: 0.5 }),
      ),
      code: 'UNKNOWN_FIELD',
      path: [...firstNote, 'duration', 'seconds'],
    },
    {
      name: 'a VexFlow object on a staff',
      input: variant(F01, (draft) =>
        Object.assign(draft.staves[0] ?? {}, { vexflow: { stave: {} } }),
      ),
      code: 'UNKNOWN_FIELD',
      path: ['staves', 0, 'vexflow'],
    },
    {
      name: 'a layout map at score level',
      input: { ...cloneFixture(F01), layout: { notes: {} } },
      code: 'UNKNOWN_FIELD',
      path: ['layout'],
    },
    {
      name: 'an instrument other than piano',
      input: { ...cloneFixture(F01), instrument: 'violin' },
      code: 'UNKNOWN_FIELD',
      path: ['instrument'],
    },
    {
      name: 'an unsupported event type',
      input: variant(F01, (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { type: 'grace' })),
      code: 'INVALID_VALUE',
      path: [...firstNote, 'type'],
    },
    {
      name: 'an ID with forbidden characters',
      input: variant(F01, (draft) => Object.assign(eventAt(draft, 0, 0, 0, 0), { id: 'n 1' })),
      code: 'INVALID_VALUE',
      path: [...firstNote, 'id'],
    },
    {
      name: 'a payload that is not an object',
      input: 'C4 D4 E4 F4',
      code: 'INVALID_TYPE',
      path: [],
    },
  ];

  it.each(rejections)('rejects $name with a safe path and code', ({ input, code, path }) => {
    const error = rejected(input);
    expect(error.code).toBe('SCORE_VALIDATION_FAILED');
    expect(codesAndPaths(error)).toEqual([{ code, path }]);
  });

  it('never echoes submitted text in paths or messages', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const input = variant(F01, (draft) => {
      Object.assign(draft, { [hostile]: true });
      draft.metadata.title = hostile.repeat(10);
      Object.assign(draft.tempo, { bpm: hostile });
    });

    const error = rejected(input);

    expect(JSON.stringify(error)).not.toContain('<img');
    expect(codesAndPaths(error)).toEqual([
      { code: 'TEXT_TOO_LONG', path: ['metadata', 'title'] },
      { code: 'INVALID_TYPE', path: ['tempo', 'bpm'] },
      { code: 'UNKNOWN_FIELD', path: ['<invalid-key>'] },
    ]);
  });
});
