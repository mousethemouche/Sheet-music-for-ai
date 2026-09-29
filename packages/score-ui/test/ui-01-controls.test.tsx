/**
 * UI-01 controls (#7): load -> ready without autoplay; click and keyboard
 * Play/Pause, tempo and whole-excerpt loop reach the engine port, and the
 * visible state follows what the engine actually did. Tempo and loop are
 * local: no new score, revision, reload or re-engraving.
 *
 * Tempo is a slider thumb (`role="slider"`, driven by the keyboard: arrows
 * move one 5 % step, Home / End go to the ends) and Loop a switch
 * (`role="switch"`, `aria-checked`).
 */
import { PlaybackError, type PlaybackState } from '@sheet-music/playback-core';
import { F01 } from '@sheet-music/test-fixtures';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { type Player, artifactOf, mountPlayer, settle, ui } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface ControlCase {
  readonly name: string;
  readonly arrange?: (player: Player) => void | Promise<void>;
  readonly action: (player: Player) => void | Promise<void>;
  readonly engine: {
    state: PlaybackState;
    tempoMultiplier: number;
    loop: boolean;
    plays: number;
    /** Every multiplier the player asked the engine for, accepted or rejected. */
    tempoRequests: readonly number[];
  };
  readonly visible: {
    toggle: 'Play' | 'Pause';
    status: string;
    /** Slider value in percent; F01 is at 120 BPM. */
    tempo: number;
    loop: boolean;
    alert: RegExp | null;
  };
}

const READY = { toggle: 'Play', status: 'Ready', tempo: 100, loop: false, alert: null } as const;

const CASES: readonly ControlCase[] = [
  {
    name: 'a loaded score is ready and does not autoplay',
    action: () => {},
    engine: { state: 'ready', tempoMultiplier: 1, loop: false, plays: 0, tempoRequests: [] },
    visible: READY,
  },
  {
    name: 'clicking Play starts playback',
    action: ({ user }) => user.click(ui.playToggle()),
    engine: { state: 'playing', tempoMultiplier: 1, loop: false, plays: 1, tempoRequests: [] },
    visible: { ...READY, toggle: 'Pause', status: 'Playing' },
  },
  {
    name: 'Tab then Enter on Play starts playback',
    action: async ({ user }) => {
      await user.tab();
      expect(ui.playToggle()).toHaveFocus();
      await user.keyboard('{Enter}');
    },
    engine: { state: 'playing', tempoMultiplier: 1, loop: false, plays: 1, tempoRequests: [] },
    visible: { ...READY, toggle: 'Pause', status: 'Playing' },
  },
  {
    name: 'Space on Pause pauses playback',
    arrange: ({ user }) => user.click(ui.playToggle()),
    action: async ({ user }) => {
      ui.playToggle().focus();
      await user.keyboard(' ');
    },
    engine: { state: 'paused', tempoMultiplier: 1, loop: false, plays: 1, tempoRequests: [] },
    visible: { ...READY, status: 'Paused' },
  },
  {
    name: 'a rejected play() leaves the player ready and says so',
    arrange: ({ engine }) => {
      engine.playError = new PlaybackError('PLAYBACK_FAILED', 'no audio output');
    },
    action: ({ user }) => user.click(ui.playToggle()),
    engine: { state: 'ready', tempoMultiplier: 1, loop: false, plays: 1, tempoRequests: [] },
    visible: { ...READY, alert: /Audio could not start/ },
  },
  {
    name: 'five ArrowLeft presses on the tempo slider set the local multiplier',
    action: async ({ user }) => {
      ui.tempo().focus();
      await user.keyboard('{ArrowLeft>5/}');
    },
    engine: {
      state: 'ready',
      tempoMultiplier: 0.75,
      loop: false,
      plays: 0,
      tempoRequests: [0.95, 0.9, 0.85, 0.8, 0.75],
    },
    visible: { ...READY, tempo: 75 },
  },
  {
    name: 'a tempo the engine rejects leaves the slider on the engine value',
    arrange: ({ engine }) => {
      engine.rejectTempo = true;
    },
    action: async ({ user }) => {
      ui.tempo().focus();
      await user.keyboard('{End}');
    },
    // End asked for 200 %: the engine threw, so its multiplier and the slider stay at 100 %.
    engine: { state: 'ready', tempoMultiplier: 1, loop: false, plays: 0, tempoRequests: [2] },
    visible: READY,
  },
  {
    name: 'Space on Loop turns whole-excerpt looping on',
    action: async ({ user }) => {
      ui.loop().focus();
      await user.keyboard(' ');
    },
    engine: { state: 'ready', tempoMultiplier: 1, loop: true, plays: 0, tempoRequests: [] },
    visible: { ...READY, loop: true },
  },
  {
    name: 'clicking the Loop label turns looping on',
    action: ({ user }) => user.click(screen.getByText('Loop')),
    engine: { state: 'ready', tempoMultiplier: 1, loop: true, plays: 0, tempoRequests: [] },
    visible: { ...READY, loop: true },
  },
];

describe('UI-01 controls', () => {
  test.each(CASES)('$name', async ({ arrange, action, engine, visible }) => {
    const artifact = artifactOf(F01);
    const original = structuredClone(artifact);
    const player = await mountPlayer(artifact);
    const renderCalls = player.renderer.calls.length;
    await arrange?.(player);

    await action(player);
    await settle();

    const snapshot = player.engine.getSnapshot();
    expect({
      state: snapshot.state,
      tempoMultiplier: snapshot.tempoMultiplier,
      loop: snapshot.loop,
      plays: player.engine.playCalls,
      tempoRequests: player.engine.tempoRequests,
    }).toEqual(engine);
    expect(ui.playToggle()).toHaveAccessibleName(visible.toggle);
    expect(ui.playToggle()).toBeEnabled();
    expect(ui.status()).toHaveTextContent(visible.status);
    expect(ui.tempo()).toHaveAttribute('aria-valuenow', String(visible.tempo));
    expect(ui.tempo()).toHaveAttribute(
      'aria-valuetext',
      `${visible.tempo}% (${(120 * visible.tempo) / 100} BPM)`,
    );
    expect(ui.tempo()).not.toHaveAttribute('aria-disabled');
    expect(ui.loop()).toHaveAttribute('aria-checked', String(visible.loop));
    expect(ui.loop()).toBeEnabled();
    if (visible.alert === null) {
      expect(ui.alert()).toBeEmptyDOMElement();
    } else {
      expect(ui.alert()).toHaveTextContent(visible.alert);
    }
    // Local settings only: same canonical score and revision, no reload, no re-engraving.
    expect(artifact).toEqual(original);
    expect(player.engine.loads.map((plan) => `${plan.scoreId}@${plan.revision}`)).toEqual([
      'f01@1',
    ]);
    expect(player.renderer.calls).toHaveLength(renderCalls);
    expect(ui.notation()).toHaveTextContent('f01 revision 1');
  });

  test('Tempo and Loop are disabled until the engine exists, then enabled', async () => {
    // The first frame, as committed before the attach effect creates the engine.
    // Radix shows the thumb (and so names it) only once it has measured it:
    // it is still the only slider, found with `hidden`.
    let firstFrame: { tempo: Element; loop: Element } | undefined;
    await mountPlayer(artifactOf(F01), {
      setupEngine: () => {
        firstFrame ??= {
          tempo: screen.getByRole('slider', { hidden: true }).cloneNode() as Element,
          loop: screen.getByRole('switch', { name: 'Loop' }).cloneNode() as Element,
        };
      },
    });

    expect(firstFrame?.tempo).toHaveAttribute('aria-disabled', 'true');
    expect(firstFrame?.tempo).not.toHaveAttribute('tabindex');
    expect(firstFrame?.loop).toBeDisabled();
    expect(ui.tempo()).not.toHaveAttribute('aria-disabled');
    expect(ui.tempo()).toHaveAttribute('tabindex', '0');
    expect(ui.loop()).toBeEnabled();
  });
});
