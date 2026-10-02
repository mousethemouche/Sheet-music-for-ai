/**
 * UI-02 annotations (#7): each teaching annotation gets one plain-text label
 * marked with its own color (the text in the paper's ink, AA whatever the
 * teaching color; a decorative swatch in the teaching color), in the band
 * reserved above the system holding its notes, never over staff or system
 * bounds; multiline and stacked labels get a band tall enough (second pass).
 * The playback highlight is transient, gives notes back their teaching color,
 * and draws a band behind the sounding notes.
 *
 * Geometry comes from the fake renderer's fixed grid and a fixed 8 px / 20 px
 * text metric: this proves our band arithmetic, not real font geometry
 * (MCP-UI-01 runs the real renderer in a browser).
 */
import type { LayoutMap, SystemLayout } from '@sheet-music/renderer-core';
import { F02, F09, F09_SAME_COLOR_OVERLAP, cloneFixture } from '@sheet-music/test-fixtures';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LINE_HEIGHT, artifactOf, installTextMetrics, mountPlayer, ui } from './harness';

beforeEach(() => {
  installTextMetrics();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PINK = '#ff69b4';
const F09_TEXT = 'C major triad: root, third and fifth';
/** The fake renderer's narrowest surface: 240 px, one 200 px bar from x = 20, so labels wrap in 200 px. */
const NARROW = 240;

/** The label's stack box in LayoutMap coordinates (stacks are bottom-anchored on their band). */
function stackBox(label: HTMLElement, layout: LayoutMap) {
  const stack = label.parentElement;
  if (stack === null) {
    throw new Error('label without stack');
  }
  const bottom = layout.height - Number.parseFloat(stack.style.bottom);
  const height = stack.getBoundingClientRect().height;
  return { left: Number.parseFloat(stack.style.left), top: bottom - height, bottom };
}

/** The label's text is in the ink; its decorative swatch carries the teaching color. */
function expectTeachingLabel(label: HTMLElement, color: string, ink: string | undefined): void {
  expect(ink).toBeDefined();
  expect(label).toHaveStyle({ color: ink });
  const swatch = label.querySelector('[aria-hidden="true"]');
  expect(swatch).not.toBeNull();
  expect(swatch).toHaveStyle({ backgroundColor: color });
  expect(swatch).toHaveTextContent('');
}

/** The playback band rectangles, in LayoutMap coordinates. */
function playbackBands(): { left: number; top: number; width: number; height: number }[] {
  return [...document.querySelectorAll<HTMLElement>('[data-playback-band]')].map((band) => ({
    left: Number.parseFloat(band.style.left),
    top: Number.parseFloat(band.style.top),
    width: Number.parseFloat(band.style.width),
    height: Number.parseFloat(band.style.height),
  }));
}

function system(layout: LayoutMap, index: number): SystemLayout {
  const found = layout.systems[index];
  if (found === undefined) {
    throw new Error(`no system ${index}`);
  }
  return found;
}

function noteX(layout: LayoutMap, noteId: string): number {
  const note = layout.notes.get(noteId);
  if (note === undefined) {
    throw new Error(`note ${noteId} not laid out`);
  }
  return note.bounds.x;
}

describe('UI-02 annotations', () => {
  test('three pink notes get one matching label above their staff; the fourth stays ink', async () => {
    const player = await mountPlayer(artifactOf(F09), { width: NARROW });
    const { renderer } = player;
    const layout = renderer.layout;

    const label = screen.getByText(F09_TEXT);
    expect(label).toBeVisible();
    expectTeachingLabel(label, PINK, renderer.displayed?.options.theme.ink);
    // 36 characters in a 200 px band starting 20 px in: two 20 px lines.
    expect(renderer.calls.at(-1)?.options.annotationBandHeight).toBe(2 * LINE_HEIGHT);
    const box = stackBox(label, layout);
    const target = system(layout, 0);
    expect(box.top).toBeGreaterThanOrEqual(target.annotationBand.y);
    expect(box.bottom).toBe(target.bounds.y);
    for (const staff of target.staves) {
      expect(staff.bounds.y).toBeGreaterThanOrEqual(box.bottom);
    }
    expect(box.left + Number.parseFloat(label.style.paddingLeft)).toBe(noteX(layout, 'f09-n1'));

    const ink = renderer.displayed?.options.theme.ink;
    expect(['f09-n1', 'f09-n2', 'f09-n3', 'f09-n4'].map((id) => renderer.colorOf(id))).toEqual([
      PINK,
      PINK,
      PINK,
      ink,
    ]);
  });

  test('a label stays hidden until the renderer has reserved a band tall enough for it', async () => {
    const player = await mountPlayer(artifactOf(F09), {
      width: NARROW,
      setupRenderer: (renderer) => {
        renderer.mode = 'manual';
      },
    });
    const { renderer } = player;

    // First pass: no band yet; the measured label would cover the staff.
    await player.drive(() => {
      renderer.settleNext();
    });
    expect(system(renderer.layout, 0).annotationBand.height).toBe(0);
    expect(screen.getByText(F09_TEXT)).not.toBeVisible();

    // Second pass: the renderer reserved the measured height.
    expect(renderer.pendingCount).toBe(1);
    await player.drive(() => {
      renderer.settleNext();
    });
    expect(system(renderer.layout, 0).annotationBand.height).toBe(2 * LINE_HEIGHT);
    expect(screen.getByText(F09_TEXT)).toBeVisible();
    expect(renderer.pendingCount).toBe(0);
  });

  test('the playback highlight moves over the notes and gives back their teaching colors', async () => {
    const player = await mountPlayer(artifactOf(F09));
    const { renderer, engine } = player;
    const highlight = renderer.displayed?.options.theme.playbackHighlight;
    const ink = renderer.displayed?.options.theme.ink;
    const colors = () => ['f09-n1', 'f09-n2', 'f09-n3', 'f09-n4'].map((id) => renderer.colorOf(id));

    const layout = renderer.layout;
    const staves = system(layout, 0).staves;
    const staffTop = Math.min(...staves.map((staff) => staff.bounds.y));
    const staffBottom = Math.max(...staves.map((staff) => staff.bounds.y + staff.bounds.height));
    /** One band around the note, from above the top staff to below the bottom one. */
    const bandAround = (noteId: string) => {
      const note = layout.notes.get(noteId)?.bounds;
      if (note === undefined) throw new Error(`note ${noteId} not laid out`);
      return [
        {
          left: note.x - 6,
          top: staffTop - 8,
          width: note.width + 12,
          height: staffBottom - staffTop + 16,
        },
      ];
    };
    expect(playbackBands()).toEqual([]);

    await player.user.click(ui.playToggle());
    expect(colors()).toEqual([highlight, PINK, PINK, ink]);
    expect(playbackBands()).toEqual(bandAround('f09-n1'));

    await player.drive(() => {
      engine.advance(2900);
    });
    expect(colors()).toEqual([PINK, PINK, PINK, highlight]);
    expect(playbackBands()).toEqual(bandAround('f09-n4'));

    await player.user.click(ui.playToggle());
    expect(engine.getSnapshot().state).toBe('paused');
    expect(colors()).toEqual([PINK, PINK, PINK, highlight]);
    expect(playbackBands()).toEqual(bandAround('f09-n4'));

    await player.user.click(ui.playToggle());
    await player.drive(() => {
      engine.advance(1000);
    });
    expect(engine.getSnapshot().state).toBe('ready');
    expect(colors()).toEqual([PINK, PINK, PINK, ink]);
    expect(playbackBands()).toEqual([]);
    expectTeachingLabel(screen.getByText(F09_TEXT), PINK, ink);
  });

  test('stacked multiline labels get a band tall enough and stay off the staff', async () => {
    const player = await mountPlayer(artifactOf(F09_SAME_COLOR_OVERLAP), { width: NARROW });
    const layout = player.renderer.layout;
    const target = system(layout, 0);

    const first = screen.getByText(F09_TEXT);
    const second = screen.getByText('Fifth and octave');
    // Each label wraps to two lines (the second starts at half the band): 4 lines in one stack.
    expect(player.renderer.calls.at(-1)?.options.annotationBandHeight).toBe(4 * LINE_HEIGHT);
    expect(target.annotationBand.height).toBe(4 * LINE_HEIGHT);
    for (const label of [first, second]) {
      expect(label).toBeVisible();
      expectTeachingLabel(label, PINK, player.renderer.displayed?.options.theme.ink);
    }
    expect(first.parentElement).toBe(second.parentElement);
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const box = stackBox(first, layout);
    expect(box.top).toBe(target.annotationBand.y);
    expect(box.bottom).toBe(target.bounds.y);
    expect(Number.parseFloat(second.style.paddingLeft)).toBe(target.annotationBand.width / 2);
  });

  test('in a wide pane, a label of a short excerpt wraps in the pane width, not only the staff width', async () => {
    // 600 px pane: the one-bar system (and its band) is 200 px wide from x = 20.
    // The stack spans the surface less a 20 px margin on each side: 560 px.
    const player = await mountPlayer(artifactOf(F09), { width: 600 });
    const layout = player.renderer.layout;
    const target = system(layout, 0);
    const label = screen.getByText(F09_TEXT);
    const stack = label.parentElement;

    expect(target.annotationBand.width).toBe(200);
    expect(Number.parseFloat(stack?.style.width ?? '')).toBe(560);
    // 36 characters x 8 px = 288 px fit on one line after the 20 px indent.
    expect(player.renderer.calls.at(-1)?.options.annotationBandHeight).toBe(LINE_HEIGHT);
    const box = stackBox(label, layout);
    expect(label).toBeVisible();
    expect(box.top).toBeGreaterThanOrEqual(target.annotationBand.y);
    expect(box.bottom).toBe(target.bounds.y);
  });

  test('a label goes into the band of the system that holds its notes', async () => {
    const input = cloneFixture(F02);
    input.annotations = [
      {
        id: 'f02-a1',
        color: '#1e90ff',
        noteIds: ['f02-rh-n3', 'f02-lh-n4'],
        text: 'Both hands land on C',
      },
    ];
    // 240 px holds one bar per system: bar 2 is on the second system.
    const player = await mountPlayer(artifactOf(input), { width: 240 });
    const layout = player.renderer.layout;
    const [top, bottom] = [system(layout, 0), system(layout, 1)];

    const label = screen.getByText('Both hands land on C');
    expect(label).toBeVisible();
    expectTeachingLabel(label, '#1e90ff', player.renderer.displayed?.options.theme.ink);
    expect(top.annotationBand.height).toBe(0);
    const box = stackBox(label, layout);
    expect(box.top).toBeGreaterThanOrEqual(bottom.annotationBand.y);
    expect(box.top).toBeGreaterThanOrEqual(top.bounds.y + top.bounds.height);
    expect(box.bottom).toBe(bottom.bounds.y);
  });

  test('annotation text is shown as plain text, never as markup', async () => {
    const text = '<img src=x onerror="alert(1)"> & <b>bold</b>';
    const input = cloneFixture(F09);
    input.annotations = [{ id: 'f09-a1', color: '#ff69b4', noteIds: ['f09-n1'], text }];

    await mountPlayer(artifactOf(input));

    expect(screen.getByText(text)).toBeVisible();
    expect(document.querySelector('img, b')).toBeNull();
  });
});
