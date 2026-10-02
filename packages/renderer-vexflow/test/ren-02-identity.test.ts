// @vitest-environment jsdom
/**
 * REN-02 (issue #5): identity. Every written note stays addressable by its
 * domain ID through VexFlow: one timed chord keeps separately addressable
 * members, labels keep their own anchors, the LayoutMap maps IDs to staff,
 * bar and system, and an update drops the IDs it removed. Coordinates here
 * come from jsdom stubs, so only identity and finiteness are asserted; real
 * geometry is REN-I01.
 */
import { type ScoreSpecInput, applyScoreEdit } from '@sheet-music/music-domain';
import type { LayoutMap } from '@sheet-music/renderer-core';
import {
  F02,
  F02_ORACLE,
  F03,
  F03_ORACLE,
  F08,
  RICH_WIRE_FIXTURE,
  RICH_WIRE_ORACLE,
  cloneFixture,
  parseFixture,
} from '@sheet-music/test-fixtures';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  OPTIONS,
  THEME,
  buildFixtureBar,
  eventGlyph,
  installJsdomLayoutStubs,
  mountTarget,
  newRenderer,
  noteheadFill,
  noteheadGroup,
} from './support';

beforeAll(installJsdomLayoutStubs);

const E4_COLOR = '#e91e63';

/** F02 with a teaching color and a fingering on the chord's E4 only. */
function f02WithColoredE4(): ScoreSpecInput {
  const draft = cloneFixture(F02);
  const chord = draft.staves[0]?.measures[0]?.voices[0]?.events[0];
  if (chord?.type !== 'chord' || chord.notes[1] === undefined) {
    throw new Error('F02 must start with the C4-E4-G4 chord');
  }
  chord.notes[1] = { ...chord.notes[1], fingering: 3 };
  draft.annotations = [{ id: 'f02-a1', color: E4_COLOR, noteIds: ['f02-c1-e'], text: 'The third' }];
  return draft;
}

/** Written notes of the rich fixture (rests and chord IDs are not notes), by staff and bar. */
const RICH_NOTES: Readonly<Record<string, readonly [staffId: string, measureId: string]>> = {
  'rich-rh-n1': ['rich-rh', 'rich-m1'],
  'rich-rh-n2': ['rich-rh', 'rich-m1'],
  'rich-rh-c1-g': ['rich-rh', 'rich-m2'],
  'rich-rh-c1-b': ['rich-rh', 'rich-m2'],
  'rich-rh-c1-d': ['rich-rh', 'rich-m2'],
  'rich-rh-n3': ['rich-rh', 'rich-m2'],
  'rich-rh-n4': ['rich-rh', 'rich-m2'],
  'rich-rh-n5': ['rich-rh', 'rich-m2'],
  'rich-rh-n6': ['rich-rh', 'rich-m2'],
  'rich-rh-n7': ['rich-rh', 'rich-m3'],
  'rich-rh-n8': ['rich-rh', 'rich-m3'],
  'rich-rh-n9': ['rich-rh', 'rich-m3'],
  'rich-rh-c2-g': ['rich-rh', 'rich-m4'],
  'rich-rh-c2-b': ['rich-rh', 'rich-m4'],
  'rich-lh-n1': ['rich-lh', 'rich-m2'],
  'rich-lh-n2': ['rich-lh', 'rich-m2'],
  'rich-lh-n3': ['rich-lh', 'rich-m3'],
  'rich-lh-n4': ['rich-lh', 'rich-m3'],
  'rich-lh-n5': ['rich-lh', 'rich-m4'],
};

function allFinite(layout: LayoutMap): boolean {
  const boxes = [
    ...[...layout.notes.values()].map((note) => note.bounds),
    ...layout.systems.flatMap((system) => [
      system.bounds,
      system.annotationBand,
      ...system.staves.map((staff) => staff.bounds),
    ]),
  ];
  return boxes.every(
    (box) =>
      [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
      box.width >= 0 &&
      box.height >= 0,
  );
}

/** Vertical translation the renderer applied to a system group. */
function systemShift(target: HTMLElement, systemIndex: number): number {
  const transform =
    target.querySelector(`[data-system-index="${systemIndex}"]`)?.getAttribute('transform') ?? '';
  return Number(/translate\(0,([-\d.e]+)\)/.exec(transform)?.[1] ?? Number.NaN);
}

describe('REN-02 identity', () => {
  it('engraves C4-E4-G4 as one timed chord whose three notes stay addressable', async () => {
    const { glyphs } = buildFixtureBar(F02);
    const chord = eventGlyph(glyphs, F02_ORACLE.chordId).note;
    const members = F02_ORACLE.chordMemberIds.map((id) =>
      glyphs.notes.find((glyph) => glyph.noteId === id),
    );

    expect(chord.getKeys()).toEqual(['c/4', 'e/4', 'g/4']);
    expect(members.map((member) => member?.note)).toEqual([chord, chord, chord]);
    expect(members.map((member) => member?.index)).toEqual([0, 1, 2]);

    const target = mountTarget();
    const { layoutMap } = await newRenderer().render(parseFixture(F02), target, OPTIONS);
    const laid = F02_ORACLE.chordMemberIds.map((id) => layoutMap.notes.get(id));
    expect(laid.map((note) => note && [note.staffId, note.measureId, note.systemId])).toEqual([
      ['f02-rh', 'f02-m1', 'system-0'],
      ['f02-rh', 'f02-m1', 'system-0'],
      ['f02-rh', 'f02-m1', 'system-0'],
    ]);
    // Higher pitch, higher on the page: C4 below E4 below G4.
    const ys = laid.map((note) => note?.bounds.y ?? Number.NaN);
    expect(ys[0]).toBeGreaterThan(ys[1] ?? Number.NaN);
    expect(ys[1]).toBeGreaterThan(ys[2] ?? Number.NaN);
    expect(F02_ORACLE.chordMemberIds.map((id) => noteheadGroup(target, id).id)).toHaveLength(3);
  });

  it('colors and fingers only the targeted chord member', async () => {
    const target = mountTarget();
    await newRenderer().render(parseFixture(f02WithColoredE4()), target, OPTIONS);

    expect(noteheadFill(target, 'f02-c1-e')).toBe(E4_COLOR);
    expect(noteheadFill(target, 'f02-c1-c')).toBe(THEME.ink);
    expect(noteheadFill(target, 'f02-c1-g')).toBe(THEME.ink);
    const fingeringsOf = (id: string): (string | null)[] =>
      [...noteheadGroup(target, id).querySelectorAll('text')]
        .slice(1)
        .map((text) => text.textContent);
    expect(fingeringsOf('f02-c1-e')).toEqual(['3']);
    expect(fingeringsOf('f02-c1-c')).toEqual([]);
    expect(fingeringsOf('f02-c1-g')).toEqual([]);
  });

  it.each([
    { name: 'F03 ledger lines, labels, chords', fixture: F03 },
    { name: 'F08 slurs, ties, hairpins, pedal', fixture: F08 },
  ])('paints every unannotated mark with the theme ink: $name', async ({ fixture }) => {
    const target = mountTarget();
    await newRenderer().render(parseFixture(fixture), target, OPTIONS);
    const painted = new Set(
      [...target.querySelectorAll('[fill], [stroke]')].flatMap((element) =>
        ['fill', 'stroke']
          .map((name) => element.getAttribute(name))
          .filter((value) => value !== null && value !== 'none'),
      ),
    );

    expect([...painted]).toEqual([THEME.ink]);
  });

  it('anchors chord symbols above the top staff, Roman numerals below the bottom staff, degrees to their note', async () => {
    const { glyphs } = buildFixtureBar(F03);
    glyphs.formatter.format([...glyphs.voices], 600);
    const [top, bottom] = glyphs.staves;
    const tickOf = (id: string): unknown => eventGlyph(glyphs, id).note.getTickContext();

    // f03-h1 at offset 0 (f03-rh-n1, f03-lh-c1), f03-h2 at offset 1/2 (f03-rh-n3, f03-lh-c2).
    expect(top?.chordSymbols.map((label) => label.id)).toEqual(['f03-h1', 'f03-h2']);
    expect(bottom?.chordSymbols).toEqual([]);
    expect(bottom?.romanNumerals.map((label) => label.id)).toEqual(['f03-h1', 'f03-h2']);
    expect(top?.romanNumerals).toEqual([]);
    expect(top?.chordSymbols.map((label) => label.note.getTickContext())).toEqual([
      tickOf('f03-rh-n1'),
      tickOf('f03-rh-n3'),
    ]);
    expect(bottom?.romanNumerals.map((label) => label.note.getTickContext())).toEqual([
      tickOf('f03-lh-c1'),
      tickOf('f03-lh-c2'),
    ]);

    const target = mountTarget();
    const { layoutMap } = await newRenderer().render(parseFixture(F03), target, OPTIONS);
    const texts = (selector: string): (string | null)[] =>
      [...target.querySelectorAll(selector)].map((element) => element.textContent);
    expect(texts('.vf-chord-symbol')).toEqual(F03_ORACLE.harmony.map((harmony) => harmony.display));
    expect(texts('.vf-roman-numeral')).toEqual(
      F03_ORACLE.harmony.map((harmony) => harmony.romanNumeral),
    );
    const degrees = [...target.querySelectorAll('.vf-scale-degree')].map((element) => [
      element.getAttribute('data-note-id'),
      Number(element.textContent),
    ]);
    expect(Object.fromEntries(degrees)).toEqual(F03_ORACLE.scaleDegrees);

    // Label baselines are in system coordinates; the LayoutMap adds the system's vertical shift.
    const shift = systemShift(target, 0);
    const baseline = (selector: string): number =>
      Number(target.querySelector(`${selector} text`)?.getAttribute('y')) + shift;
    const [topStaff, bottomStaff] = layoutMap.systems[0]?.staves ?? [];
    expect(baseline('.vf-chord-symbol')).toBeLessThan(topStaff?.bounds.y ?? Number.NaN);
    expect(baseline('.vf-roman-numeral')).toBeGreaterThan(
      (bottomStaff?.bounds.y ?? Number.NaN) + (bottomStaff?.bounds.height ?? Number.NaN),
    );
  });

  it('maps every written note of the rich fixture to finite bounds with staff, bar and system', async () => {
    const { layoutMap } = await newRenderer().render(
      parseFixture(RICH_WIRE_FIXTURE),
      mountTarget(),
      OPTIONS,
    );
    const systemIds = new Set(layoutMap.systems.map((system) => system.systemId));

    expect([...layoutMap.notes.keys()].sort()).toEqual(Object.keys(RICH_NOTES).sort());
    for (const [noteId, [staffId, measureId]] of Object.entries(RICH_NOTES)) {
      const laid = layoutMap.notes.get(noteId);
      expect({ noteId: laid?.noteId, staffId: laid?.staffId, measureId: laid?.measureId }).toEqual({
        noteId,
        staffId,
        measureId,
      });
      expect(systemIds.has(laid?.systemId ?? '')).toBe(true);
    }
    expect(layoutMap.systems.flatMap((system) => system.measureIds)).toEqual(
      RICH_WIRE_ORACLE.barIds,
    );
    expect(
      layoutMap.systems.every(
        (system) =>
          system.staves.map((staff) => staff.staffId).join() === RICH_WIRE_ORACLE.staffIds.join(),
      ),
    ).toBe(true);
    expect(allFinite(layoutMap)).toBe(true);
  });

  it('drops the IDs an update removed', async () => {
    const before = parseFixture(F02);
    const edited = applyScoreEdit(before, {
      expectedRevision: before.revision,
      operations: [{ type: 'delete_measures', measureIds: ['f02-m2'] }],
    });
    if (!edited.ok) {
      throw new Error(JSON.stringify(edited.error));
    }
    const target = mountTarget();
    const renderer = newRenderer();
    await renderer.render(before, target, OPTIONS);
    const { layoutMap } = await renderer.update(edited.value);

    for (const removed of ['f02-rh-n3', 'f02-lh-n4']) {
      expect(layoutMap.notes.has(removed)).toBe(false);
      expect(target.querySelector(`[data-note-id="${removed}"]`)).toBeNull();
    }
    expect(layoutMap.notes.has('f02-c1-e')).toBe(true);
    expect(layoutMap.systems.flatMap((system) => system.measureIds)).toEqual(['f02-m1']);
  });
});
