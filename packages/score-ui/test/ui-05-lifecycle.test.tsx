/**
 * UI-05 lifecycle and host context (#7): resizing, including a hidden width
 * of 0, and host theme changes keep the score, its revision and playback;
 * StrictMode double mounting, unmounting and late port results leave exactly
 * one live renderer/engine while mounted, and no listener, audio or update
 * after unmount.
 */
import { F09 } from '@sheet-music/test-fixtures';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { artifactOf, installTextMetrics, mountPlayer, settle, ui } from './harness';

const F09_TEXT = 'C major triad: root, third and fifth';

beforeEach(() => {
  installTextMetrics();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('UI-05 host context', () => {
  test('hiding the player (width 0) and showing it again keeps the score and playback', async () => {
    const player = await mountPlayer(artifactOf(F09), { width: 600 });
    const { renderer, engine } = player;
    await player.user.click(ui.playToggle());
    await player.drive(() => {
      engine.advance(100);
    });

    await player.resize(0);

    expect(renderer.calls.at(-1)?.options.width).toBe(0);
    expect(screen.queryByText(F09_TEXT)).toBeNull();
    expect(ui.notation()).toHaveTextContent('f09 revision 1');
    expect(engine.getSnapshot().state).toBe('playing');

    await player.resize(480);

    expect(renderer.displayed?.options.width).toBe(480);
    expect(renderer.displayed?.score.revision).toBe(1);
    expect(screen.getByText(F09_TEXT)).toBeVisible();
    expect(engine.getSnapshot().state).toBe('playing');
    expect(engine.position).toBe(100);
    expect(engine.loads.map((plan) => plan.revision)).toEqual([1]);
  });

  test('a newer revision accepted while hidden becomes playable only once drawn', async () => {
    const player = await mountPlayer(artifactOf(F09), { width: 600 });
    await player.resize(0);

    await player.show(artifactOf(F09, { revision: 2 }));

    expect(player.engine.getSnapshot().plan?.revision).toBe(2);
    expect(ui.notation()).toHaveTextContent('f09 revision 1');
    expect(ui.playToggle()).toBeDisabled();

    await player.resize(480);

    expect(ui.notation()).toHaveTextContent('f09 revision 2');
    expect(ui.playToggle()).toBeEnabled();
  });

  test('a host theme change re-engraves in that theme and keeps teaching colors', async () => {
    const player = await mountPlayer(artifactOf(F09), { theme: 'light' });
    const { renderer, engine } = player;
    const light = renderer.displayed?.options.theme;

    await player.setTheme('dark');

    const dark = renderer.displayed?.options.theme;
    expect(dark).toBeDefined();
    expect(dark?.ink).not.toBe(light?.ink);
    expect(renderer.displayed?.score.revision).toBe(1);
    expect(['f09-n1', 'f09-n2', 'f09-n3', 'f09-n4'].map((id) => renderer.colorOf(id))).toEqual([
      '#ff69b4',
      '#ff69b4',
      '#ff69b4',
      dark?.ink,
    ]);
    // The label's text follows the ink (readable on the dark paper); its swatch keeps the teaching color.
    const label = screen.getByText(F09_TEXT);
    expect(label).toHaveStyle({ color: dark?.ink });
    expect(label.querySelector('[aria-hidden="true"]')).toHaveStyle({ backgroundColor: '#ff69b4' });
    expect(engine.loads.map((plan) => plan.revision)).toEqual([1]);
    expect(ui.status()).toHaveTextContent('Ready');
  });
});

describe('UI-05 lifecycle', () => {
  test('StrictMode leaves exactly one live renderer, engine and observer', async () => {
    const errors = vi.spyOn(console, 'error');
    const player = await mountPlayer(artifactOf(F09), { strict: true });
    const [discardedRenderer, liveRenderer] = player.renderers;
    const [discardedEngine, liveEngine] = player.engines;

    expect(player.renderers).toHaveLength(2);
    expect(player.engines).toHaveLength(2);
    expect(discardedRenderer?.destroyed).toBe(true);
    expect(discardedEngine?.destroyed).toBe(true);
    expect(discardedEngine?.listenerCount).toBe(0);
    expect(liveRenderer?.destroyed).toBe(false);
    expect(liveEngine?.listenerCount).toBe(2);
    expect(player.viewport.observerCount).toBe(1);
    expect(screen.getAllByText('f09 revision 1')).toHaveLength(1);
    expect(screen.getAllByText(F09_TEXT)).toHaveLength(1);

    await player.user.click(ui.playToggle());

    expect(liveEngine?.getSnapshot().state).toBe('playing');
    expect(discardedEngine?.playCalls).toBe(0);
    expect(discardedEngine?.callsAfterDestroy).toEqual([]);
    expect(discardedRenderer?.callsAfterDestroy).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  test('unmounting with work pending releases everything and ignores late results', async () => {
    const errors = vi.spyOn(console, 'error');
    const player = await mountPlayer(artifactOf(F09));
    const { renderer, engine } = player;
    await player.user.click(ui.playToggle());
    renderer.mode = 'manual';
    engine.loadMode = 'manual';
    await player.show(artifactOf(F09, { revision: 2 }));
    expect(renderer.pendingCount).toBe(1);

    player.unmount();
    await settle();

    expect(engine.destroyed).toBe(true);
    expect(engine.sounding).toEqual([]);
    expect(engine.listenerCount).toBe(0);
    expect(renderer.destroyed).toBe(true);
    expect(renderer.pendingCount).toBe(0);
    expect(player.viewport.observerCount).toBe(0);
    expect(engine.callsAfterDestroy).toEqual([]);
    expect(renderer.callsAfterDestroy).toEqual([]);
    expect(player.renderers).toHaveLength(1);
    expect(player.engines).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
  });
});
