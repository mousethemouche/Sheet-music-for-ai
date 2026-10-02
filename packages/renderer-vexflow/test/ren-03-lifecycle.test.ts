// @vitest-environment jsdom
/**
 * REN-03 (issue #5): lifecycle and failure containment of the real adapter
 * (RENDER_PLAYBACK_PORTS.md §2.1-2.4, §2.6). update, resize, hidden width 0,
 * destroy and remount never leave a second SVG or a listener behind; bad
 * options, library failures, font failures and lifecycle misuse all reject
 * with RENDER_FAILED and keep the last good rendering; the input score is
 * not changed and only plain data comes out. The playback highlight layer
 * never erases a teaching color.
 */
import type { ScoreSpec, ScoreSpecInput } from '@sheet-music/music-domain';
import { RenderError, type RenderResult } from '@sheet-music/renderer-core';
import {
  F01,
  F02,
  F09,
  F09_ORACLE,
  RICH_WIRE_FIXTURE,
  cloneFixture,
  parseFixture,
} from '@sheet-music/test-fixtures';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVexFlowRendererFactory } from '../src';
import {
  OPTIONS,
  THEME,
  installJsdomLayoutStubs,
  mountTarget,
  newRenderer,
  noteheadFill,
} from './support';

beforeAll(installJsdomLayoutStubs);
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const svgCount = (target: HTMLElement): number => target.querySelectorAll('svg').length;

async function renderFailure(promise: Promise<RenderResult>): Promise<RenderError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof RenderError)) {
    throw new Error(`Expected a RenderError, got ${String(error)}`);
  }
  return error;
}

/** A score that passes the type system but that VexFlow cannot engrave (no such step "H"). */
function unengravable(): ScoreSpec {
  const draft = cloneFixture(parseFixture(F01)) as unknown as ScoreSpecInput;
  const first = draft.staves[0]?.measures[0]?.voices[0]?.events[0];
  if (first?.type !== 'note') {
    throw new Error('F01 starts with a note');
  }
  (first.pitch as { step: string }).step = 'H';
  return draft as unknown as ScoreSpec;
}

/** Walks a value and returns the constructors of every non-plain object in it. */
function foreignTypes(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return [];
  }
  seen.add(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  const plain =
    prototype === Object.prototype || prototype === Array.prototype || prototype === Map.prototype;
  const own = plain ? [] : [value.constructor.name];
  const children =
    value instanceof Map ? [...value.keys(), ...value.values()] : Object.values(value);
  return [...own, ...children.flatMap((child) => foreignTypes(child, seen))];
}

describe('REN-03 lifecycle and failure', () => {
  it('keeps exactly one SVG through render, update and resize, and adds no listener', async () => {
    const listeners = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const target = mountTarget();
    const renderer = newRenderer();

    await renderer.render(parseFixture(F01), target, OPTIONS);
    await renderer.update(parseFixture(F02));
    await renderer.resize(320);
    await renderer.update(parseFixture(RICH_WIRE_FIXTURE), { ...OPTIONS, width: 900 });

    expect(svgCount(target)).toBe(1);
    expect(target.querySelector('[data-note-id="rich-rh-c1-b"]')).not.toBeNull();
    expect(target.querySelector('[data-note-id="f01-n1"]')).toBeNull();
    expect(listeners).not.toHaveBeenCalled();
  });

  it('treats width 0 as hidden: empty layout, display untouched, next width engraves the latest score', async () => {
    const target = mountTarget();
    const renderer = newRenderer();
    await renderer.render(parseFixture(F01), target, OPTIONS);
    const shown = target.querySelector('svg');

    const hidden = await renderer.update(parseFixture(F02), { ...OPTIONS, width: 0 });
    expect(hidden.layoutMap).toEqual({ width: 0, height: 0, systems: [], notes: new Map() });
    expect(target.querySelector('svg')).toBe(shown);

    const visible = await renderer.resize(500);
    expect(visible.layoutMap.notes.has('f02-c1-e')).toBe(true);
    expect(svgCount(target)).toBe(1);
    expect(target.querySelector('svg')).not.toBe(shown);
  });

  it('applies calls in call order', async () => {
    const target = mountTarget();
    const renderer = newRenderer();
    const settled: string[] = [];
    const track = (label: string, promise: Promise<RenderResult>): Promise<void> =>
      promise.then(() => {
        settled.push(label);
      });

    await Promise.all([
      track('render F01', renderer.render(parseFixture(F01), target, OPTIONS)),
      track('update F02', renderer.update(parseFixture(F02))),
      track('resize', renderer.resize(300)),
      track('update F09', renderer.update(parseFixture(F09))),
    ]);

    expect(settled).toEqual(['render F01', 'update F02', 'resize', 'update F09']);
    expect(target.querySelector('[data-note-id="f09-n1"]')).not.toBeNull();
    expect(svgCount(target)).toBe(1);
  });

  it('removes everything on destroy, is idempotent, rejects later calls, and a remount starts clean', async () => {
    const target = mountTarget();
    const own = document.createElement('p');
    target.append(own);
    const renderer = newRenderer();
    await renderer.render(parseFixture(F01), target, OPTIONS);

    renderer.destroy();
    renderer.destroy();
    renderer.setPlaybackHighlight(['f01-n1']);
    expect([...target.children]).toEqual([own]);
    for (const call of [
      renderer.update(parseFixture(F02)),
      renderer.resize(400),
      renderer.render(parseFixture(F01), target, OPTIONS),
    ]) {
      expect((await renderFailure(call)).code).toBe('RENDER_FAILED');
    }
    expect([...target.children]).toEqual([own]);

    const remounted = newRenderer();
    await remounted.render(parseFixture(F02), target, OPTIONS);
    expect(svgCount(target)).toBe(1);
  });

  it('rejects a call still waiting for fonts at destroy, without touching the target', async () => {
    let fontsRequested = (): void => undefined;
    const requested = new Promise<void>((resolve) => {
      fontsRequested = resolve;
    });
    let releaseFonts = (): void => undefined;
    const fonts = new Promise<void>((resolve) => {
      releaseFonts = resolve;
    });
    const renderer = createVexFlowRendererFactory({
      loadFonts: () => {
        fontsRequested();
        return fonts;
      },
    })();
    const target = mountTarget();

    const pending = renderer.render(parseFixture(F01), target, OPTIONS);
    await requested;
    renderer.destroy();
    releaseFonts();

    expect((await renderFailure(pending)).code).toBe('RENDER_FAILED');
    expect(svgCount(target)).toBe(0);
  });

  it.each([
    { name: 'negative width', options: { ...OPTIONS, width: -1 } },
    { name: 'infinite width', options: { ...OPTIONS, width: Number.POSITIVE_INFINITY } },
    { name: 'NaN annotation band', options: { ...OPTIONS, annotationBandHeight: Number.NaN } },
    { name: 'empty ink color', options: { ...OPTIONS, theme: { ...THEME, ink: '' } } },
  ])('rejects malformed options and keeps the last rendering: $name', async ({ options }) => {
    const target = mountTarget();
    const renderer = newRenderer();
    await renderer.render(parseFixture(F01), target, OPTIONS);
    const shown = target.innerHTML;

    expect((await renderFailure(renderer.update(parseFixture(F02), options))).code).toBe(
      'RENDER_FAILED',
    );
    expect(target.innerHTML).toBe(shown);
    await expect(renderer.update(parseFixture(F02))).resolves.toBeDefined();
  });

  it('turns a VexFlow failure into RENDER_FAILED and keeps the last rendering', async () => {
    const target = mountTarget();
    const renderer = newRenderer();
    await renderer.render(parseFixture(F01), target, OPTIONS);
    const shown = target.innerHTML;

    const error = await renderFailure(renderer.update(unengravable()));
    expect(error.code).toBe('RENDER_FAILED');
    expect(error.cause).toBeInstanceOf(Error);
    expect(target.innerHTML).toBe(shown);
  });

  it('removes a half-drawn SVG when drawing fails and keeps the last rendering', async () => {
    const target = mountTarget();
    const renderer = newRenderer();
    await renderer.render(parseFixture(F01), target, OPTIONS);
    const shown = target.innerHTML;
    vi.spyOn(SVGElement.prototype as SVGGraphicsElement, 'getBBox').mockImplementation(() => {
      throw new Error('SVG geometry unavailable');
    });

    expect((await renderFailure(renderer.update(parseFixture(F02)))).code).toBe('RENDER_FAILED');
    expect(target.innerHTML).toBe(shown);
  });

  it('rejects with RENDER_FAILED when the fonts cannot load', async () => {
    const renderer = createVexFlowRendererFactory({
      loadFonts: () => Promise.reject(new Error('blocked by CSP')),
    })();
    const target = mountTarget();

    expect((await renderFailure(renderer.render(parseFixture(F01), target, OPTIONS))).code).toBe(
      'RENDER_FAILED',
    );
    expect(svgCount(target)).toBe(0);
  });

  it.each([
    {
      name: 'second render keeps the current mount',
      misuse: async (renderer: ReturnType<typeof newRenderer>, target: HTMLElement) => {
        await renderer.render(parseFixture(F01), target, OPTIONS);
        return renderer.render(parseFixture(F02), mountTarget(), OPTIONS);
      },
      svgs: 1,
    },
    {
      name: 'update before render',
      misuse: (renderer: ReturnType<typeof newRenderer>) =>
        renderer.update(parseFixture(F01), OPTIONS),
      svgs: 0,
    },
    {
      name: 'resize before render',
      misuse: (renderer: ReturnType<typeof newRenderer>) => renderer.resize(400),
      svgs: 0,
    },
  ])('rejects lifecycle misuse: $name', async ({ misuse, svgs }) => {
    const target = mountTarget();
    const renderer = newRenderer();

    expect((await renderFailure(misuse(renderer, target))).code).toBe('RENDER_FAILED');
    expect(svgCount(target)).toBe(svgs);
    expect(target.querySelector('[data-note-id="f02-c1-e"]')).toBeNull();
  });

  it('leaves the input score unchanged and returns plain data only', async () => {
    const score = parseFixture(RICH_WIRE_FIXTURE);
    const before = JSON.stringify(score);

    const result = await newRenderer().render(score, mountTarget(), OPTIONS);

    expect(JSON.stringify(score)).toBe(before);
    expect(foreignTypes(result)).toEqual([]);
  });

  it('highlights playback notes without erasing teaching colors, and keeps the set across updates', async () => {
    const target = mountTarget();
    const renderer = newRenderer();
    const pink = F09_ORACLE.canonicalColor;
    await renderer.render(parseFixture(F09), target, OPTIONS);

    renderer.setPlaybackHighlight(['f09-n1', 'f09-n4', 'unknown-id']);
    expect(noteheadFill(target, 'f09-n1')).toBe(THEME.playbackHighlight);
    expect(noteheadFill(target, 'f09-n4')).toBe(THEME.playbackHighlight);
    expect(noteheadFill(target, 'f09-n2')).toBe(pink);

    await renderer.resize(420);
    expect(noteheadFill(target, 'f09-n1')).toBe(THEME.playbackHighlight);

    renderer.setPlaybackHighlight(['f09-n4']);
    expect(noteheadFill(target, 'f09-n1')).toBe(pink);
    renderer.setPlaybackHighlight([]);
    expect(noteheadFill(target, 'f09-n4')).toBe(THEME.ink);
  });
});
