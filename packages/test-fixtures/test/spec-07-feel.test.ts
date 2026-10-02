/**
 * SPEC-07 (issue #2): playback feel (P-02) and tempo. Straight, swing requested
 * without a ratio, and explicit positive ratios are valid; invalid ratios are
 * rejected. The effective 2:1 timing is compiled and tested in #6: here the
 * domain only keeps the request and never rewrites written rhythm.
 */
import { type ErrorPath, type ScoreSpecInput, buildScoreIndex } from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import { F10, F10_ORACLE, F10_SWING_2_1, F10_SWING_3_2, F10_SWING_DEFAULT } from '../src';
import { accepted, codesAndPaths, rejected, summarize, toTicks, variant } from './support';

const withFeel = (playbackFeel: unknown): ScoreSpecInput =>
  variant(F10, (draft) => {
    Object.assign(draft, { playbackFeel });
  });

describe('SPEC-07 playback feel and tempo', () => {
  it.each([
    { name: 'no feel (straight)', input: F10, feel: undefined },
    {
      name: 'explicit straight',
      input: withFeel({ type: 'straight' }),
      feel: { type: 'straight' },
    },
    { name: 'swing requested without ratio', input: F10_SWING_DEFAULT, feel: { type: 'swing' } },
    {
      name: 'explicit 2:1 eighth swing',
      input: F10_SWING_2_1,
      feel: { type: 'swing', subdivision: 'eighth', ratio: { long: 2, short: 1 } },
    },
    {
      name: 'explicit 3:2 swing with display text',
      input: F10_SWING_3_2,
      feel: {
        type: 'swing',
        subdivision: 'eighth',
        ratio: { long: 3, short: 2 },
        displayText: 'Light swing',
      },
    },
    {
      name: 'sixteenth swing',
      input: withFeel({ type: 'swing', subdivision: 'sixteenth' }),
      feel: { type: 'swing', subdivision: 'sixteenth' },
    },
    {
      name: 'a 1:1 ratio (even timing)',
      input: withFeel({ type: 'swing', ratio: { long: 1, short: 1 } }),
      feel: { type: 'swing', ratio: { long: 1, short: 1 } },
    },
  ])('accepts $name and keeps it as requested (no defaults filled in)', ({ input, feel }) => {
    expect(accepted(input).playbackFeel).toEqual(feel);
  });

  it('never rewrites written rhythm: swung eighths keep straight written positions', () => {
    const index = buildScoreIndex(accepted(F10_SWING_DEFAULT));
    expect(index.events.map((event) => event.event.duration)).toEqual(
      F10_ORACLE.noteIds.map(() => ({ value: 'eighth' })),
    );
    expect(
      F10_ORACLE.noteIds.map((id) =>
        toTicks(index.location(id)?.onset ?? { numerator: -1, denominator: 1 }),
      ),
    ).toEqual(F10_ORACLE.straightStartTicks);
  });

  const ratioPath: ErrorPath = ['playbackFeel', 'ratio'];
  const invalidFeels: { name: string; feel: unknown; code: string; path: ErrorPath }[] = [
    {
      name: 'long 0',
      feel: { type: 'swing', ratio: { long: 0, short: 1 } },
      code: 'INVALID_VALUE',
      path: [...ratioPath, 'long'],
    },
    {
      name: 'short 0',
      feel: { type: 'swing', ratio: { long: 2, short: 0 } },
      code: 'INVALID_VALUE',
      path: [...ratioPath, 'short'],
    },
    {
      name: 'a negative long',
      feel: { type: 'swing', ratio: { long: -2, short: 1 } },
      code: 'INVALID_VALUE',
      path: [...ratioPath, 'long'],
    },
    {
      name: 'a fractional long',
      feel: { type: 'swing', ratio: { long: 1.5, short: 1 } },
      code: 'INVALID_TYPE',
      path: [...ratioPath, 'long'],
    },
    {
      name: 'short longer than long',
      feel: { type: 'swing', ratio: { long: 1, short: 2 } },
      code: 'INVALID_VALUE',
      path: ratioPath,
    },
    {
      name: 'long above 16',
      feel: { type: 'swing', ratio: { long: 17, short: 1 } },
      code: 'INVALID_VALUE',
      path: [...ratioPath, 'long'],
    },
    {
      name: 'a missing short',
      feel: { type: 'swing', ratio: { long: 2 } },
      code: 'INVALID_TYPE',
      path: [...ratioPath, 'short'],
    },
    {
      name: 'an unknown feel type',
      feel: { type: 'shuffle' },
      code: 'INVALID_VALUE',
      path: ['playbackFeel', 'type'],
    },
    {
      name: 'a quarter-note subdivision',
      feel: { type: 'swing', subdivision: 'quarter' },
      code: 'INVALID_VALUE',
      path: ['playbackFeel', 'subdivision'],
    },
    {
      name: 'a ratio on straight feel',
      feel: { type: 'straight', ratio: { long: 2, short: 1 } },
      code: 'UNKNOWN_FIELD',
      path: ['playbackFeel', 'ratio'],
    },
  ];

  it.each(invalidFeels)('rejects swing with $name', ({ feel, code, path }) => {
    expect(summarize(rejected(withFeel(feel)))).toEqual({
      code: 'SCORE_VALIDATION_FAILED',
      details: [{ code, path }],
    });
  });

  it('rejects swing display text longer than 32 characters as an MVP limit', () => {
    expect(summarize(rejected(withFeel({ type: 'swing', displayText: 's'.repeat(33) })))).toEqual({
      code: 'MVP_LIMIT_EXCEEDED',
      details: [{ code: 'TEXT_TOO_LONG', path: ['playbackFeel', 'displayText'] }],
    });
  });

  const withBpm = (bpm: unknown): ScoreSpecInput =>
    variant(F10, (draft) => {
      Object.assign(draft.tempo, { bpm });
    });

  it.each([20, 96.5, 400])('accepts a tempo of %d quarter notes per minute', (bpm) => {
    expect(accepted(withBpm(bpm)).tempo).toEqual({ bpm });
  });

  it.each([
    { bpm: 0, code: 'INVALID_VALUE' },
    { bpm: 19, code: 'INVALID_VALUE' },
    { bpm: 401, code: 'INVALID_VALUE' },
    { bpm: '120', code: 'INVALID_TYPE' },
  ])('rejects a tempo of $bpm', ({ bpm, code }) => {
    expect(codesAndPaths(rejected(withBpm(bpm)))).toEqual([{ code, path: ['tempo', 'bpm'] }]);
  });

  it('rejects a tempo beat unit other than the implicit quarter note', () => {
    const input = variant(F10, (draft) => {
      Object.assign(draft.tempo, { beatUnit: 'dotted-quarter' });
    });
    expect(codesAndPaths(rejected(input))).toEqual([
      { code: 'UNKNOWN_FIELD', path: ['tempo', 'beatUnit'] },
    ]);
  });
});
