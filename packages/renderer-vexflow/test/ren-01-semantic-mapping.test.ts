// @vitest-environment jsdom
/**
 * REN-01 (issue #5): our mapping of ScoreSpec features to pinned VexFlow 5.
 * Each case builds the real VexFlow objects of one bar (or draws a score in
 * jsdom) and checks what we configured: keys, durations, voices, staves,
 * tuplet groups and where modifiers are anchored. Expected values are written
 * by hand from the fixtures, not computed by adapter code. Glyph geometry is
 * VexFlow's business and is not asserted here; only relative placements the
 * adapter decides (hairpin openings across systems, rows of dynamic marks,
 * the order of label rows) are, and real glyph metrics are REN-I01/I02's.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import {
  F01,
  F02,
  F03,
  F04,
  F05,
  F06,
  F06_ORACLE,
  F07,
  F07_ORACLE,
  F08,
  F08_ORACLE,
  F10,
  F10_SWING_2_1,
  F10_SWING_3_2,
  RICH_WIRE_FIXTURE,
  bar,
  chord,
  member,
  note,
  parseFixture,
  PPQ,
  score,
  staff,
  voice,
} from '@sheet-music/test-fixtures';
import {
  Accidental,
  Articulation,
  FretHandFinger,
  Modifier,
  PedalMarking,
  type StaveNote,
  VexFlow,
} from 'vexflow/bravura';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  OPTIONS,
  buildFixtureBar,
  eventGlyph,
  installJsdomLayoutStubs,
  mountTarget,
  newRenderer,
} from './support';
import { CHORD_DEGREES } from './label-scores';

beforeAll(installJsdomLayoutStubs);

/** VexFlow ticks per quarter note (its resolution is ticks per whole note). */
const VEXFLOW_QUARTER = VexFlow.RESOLUTION / 4;

function modifierSummary(note: StaveNote): { kind: string; value: string; index: number }[] {
  return note.getModifiers().flatMap((modifier: Modifier) => {
    const index = modifier.getIndex() ?? -1;
    if (modifier instanceof Accidental) {
      return [{ kind: 'accidental', value: modifier.type, index }];
    }
    if (modifier instanceof Articulation) {
      return [{ kind: 'articulation', value: modifier.type, index }];
    }
    if (modifier instanceof FretHandFinger) {
      return [{ kind: 'fingering', value: modifier.getFretHandFinger(), index }];
    }
    return [];
  });
}

function dotCount(note: StaveNote): number {
  return note.getModifiers().filter((modifier) => modifier.getCategory() === 'Dot').length;
}

async function drawn(input: ScoreSpecInput, width = OPTIONS.width): Promise<HTMLElement> {
  const target = mountTarget();
  await newRenderer().render(parseFixture(input), target, { ...OPTIONS, width });
  return target;
}

/** Four bars of four quarters; a pedal from bar 2 to the end, a diminuendo from bar 1 to bar 4. */
const ACROSS_BREAKS = score({
  id: 'x',
  staves: [
    staff(
      'x-rh',
      'right',
      [1, 2, 3, 4].map((number) =>
        bar(`x-m${number}`, number, [
          voice(
            `x-v${number}`,
            ['a', 'b', 'c', 'd'].map((name) => note(`x-${number}${name}`, 'G4', 'quarter')),
          ),
        ]),
      ),
    ),
  ],
  pedal: [{ id: 'x-p', type: 'sustain', startEventId: 'x-2a', endEventId: 'x-4d' }],
  dynamics: [
    {
      id: 'x-h',
      type: 'hairpin',
      direction: 'diminuendo',
      startEventId: 'x-1a',
      endEventId: 'x-4c',
    },
  ],
});

/** Opening (vertical gap between its two lines) of a drawn hairpin part at its left and right ends. */
function openingsOf(path: Element): { left: number; right: number } {
  const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const points = numbers.flatMap((value, index) =>
    index % 2 === 0 ? [{ x: value, y: numbers[index + 1] ?? Number.NaN }] : [],
  );
  const gapAt = (x: number): number => {
    const ys = points.filter((point) => Math.abs(point.x - x) < 1e-6).map((point) => point.y);
    return Math.max(...ys) - Math.min(...ys);
  };
  const xs = points.map((point) => point.x);
  return { left: gapAt(Math.min(...xs)), right: gapAt(Math.max(...xs)) };
}

describe('REN-01 semantic mapping', () => {
  it.each([
    {
      name: 'F01 quarter',
      fixture: F01,
      bar: 0,
      id: 'f01-n1',
      keys: ['c/4'],
      duration: 'q',
      dots: 0,
      rest: false,
    },
    {
      name: 'F02 half chord',
      fixture: F02,
      bar: 0,
      id: 'f02-c1',
      keys: ['c/4', 'e/4', 'g/4'],
      duration: 'h',
      dots: 0,
      rest: false,
    },
    {
      name: 'F02 left-hand whole',
      fixture: F02,
      bar: 1,
      id: 'f02-lh-n4',
      keys: ['c/3'],
      duration: 'w',
      dots: 0,
      rest: false,
    },
    {
      name: 'F04 dotted half',
      fixture: F04,
      bar: 0,
      id: 'f04-rh-n3',
      keys: ['g/4'],
      duration: 'h',
      dots: 1,
      rest: false,
    },
    {
      name: 'F04 dotted quarter in 6/8',
      fixture: F04,
      bar: 1,
      id: 'f04-rh-n4',
      keys: ['a/4'],
      duration: 'q',
      dots: 1,
      rest: false,
    },
    {
      name: 'F06 septuplet sixteenth',
      fixture: F06,
      bar: 1,
      id: 'f06-n10',
      keys: ['c/5'],
      duration: '16',
      dots: 0,
      rest: false,
    },
    {
      name: 'F07 pickup rest',
      fixture: F07,
      bar: 0,
      id: 'f07-lh-r1',
      keys: null,
      duration: 'q',
      dots: 0,
      rest: true,
    },
  ])(
    'maps pitch and duration: $name',
    ({ fixture, bar: barIndex, id, keys, duration, dots, rest }) => {
      const { note: staveNote } = eventGlyph(buildFixtureBar(fixture, barIndex).glyphs, id);
      expect(staveNote.getDuration()).toBe(duration);
      expect(dotCount(staveNote) / staveNote.getKeys().length).toBe(dots);
      expect(staveNote.isRest()).toBe(rest);
      if (keys !== null) {
        expect(staveNote.getKeys()).toEqual(keys);
      }
    },
  );

  it('puts each staff on its own stave and each voice in its own lane', () => {
    const twoVoices = score({
      id: 'lanes',
      staves: [
        staff('lanes-rh', 'right', [
          bar('lanes-m1', 1, [
            voice('lanes-v1', [note('lanes-up', 'E5', 'whole')]),
            voice('lanes-v2', [note('lanes-down', 'C4', 'whole')]),
          ]),
        ]),
        staff('lanes-lh', 'left', [
          bar('lanes-m1', 1, [voice('lanes-v3', [note('lanes-bass', 'C3', 'whole')])]),
        ]),
      ],
    });
    const { glyphs, staves } = buildFixtureBar(twoVoices);
    const [upper, lower] = glyphs.staves[0]?.musicVoices ?? [];

    expect(eventGlyph(glyphs, 'lanes-up').note.getStave()).toBe(staves[0]);
    expect(eventGlyph(glyphs, 'lanes-bass').note.getStave()).toBe(staves[1]);
    expect(upper?.getTickables()).toEqual([eventGlyph(glyphs, 'lanes-up').note]);
    expect(lower?.getTickables()).toEqual([eventGlyph(glyphs, 'lanes-down').note]);
    // Two voices on one staff: first voice stems up, second down.
    expect(eventGlyph(glyphs, 'lanes-up').note.getStemDirection()).toBe(1);
    expect(eventGlyph(glyphs, 'lanes-down').note.getStemDirection()).toBe(-1);
  });

  it.each([
    { name: 'triplet 3:2', bar: 0, group: F06_ORACLE.triplet, actual: 3, normal: 2 },
    { name: 'quintuplet 5:4', bar: 0, group: F06_ORACLE.quintuplet, actual: 5, normal: 4 },
    { name: 'septuplet 7:4', bar: 1, group: F06_ORACLE.septuplet, actual: 7, normal: 4 },
  ])(
    'groups tuplet members by groupId with their ratio: $name',
    ({ bar: barIndex, group, actual, normal }) => {
      const { glyphs } = buildFixtureBar(F06, barIndex);
      const members = group.noteIds.map((id) => eventGlyph(glyphs, id).note);
      const tuplet = glyphs.staves[0]?.tuplets.find(
        ({ tuplet: candidate }) => candidate.getNotes()[0] === members[0],
      );

      expect(tuplet?.tuplet.getNotes()).toEqual(members);
      expect(tuplet?.tuplet.getNoteCount()).toBe(actual);
      expect(tuplet?.tuplet.getNotesOccupied()).toBe(normal);
      const groupTicks = members.reduce((sum, member) => sum + member.getTicks().value(), 0);
      expect(groupTicks).toBeCloseTo((group.totalTicks / PPQ) * VEXFLOW_QUARTER, 6);
    },
  );

  it('gives pickup and incomplete bars their actual length', () => {
    const pickup = buildFixtureBar(F07, 0).glyphs.staves[0]?.musicVoices[0];
    const incomplete = buildFixtureBar(F07, 2).glyphs.staves[0]?.musicVoices[0];

    expect(pickup?.getTotalTicks().value()).toBe(
      ((F07_ORACLE.barDurationTicks[0] ?? 0) / PPQ) * VEXFLOW_QUARTER,
    );
    expect(incomplete?.getTotalTicks().value()).toBe(
      ((F07_ORACLE.barDurationTicks[2] ?? 0) / PPQ) * VEXFLOW_QUARTER,
    );
  });

  it('keeps the written spelling: F#4 and Gb4 stay different notes with their own accidental', () => {
    const { glyphs } = buildFixtureBar(F05);
    const sharp = eventGlyph(glyphs, 'f05-fs').note;
    const flat = eventGlyph(glyphs, 'f05-gb').note;

    expect(sharp.getKeys()).toEqual(['f#/4']);
    expect(modifierSummary(sharp)).toEqual([{ kind: 'accidental', value: '#', index: 0 }]);
    expect(flat.getKeys()).toEqual(['gb/4']);
    expect(modifierSummary(flat)).toEqual([{ kind: 'accidental', value: 'b', index: 0 }]);
  });

  it('applies the key signature once: accidentals only where the written pitch departs from it', () => {
    const inG = score({
      id: 'key',
      keySignature: { fifths: 1 },
      staves: [
        staff('key-rh', 'right', [
          bar('key-m1', 1, [
            voice('key-v1', [
              note('key-fs', 'F#4', 'quarter'),
              note('key-f', 'F4', 'quarter'),
              note('key-fs-again', 'F#4', 'quarter'),
              note('key-fs-octave', 'F#5', 'quarter', { tie: { start: true } }),
            ]),
          ]),
          bar('key-m2', 2, [
            voice('key-v2', [
              note('key-fs-tied', 'F#5', 'quarter', { tie: { end: true } }),
              note('key-f-new-bar', 'F4', dotted()),
            ]),
          ]),
        ]),
      ],
    });
    const accidentals = (
      barIndex: number,
      id: string,
    ): { kind: string; value: string; index: number }[] =>
      modifierSummary(eventGlyph(buildFixtureBar(inG, barIndex).glyphs, id).note);

    expect(accidentals(0, 'key-fs')).toEqual([]);
    expect(accidentals(0, 'key-f')).toEqual([{ kind: 'accidental', value: 'n', index: 0 }]);
    expect(accidentals(0, 'key-fs-again')).toEqual([{ kind: 'accidental', value: '#', index: 0 }]);
    expect(accidentals(0, 'key-fs-octave')).toEqual([]);
    expect(accidentals(1, 'key-fs-tied')).toEqual([]);
    expect(accidentals(1, 'key-f-new-bar')).toEqual([{ kind: 'accidental', value: 'n', index: 0 }]);
  });

  it('anchors articulations, fingerings and chord-member modifiers to the written note', () => {
    const fingered = buildFixtureBar(F08, 0).glyphs;
    const articulated = buildFixtureBar(F08, 3).glyphs;
    const chord = eventGlyph(buildFixtureBar(RICH_WIRE_FIXTURE, 1).glyphs, 'rich-rh-c1').note;

    for (const [id, finger] of Object.entries(F08_ORACLE.fingerings)) {
      expect(modifierSummary(eventGlyph(fingered, id).note)).toEqual([
        { kind: 'fingering', value: String(finger), index: 0 },
      ]);
    }
    const codes = { accent: 'a>', staccato: 'a.', tenuto: 'a-', marcato: 'a^' } as const;
    for (const id of ['f08-rh-n12', 'f08-rh-n13', 'f08-rh-n14', 'f08-rh-n15'] as const) {
      const [articulation] = F08_ORACLE.articulations[id];
      expect(modifierSummary(eventGlyph(articulated, id).note)).toEqual([
        { kind: 'articulation', value: codes[articulation as keyof typeof codes], index: 0 },
      ]);
    }
    // rich-rh-c1 = G4, B4 (fingering 3, accent), D5: only key index 1 carries modifiers.
    expect(modifierSummary(chord)).toEqual([
      { kind: 'articulation', value: 'a>', index: 1 },
      { kind: 'fingering', value: '3', index: 1 },
    ]);
  });

  it('draws ties and slurs with distinct VexFlow constructs', async () => {
    const target = await drawn(F08);
    const ties = [...target.querySelectorAll('[data-tie-from]')];
    const slurs = [...target.querySelectorAll('[data-slur-id]')];

    expect(
      ties.map((tie) => [tie.getAttribute('data-tie-from'), tie.getAttribute('data-tie-to')]),
    ).toEqual(F08_ORACLE.tiePairs);
    expect(ties.every((tie) => tie.querySelector('.vf-stavetie') !== null)).toBe(true);
    expect(slurs.map((slur) => slur.getAttribute('data-slur-id'))).toEqual(F08_ORACLE.slurIds);
    expect(
      slurs.every(
        (slur) =>
          slur.querySelector('.vf-stavetie') === null && slur.querySelector('path') !== null,
      ),
    ).toBe(true);
  });

  it('draws dynamics, hairpins and sustain pedal spans', async () => {
    const target = await drawn(F08);
    const ids = (selector: string, attribute: string): (string | null)[] =>
      [...target.querySelectorAll(selector)].map((element) => element.getAttribute(attribute));

    expect(ids('.vf-dynamic', 'data-dynamic-id')).toEqual(
      F08_ORACLE.dynamicMarks.map((mark) => mark.id),
    );
    expect(ids('.vf-hairpin', 'data-dynamic-id')).toEqual(
      F08_ORACLE.hairpins.map((hairpin) => hairpin.id),
    );
    expect(ids('.vf-pedal', 'data-pedal-id')).toEqual(F08_ORACLE.pedalSpans.map((span) => span.id));
    expect(target.querySelectorAll('.vf-hairpin path')).toHaveLength(F08_ORACLE.hairpins.length);
  });

  it.each([
    { name: 'F04 7/4, local 6/8, back to 7/4', fixture: F04, meters: ['7/4', '6/8', '7/4'] },
    {
      name: 'rich 4/4 pickup, local 3/4, back to 4/4',
      fixture: RICH_WIRE_FIXTURE,
      meters: ['4/4', '3/4', '4/4'],
    },
  ])('shows a meter at the start and at every change: $name', async ({ fixture, meters }) => {
    const target = await drawn(fixture);
    const staves = parseFixture(fixture).staves.length;

    expect(target.querySelectorAll('.vf-timesignature')).toHaveLength(meters.length * staves);
  });

  it('draws the key signature at the start of every staff of a system', async () => {
    const target = await drawn(RICH_WIRE_FIXTURE);
    const systems = target.querySelectorAll('[data-system-index]').length;

    expect(target.querySelectorAll('.vf-keysignature')).toHaveLength(systems * 2);
  });

  it('continues a pedal and a hairpin across system breaks as one span', async () => {
    const target = await drawn(ACROSS_BREAKS, 200);
    const systems = target.querySelectorAll('[data-system-index]').length;
    const pedalTexts = [...target.querySelectorAll('.vf-pedal text')].map(
      (text) => text.textContent,
    );
    const parts = [...target.querySelectorAll('.vf-hairpin path')].map(openingsOf);

    expect(systems).toBeGreaterThanOrEqual(3);
    // One "Ped." and one release for the whole span, whatever the number of systems.
    expect(pedalTexts).toEqual([
      PedalMarking.GLYPHS.pedalDepress,
      PedalMarking.GLYPHS.pedalRelease,
    ]);
    // One hairpin part per system, closing continuously: each part starts as open as the
    // previous one ended, and only the very end is closed.
    expect(parts).toHaveLength(systems);
    expect(parts[0]?.left).toBeGreaterThan(0);
    expect(parts.at(-1)?.right).toBe(0);
    parts.forEach((part, index) => {
      expect(part.right).toBeLessThan(part.left);
      const next = parts[index + 1];
      if (next !== undefined) {
        expect(next.left).toBeCloseTo(part.right, 6);
      }
    });
  });

  it('draws every dynamic mark when two voices carry one at the same onset, on separate rows', async () => {
    const twoMarks = score({
      id: 'd',
      staves: [
        staff('d-rh', 'right', [
          bar('d-m1', 1, [
            voice('d-v1', [note('d-a', 'E5', 'half'), note('d-b', 'E5', 'half')]),
            voice('d-v2', [note('d-c', 'C4', 'half'), note('d-d', 'C4', 'half')]),
          ]),
        ]),
      ],
      dynamics: [
        { id: 'd-f', type: 'mark', eventId: 'd-a', marking: 'f' },
        { id: 'd-p', type: 'mark', eventId: 'd-c', marking: 'p' },
      ],
    });
    const target = await drawn(twoMarks);
    const marks = [...target.querySelectorAll('.vf-dynamic')];

    expect(marks.map((mark) => mark.getAttribute('data-dynamic-id'))).toEqual(['d-f', 'd-p']);
    const [upper, lower] = marks.map((mark) =>
      Number(mark.querySelector('text')?.getAttribute('y')),
    );
    expect(lower).toBeGreaterThan(upper ?? Number.POSITIVE_INFINITY);
  });

  /**
   * A bass staff shared by two voices. Bar 1: D2 and F#2 over D1. Bar 2: the
   * first voice (A0 ... D1) below the second (A2). Bar 3: the first voice
   * below the staff under a slur, the second voice above it.
   */
  const SHARED_BASS = score({
    id: 'fg',
    staves: [
      staff(
        'fg-lh',
        'left',
        [
          bar('fg-m1', 1, [
            voice('fg-v1', [
              note('fg-d2', 'D2', 'half', { fingering: 5 }),
              note('fg-fs2', 'F#2', 'half', { fingering: 3 }),
            ]),
            voice('fg-v2', [note('fg-d1', 'D1', 'whole', { fingering: 5 })]),
          ]),
          bar('fg-m2', 2, [
            voice('fg-v3', [
              note('fg-a0', 'A0', 'half', { fingering: 5 }),
              note('fg-d1b', 'D1', 'half', { fingering: 1 }),
            ]),
            voice('fg-v4', [note('fg-a2', 'A2', 'whole')]),
          ]),
          bar('fg-m3', 3, [
            voice('fg-v5', [
              note('fg-c2', 'C2', 'half', { fingering: 2 }),
              note('fg-e2', 'E2', 'half', { fingering: 1 }),
            ]),
            voice('fg-v6', [note('fg-c3', 'C3', 'whole')]),
          ]),
        ],
        'bass',
      ),
    ],
    slurs: [{ id: 'fg-s', startNoteId: 'fg-c2', endNoteId: 'fg-e2' }],
  });

  it.each([
    {
      name: 'first voice beyond the bottom line, nothing lower at its onset: below',
      fixture: SHARED_BASS,
      bar: 1,
      eventId: 'fg-a0',
      position: Modifier.Position.BELOW,
    },
    {
      name: 'first voice below the bottom line, nothing else starting with it: below',
      fixture: SHARED_BASS,
      bar: 0,
      eventId: 'fg-fs2',
      position: Modifier.Position.BELOW,
    },
    {
      name: 'first voice beyond the bottom line, second voice lower at its onset: above',
      fixture: SHARED_BASS,
      bar: 0,
      eventId: 'fg-d2',
      position: Modifier.Position.ABOVE,
    },
    {
      name: 'second voice: below',
      fixture: SHARED_BASS,
      bar: 0,
      eventId: 'fg-d1',
      position: Modifier.Position.BELOW,
    },
    {
      name: 'first voice beyond the bottom line under a slur: above, the slur is below',
      fixture: SHARED_BASS,
      bar: 2,
      eventId: 'fg-c2',
      position: Modifier.Position.ABOVE,
    },
    {
      name: 'one voice on the top staff, below it: above, as the hand reads',
      fixture: F03,
      bar: 0,
      eventId: 'f03-rh-n4',
      position: Modifier.Position.ABOVE,
    },
  ])('places a fingering: $name', ({ fixture, bar: barIndex, eventId, position }) => {
    const { glyphs } = buildFixtureBar(fixture, barIndex);
    const fingerings = eventGlyph(glyphs, eventId)
      .note.getModifiers()
      .filter((modifier) => modifier instanceof FretHandFinger);

    expect(fingerings.map((fingering) => fingering.getPosition())).toEqual([position]);
  });

  it('stacks the scale degrees of a chord, the top note nearest the staff', async () => {
    const target = await drawn(CHORD_DEGREES, 1000);
    const baseline = (id: string): number =>
      Number(target.querySelector(`[data-scale-degree-id="${id}"] text`)?.getAttribute('y'));

    // C-E-G labelled 1, 3, 5: read top to bottom as 5, 3, 1 under the staff.
    expect(baseline('a4-sd3')).toBeLessThan(baseline('a4-sd2'));
    expect(baseline('a4-sd2')).toBeLessThan(baseline('a4-sd1'));
    // B-D-F-G labelled 7, 2, 4, 5.
    expect(baseline('a4-sd7')).toBeLessThan(baseline('a4-sd6'));
    expect(baseline('a4-sd6')).toBeLessThan(baseline('a4-sd5'));
    expect(baseline('a4-sd5')).toBeLessThan(baseline('a4-sd4'));
    // Each chord's top label on the row nearest the staff.
    expect(baseline('a4-sd7')).toBe(baseline('a4-sd3'));
  });

  it('keeps scale degrees of notes apart in time on one line', async () => {
    const target = await drawn(RICH_WIRE_FIXTURE, 1000);
    const baselines = [...target.querySelectorAll('.vf-scale-degree text')].map((text) =>
      text.getAttribute('y'),
    );

    expect(baselines).toHaveLength(4);
    expect(new Set(baselines).size).toBe(1);
  });

  it('stacks the label rows outward from their staff in engraving order', async () => {
    // Wide enough for one system: every label is in the same system coordinates.
    const target = await drawn(RICH_WIRE_FIXTURE, 1000);
    const baselines = (selector: string): number[] =>
      [...target.querySelectorAll(`${selector} text`)].map((text) =>
        Number(text.getAttribute('y')),
      );
    const first = (selector: string): number => baselines(selector)[0] ?? Number.NaN;
    const [depress, release] = baselines('.vf-pedal');

    expect(target.querySelectorAll('[data-system-index]')).toHaveLength(1);
    // Above the top staff, outward: chord symbols, then the swing indication.
    expect(first('.vf-swing')).toBeLessThan(first('.vf-chord-symbol'));
    expect(first('.vf-chord-symbol')).toBeLessThan(
      first('.vf-notehead[data-note-id="rich-rh-n2"]'),
    );
    // Below the top staff: scale degrees, then its dynamics; the bottom staff comes after them.
    expect(first('[data-scale-degree-id="rich-sd1"]')).toBeLessThan(
      first('[data-dynamic-id="rich-d1"]'),
    );
    expect(first('[data-dynamic-id="rich-d1"]')).toBeLessThan(
      first('.vf-notehead[data-note-id="rich-lh-n2"]'),
    );
    // Below the bottom staff: its dynamics, the pedal ("Ped." and release on one line), the Roman numerals.
    expect(first('[data-dynamic-id="rich-d3"]')).toBeLessThan(depress ?? Number.NaN);
    expect(release).toBe(depress);
    expect(depress).toBeLessThan(first('.vf-roman-numeral'));
    expect(new Set(baselines('.vf-roman-numeral')).size).toBe(1);
  });

  it.each([
    { name: 'shared by every member, no teaching color', colored: [], index: 0 },
    { name: 'shared by every member, lowest one colored', colored: ['s-c1'], index: 1 },
  ])('engraves a chord articulation once: $name', ({ colored, index }) => {
    const staccatoChord = score({
      id: 's',
      staves: [
        staff('s-rh', 'right', [
          bar('s-m1', 1, [
            voice('s-v1', [
              chord(
                's-c',
                ['C4', 'E4', 'G4'].map((pitch, position) =>
                  member(`s-c${position + 1}`, pitch, { articulations: ['staccato'] }),
                ),
                'whole',
              ),
            ]),
          ]),
        ]),
      ],
      annotations: colored.map((noteId) => ({
        id: 's-a',
        color: '#e91e63',
        noteIds: [noteId],
        text: 'Root',
      })),
    });
    const { glyphs } = buildFixtureBar(staccatoChord);

    expect(modifierSummary(eventGlyph(glyphs, 's-c').note)).toEqual([
      { kind: 'articulation', value: 'a.', index },
    ]);
  });

  it.each([
    { name: 'straight', fixture: F10, text: null },
    { name: 'swing without display text', fixture: F10_SWING_2_1, text: 'Swing' },
    { name: 'swing with display text', fixture: F10_SWING_3_2, text: 'Light swing' },
  ])('writes the swing indication: $name', async ({ fixture, text }) => {
    const target = await drawn(fixture);

    expect(target.querySelector('.vf-swing')?.textContent ?? null).toBe(text);
  });
});

function dotted(): { value: 'half'; dots: 1 } {
  return { value: 'half', dots: 1 };
}
