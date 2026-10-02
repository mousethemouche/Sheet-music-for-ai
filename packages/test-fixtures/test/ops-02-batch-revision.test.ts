/**
 * OPS-02 (issue #3): batch atomicity and optimistic revision. A matching
 * revision is incremented exactly once per successful batch; a stale one is
 * rejected before anything is applied. A later failure (missing target or
 * invalid final document) returns only an error and leaves the deep-frozen
 * original untouched. Only the final state is validated.
 * Database compare-and-swap and persisted rollback belong to #9/#13.
 */
import { describe, expect, it } from 'vitest';
import { F01, F08, note, parseFixture, voice } from '../src';
import { copyOf, editError, edited, expectedAfter } from './ops-support';
import { at, measureAt, summarize } from './support';

const f01 = parseFixture(F01);
const f08 = parseFixture(F08);

describe('OPS-02 batch and revision', () => {
  it('increments the revision once for a whole successful batch', () => {
    const result = edited(f01, [
      { type: 'set_tempo', bpm: 72 },
      { type: 'set_title', title: 'Slower' },
      { type: 'set_fingering', noteId: 'f01-n1', fingering: 1 },
    ]);
    expect(f01.revision).toBe(1);
    expect(result).toEqual(
      expectedAfter(f01, (d) => {
        d.tempo = { bpm: 72 };
        d.metadata.title = 'Slower';
        const first = at(at(measureAt(d, 0, 0).voices, 0).events, 0);
        if (first.type === 'note') {
          first.fingering = 1;
        }
      }),
    );
    expect(result.revision).toBe(2);
  });

  it.each([
    { name: 'older', expectedRevision: 0 },
    { name: 'newer', expectedRevision: 2 },
  ])('rejects an $name expectedRevision with REVISION_CONFLICT', ({ expectedRevision }) => {
    const error = editError(f01, [{ type: 'set_tempo', bpm: 72 }], expectedRevision);
    expect(summarize(error)).toEqual({
      code: 'REVISION_CONFLICT',
      details: [{ code: 'REVISION_MISMATCH', path: ['expectedRevision'], ids: ['f01'] }],
    });
  });

  it('leaves the original unchanged when a later operation has no target', () => {
    const snapshot = copyOf(f08);
    const error = editError(f08, [
      { type: 'set_tempo', bpm: 60 },
      { type: 'remove_slur', slurId: 'f08-s1' },
      { type: 'remove_slur', slurId: 'f08-ghost' },
    ]);
    expect(summarize(error)).toEqual({
      code: 'TARGET_NOT_FOUND',
      details: [
        { code: 'REFERENCE_NOT_FOUND', path: ['operations', 2, 'slurId'], ids: ['f08-ghost'] },
      ],
    });
    expect(f08).toEqual(snapshot);
    expect(Object.isFrozen(f08.slurs)).toBe(true);
  });

  it('leaves the original unchanged when the final document is invalid', () => {
    const snapshot = copyOf(f01);
    const error = editError(f01, [
      { type: 'set_tempo', bpm: 60 },
      { type: 'set_time_signature', numerator: 3, denominator: 4 },
    ]);
    expect(summarize(error)).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [
        {
          code: 'VOICE_DURATION_MISMATCH',
          path: ['staves', 0, 'measures', 0, 'voices', 0],
          ids: ['f01-rh-m1-v1'],
        },
      ],
    });
    expect(f01).toEqual(snapshot);
  });

  it('accepts an intermediate state that is invalid when the final state is valid', () => {
    const result = edited(f01, [
      // Refers to a note that only exists after the next operation.
      { type: 'add_slur', slur: { id: 'f01-s1', startNoteId: 'f01-n4', endNoteId: 'f01-n5' } },
      {
        type: 'insert_measures',
        position: 'after',
        measureId: 'f01-m1',
        bars: [
          {
            id: 'f01-m2',
            staves: [
              {
                staffId: 'f01-rh',
                voices: [voice('f01-rh-m2-v1', [note('f01-n5', 'G4', 'whole')])],
              },
            ],
          },
        ],
      },
    ]);
    expect(result.slurs).toEqual([{ id: 'f01-s1', startNoteId: 'f01-n4', endNoteId: 'f01-n5' }]);
    expect(result.staves[0]?.measures.map((measure) => measure.id)).toEqual(['f01-m1', 'f01-m2']);
    expect(result.revision).toBe(2);
  });
});
