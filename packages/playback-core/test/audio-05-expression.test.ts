/**
 * AUDIO-05 (issue #6, P-02): deterministic expression policy v1
 * (PLAYBACK_POLICY_V1.md §4). Expected numbers are the documented
 * engineering constants applied by hand: levels ppp..fff = 16/32/48/64/80/
 * 96/112/127, mf (80) before a staff's first mark, a hairpin without a target
 * mark moves one level (16) over its span, accent +16, marcato +24; gates
 * unmarked 9/10, staccato 1/2, portato 3/4, tenuto or slurred 1/1.
 */
import { F08, bar, cloneFixture, dur, note, score, staff, voice } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { compile, soundOf, spanOf } from './support';

describe('AUDIO-05 expression', () => {
  const f08 = compile(F08);

  it('declares expression policy version 1', () => {
    expect(f08.expressionPolicyVersion).toBe(1);
  });

  it.each([
    { id: 'f08-rh-n1', why: 'p mark, crescendo start', velocity: 48, duration: 960 },
    { id: 'f08-rh-n2', why: 'crescendo p -> mp, 1/4 of the way', velocity: 52, duration: 960 },
    { id: 'f08-rh-n3', why: 'crescendo, 1/2 of the way', velocity: 56, duration: 960 },
    { id: 'f08-rh-n4', why: 'crescendo 3/4, slur end note', velocity: 60, duration: 864 },
    { id: 'f08-rh-n5', why: 'level reached by the crescendo holds', velocity: 64, duration: 864 },
    { id: 'f08-rh-n11', why: 'held level, slur end note', velocity: 64, duration: 864 },
    { id: 'f08-rh-n12', why: 'f mark + accent', velocity: 112, duration: 864 },
    { id: 'f08-rh-n13', why: 'diminuendo f -> mf 1/4, staccato', velocity: 92, duration: 480 },
    { id: 'f08-rh-n14', why: 'diminuendo 1/2, tenuto', velocity: 88, duration: 960 },
    { id: 'f08-rh-n15', why: 'diminuendo 3/4 + marcato', velocity: 108, duration: 864 },
    { id: 'f08-lh-n1', why: 'no mark on the left staff: mf', velocity: 80, duration: 3456 },
    {
      id: 'f08-lh-n4',
      why: 'left hand under the f of the right staff: still mf',
      velocity: 80,
      duration: 1728,
    },
  ])('$id ($why): velocity $velocity, sounds $duration ticks', ({ id, velocity, duration }) => {
    expect(soundOf(f08, id)).toMatchObject({ velocity, durationTicks: duration });
  });

  it('a hairpin into a later mark ramps to that mark: p < 64 < 80 < f', () => {
    const plan = compile(
      score({
        id: 'hp',
        staves: [
          staff('hp-rh', 'right', [
            bar('hp-m1', 1, [
              voice('hp-v1', [
                note('hp-n1', 'C4', 'quarter'),
                note('hp-n2', 'D4', 'quarter'),
                note('hp-n3', 'E4', 'quarter'),
                note('hp-n4', 'F4', 'quarter'),
              ]),
            ]),
          ]),
        ],
        dynamics: [
          { id: 'hp-d1', type: 'mark', eventId: 'hp-n1', marking: 'p' },
          {
            id: 'hp-d2',
            type: 'hairpin',
            direction: 'crescendo',
            startEventId: 'hp-n1',
            endEventId: 'hp-n4',
          },
          { id: 'hp-d3', type: 'mark', eventId: 'hp-n4', marking: 'f' },
        ],
      }),
    );
    expect(plan.events.map((event) => event.velocity)).toEqual([48, 64, 80, 96]);
  });

  it.each([
    {
      name: 'staccato under a slur (portato)',
      articulations: ['staccato'] as const,
      slurred: true,
      duration: 720,
    },
    {
      name: 'staccato with tenuto (portato)',
      articulations: ['staccato', 'tenuto'] as const,
      slurred: false,
      duration: 720,
    },
    { name: 'staccato alone', articulations: ['staccato'] as const, slurred: false, duration: 480 },
    {
      name: 'accent and marcato do not add up',
      articulations: ['accent', 'marcato'] as const,
      slurred: false,
      duration: 864,
    },
  ])('precedence: $name', ({ articulations, slurred, duration }) => {
    const plan = compile(
      score({
        id: 'pr',
        staves: [
          staff('pr-rh', 'right', [
            bar('pr-m1', 1, [
              voice('pr-v1', [
                note('pr-n1', 'C4', 'quarter', { articulations: [...articulations] }),
                note('pr-n2', 'D4', dur('half', 1)),
              ]),
            ]),
          ]),
        ],
        ...(slurred ? { slurs: [{ id: 'pr-s1', startNoteId: 'pr-n1', endNoteId: 'pr-n2' }] } : {}),
      }),
    );
    const marcato = articulations.some((item) => item === 'marcato');
    expect(soundOf(plan, 'pr-n1')).toMatchObject({
      durationTicks: duration,
      velocity: marcato ? 104 : 80,
    });
  });

  it('the sustain pedal is separate from note-offs and highlights: a staccato note under the pedal', () => {
    // f08-rh-n13 (staccato quarter at 12480) lies under pedal f08-p2 (11520 -> 15360).
    expect(soundOf(f08, 'f08-rh-n13')).toMatchObject({ startTick: 12480, durationTicks: 480 });
    expect(spanOf(f08, 'f08-rh-n13')).toEqual({
      noteId: 'f08-rh-n13',
      startTick: 12480,
      endTick: 13440,
    });
    expect(f08.pedal).toEqual([
      { pedalId: 'f08-p1', tick: 7680, type: 'down' },
      { pedalId: 'f08-p1', tick: 11520, type: 'up' },
      { pedalId: 'f08-p2', tick: 11520, type: 'down' },
      { pedalId: 'f08-p2', tick: 15360, type: 'up' },
    ]);
    // The pedal lengthens no sound: every event still ends within its notated span.
    for (const event of f08.events) {
      const lastId = event.tiedNoteIds.at(-1) ?? event.noteId;
      expect(event.startTick + event.durationTicks).toBeLessThanOrEqual(
        spanOf(f08, lastId).endTick,
      );
    }
  });

  it('is deterministic: the same score, or a copy of it, always gives a deep-equal plan', () => {
    expect(compile(F08)).toEqual(f08);
    expect(compile(cloneFixture(F08))).toEqual(f08);
  });
});
