/**
 * The two ASSET-03 listening inputs (#23, docs/release/RELEASE_CHECKLIST.md)
 * are valid create_score arguments and hold what the listening sheet says:
 * the F08 slur pair exactly as the fixture catalogue has it, and a C3-C6
 * passage. A reviewer pastes them into the target host; these checks keep
 * them from drifting from the product rules. Runs in the opt-in `cloud`
 * project (no network).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createScoreInputSchema } from '../../packages/music-contracts/src/index';
import { validateScoreSpec } from '../../packages/music-domain/src/index';
import { F08, cloneFixture } from '../../packages/test-fixtures/src/index';

type Json = Record<string, unknown>;

function argument(file: string): { score: Json } {
  return JSON.parse(readFileSync(new URL(`./asset-03/${file}`, import.meta.url), 'utf8')) as {
    score: Json;
  };
}

/** Written pitches of one staff in bar order, as "C4"-style names (rests skipped). */
function writtenPitches(score: Json, hand: 'right' | 'left'): string[] {
  const staves = score['staves'] as {
    hand: string;
    measures: { voices: { events: Json[] }[] }[];
  }[];
  const staff = staves.find((candidate) => candidate.hand === hand);
  const names: string[] = [];
  for (const measure of staff?.measures ?? []) {
    for (const event of measure.voices.flatMap((voice) => voice.events)) {
      const pitch = event['pitch'] as { step: string; alter: number; octave: number } | undefined;
      if (event['type'] === 'note' && pitch) {
        names.push(`${pitch.step}${pitch.alter === 0 ? '' : String(pitch.alter)}${pitch.octave}`);
      }
    }
  }
  return names;
}

describe.each([['f08-slur-pair.create-score.json'], ['c3-c6-range.create-score.json']])(
  'ASSET-03 input %s',
  (file) => {
    it('is a create_score argument (no id or revision) that the domain validates', () => {
      const input = argument(file);
      expect(createScoreInputSchema.safeParse(input).success).toBe(true);
      const result = validateScoreSpec({ ...input.score, id: 'asset03', revision: 1 });
      expect(result.ok).toBe(true);
    });
  },
);

describe('ASSET-03 inputs hold the listening material', () => {
  it('F08 slur pair: the fixture catalogue F08 without its server-assigned fields', () => {
    const expected = cloneFixture(F08) as Json;
    delete expected['id'];
    delete expected['revision'];
    expect(argument('f08-slur-pair.create-score.json').score).toEqual(expected);
  });

  it('C3-C6 range: stepwise C major from C3 (left hand) to C6 (right hand), then C3 and C6 together', () => {
    const score = argument('c3-c6-range.create-score.json').score;
    expect(writtenPitches(score, 'left')).toEqual([
      'C3',
      'D3',
      'E3',
      'F3',
      'G3',
      'A3',
      'B3',
      'C4',
      'C3',
    ]);
    expect(writtenPitches(score, 'right')).toEqual([
      'D4',
      'E4',
      'F4',
      'G4',
      'A4',
      'B4',
      'C5',
      'D5',
      'E5',
      'F5',
      'G5',
      'A5',
      'B5',
      'C6',
      'C6',
    ]);
  });
});
