/**
 * UI-01 controls (#7): load -> ready without autoplay; click and keyboard
 * Play/Pause, tempo and whole-excerpt loop reach the engine port, and the
 * visible state follows what the engine actually did. Tempo and loop are
 * local: no new score, revision, reload or re-engraving.
 */
import { PlaybackError, type PlaybackState } from '@sheet-music/playback-core';
import { F01 } from '@sheet-music/test-fixtures';
import { fireEvent } from '@testing-library/react';
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
  readonly engine: { state: PlaybackState; tempoMultiplier: number; loop: boolean; plays: number };
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
    engine: { state: 'ready', tempoMultiplier: 1, loop: false, plays: 0 },
    visible: READY,
  },
  {
    name: 'clicking Play starts playback',
    action: ({ user }) => user.click(ui.playToggle()),
    engine: { state: 'playing', tempoMultiplier: 1, loop: false, plays: 1 },
    visible: { ...READY, toggle: 'Pause', status: 'Playing' },
  },
  {
    name: 'Tab then Enter on Play starts playback',
    action: async ({ user }) => {
      await user.tab();
      expect(ui.playToggle()).toHaveFocus();
      await user.keyboard('{Enter}');
    },
    engine: { state: 'playing', tempoMultiplier: 1, loop: false, plays: 1 },
    visible: { ...READY, toggle: 'Pause', status: 'Playing' },
  },
  {
    name: 'Space on Pause pauses playback',
    arrange: ({ user }) => user.click(ui.playToggle()),
    action: async ({ user }) => {
      ui.playToggle().focus();
      await user.keyboard(' ');
    },
    engine: { state: 'paused', tempoMultiplier: 1, loop: false, plays: 1 },
    visible: { ...READY, status: 'Paused' },
  },
  {
    name: 'a rejected play() leaves the player ready and says so',
    arrange: ({ engine }) => {
      engine.playError = new PlaybackError('PLAYBACK_FAILED', 'no audio output');
    },
    action: ({ user }) => user.click(ui.playToggle()),
    engine: { state: 'ready', tempoMultiplier: 1, loop: false, plays: 1 },
    visible: { ...READY, alert: /Audio could not start/ },
  },
  {
    name: 'the tempo slider sets the local multiplier',
    action: () => {
      fireEvent.change(ui.tempo(), { target: { value: '75' } });
    },
    engine: { state: 'ready', tempoMultiplier: 0.75, loop: false, plays: 0 },
    visible: { ...READY, tempo: 75 },
  },
  {
    name: 'a tempo the engine rejects leaves the slider on the engine value',
    arrange: ({ engine }) => {
      engine.rejectTempo = true;
    },
    action: () => {
      fireEvent.change(ui.tempo(), { target: { value: '150' } });
    },
    engine: { state: 'ready', tempoMultiplier: 1, loop: false, plays: 0 },
    visible: READY,
  },
  {
    name: 'Space on Loop turns whole-excerpt looping on',
    action: async ({ user }) => {
      ui.loop().focus();
      await user.keyboard(' ');
    },
    engine: { state: 'ready', tempoMultiplier: 1, loop: true, plays: 0 },
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
    }).toEqual(engine);
    expect(ui.playToggle()).toHaveAccessibleName(visible.toggle);
    expect(ui.playToggle()).toBeEnabled();
    expect(ui.status()).toHaveTextContent(visible.status);
    expect(ui.tempo()).toHaveValue(String(visible.tempo));
    expect(ui.tempo()).toHaveAttribute(
      'aria-valuetext',
      `${visible.tempo}% (${(120 * visible.tempo) / 100} BPM)`,
    );
    expect(ui.loop().checked).toBe(visible.loop);
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
});
