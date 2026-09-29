/**
 * UI-03 replacement / P-01 (#7): a newer accepted revision of the displayed
 * score, arriving while playing (looping) or paused, silences the old notes
 * and pedal at once, loads the new plan at tick 0 and stays stopped until an
 * explicit Play. Old audio never sounds under new notation, nor new audio
 * under old notation. Duplicate or older results and local tempo changes
 * reset nothing; among competing revisions only the latest is loaded.
 * Another score replaces the displayed one the same way (the host switched
 * scores), unless it is a stale revision of a score shown earlier.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PEDALLED, type Player, artifactOf, mountPlayer, ui } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The same score, one revision later, with a changed last note (as an edit would). */
function revision(number: number): ScoreSpecInput {
  const input = { ...structuredClone(PEDALLED), revision: number };
  const lastNote = input.staves[0]?.measures[0]?.voices[0]?.events[3];
  if (lastNote?.type === 'note') {
    lastNote.pitch = { step: 'B', alter: 0, octave: 4 + (number % 2) };
  }
  return input;
}

const shownRevision = (player: Player) => player.renderer.displayed?.score.revision;

/** Score `a` (the pedalled one, by revision) or score `b` (another score ID), as `a2` or `b1`. */
function scoreNamed(name: string): ScoreSpecInput {
  const number = Number(name.slice(1));
  return name.startsWith('a')
    ? revision(number)
    : { ...structuredClone(PEDALLED), id: 'ui-other', revision: number };
}

const shownName = (player: Player): string => {
  const shown = player.renderer.displayed?.score;
  return `${shown?.id === 'ui-other' ? 'b' : 'a'}${String(shown?.revision)}`;
};

describe('UI-03 newer revision (P-01)', () => {
  test.each([
    {
      name: 'while playing with loop on',
      arrange: async (player: Player) => {
        await player.user.click(ui.loop());
        await player.user.click(ui.playToggle());
        await player.drive(() => {
          player.engine.advance(500);
        });
      },
      loop: true,
      soundingBefore: true,
    },
    {
      name: 'while paused',
      arrange: async (player: Player) => {
        await player.user.click(ui.playToggle());
        await player.drive(() => {
          player.engine.advance(500);
        });
        await player.user.click(ui.playToggle());
      },
      loop: false,
      soundingBefore: false,
    },
  ])(
    '$name: silence now, load at tick 0, wait for Play',
    async ({ arrange, loop, soundingBefore }) => {
      const player = await mountPlayer(artifactOf(revision(1)));
      const { renderer, engine } = player;
      await arrange(player);
      expect(engine.getSnapshot().plan?.revision).toBe(1);
      expect(engine.pedalDown).toBe(soundingBefore);
      expect(engine.sounding.length > 0).toBe(soundingBefore);
      renderer.mode = 'manual';
      engine.loadMode = 'manual';

      await player.show(artifactOf(revision(2)));

      // Before the new notation or plan is ready: old notes and pedal are released.
      expect(engine.sounding).toEqual([]);
      expect(engine.pedalDown).toBe(false);
      expect(renderer.highlight.size).toBe(0);
      expect(shownRevision(player)).toBe(1);
      expect(ui.playToggle()).toHaveAccessibleName('Play');
      expect(ui.playToggle()).toBeDisabled();

      await player.drive(() => {
        renderer.settleNext();
        engine.completeLoad();
      });

      expect(shownRevision(player)).toBe(2);
      expect(ui.notation()).toHaveTextContent('ui-pedal revision 2');
      const snapshot = engine.getSnapshot();
      expect(snapshot).toMatchObject({ state: 'ready', loop });
      expect(snapshot.plan?.revision).toBe(2);
      expect(engine.position).toBe(0);
      expect(engine.playCalls).toBe(1);
      expect(ui.status()).toHaveTextContent('Ready');
      expect(ui.playToggle()).toBeEnabled();

      await player.user.click(ui.playToggle());
      expect(engine.getSnapshot()).toMatchObject({ state: 'playing' });
      expect(engine.getSnapshot().plan?.revision).toBe(2);
    },
  );

  test.each<{ name: string; change: (player: Player) => void | Promise<void> }>([
    {
      name: 'the same revision again (duplicate result)',
      change: (player) => player.show(artifactOf(revision(2))),
    },
    {
      name: 'an older revision (stale result)',
      change: (player) => player.show(artifactOf(revision(1))),
    },
    {
      name: 'a local tempo change',
      change: () => {
        fireEvent.change(ui.tempo(), { target: { value: '60' } });
      },
    },
  ])('$name does not reset playback', async ({ change }) => {
    const player = await mountPlayer(artifactOf(revision(2)));
    const { renderer, engine } = player;
    await player.user.click(ui.playToggle());
    await player.drive(() => {
      engine.advance(1500);
    });
    const renderCalls = renderer.calls.length;

    await change(player);

    expect(engine.getSnapshot().state).toBe('playing');
    expect(engine.position).toBe(1500);
    expect(engine.loads.map((plan) => plan.revision)).toEqual([2]);
    expect(renderer.calls).toHaveLength(renderCalls);
    expect(shownRevision(player)).toBe(2);
    expect(ui.alert()).toBeEmptyDOMElement();
  });

  test.each([
    {
      name: 'another score: the host switched scores',
      earlier: ['a1'],
      last: 'b1',
      replaced: true,
    },
    {
      name: 'back to a score shown earlier, at the revision shown then',
      earlier: ['a1', 'b1'],
      last: 'a1',
      replaced: true,
    },
    {
      name: 'a stale revision of a score shown earlier',
      earlier: ['a2', 'b1'],
      last: 'a1',
      replaced: false,
    },
  ])('$name while playing: replaced=$replaced', async ({ earlier, last, replaced }) => {
    const [first, ...others] = earlier;
    const player = await mountPlayer(artifactOf(scoreNamed(first ?? 'a1')));
    for (const name of others) {
      await player.show(artifactOf(scoreNamed(name)));
    }
    const { engine } = player;
    const shownBefore = shownName(player);
    const loadsBefore = engine.loads.length;
    await player.user.click(ui.playToggle());
    await player.drive(() => {
      engine.advance(1500);
    });

    await player.show(artifactOf(scoreNamed(last)));

    if (replaced) {
      // P-01, as for a newer revision: silence, the new score at tick 0, no autoplay.
      expect(shownName(player)).toBe(last);
      expect(engine.loads).toHaveLength(loadsBefore + 1);
      expect(engine.getSnapshot()).toMatchObject({ state: 'ready' });
      expect(engine.position).toBe(0);
      expect(engine.sounding).toEqual([]);
      expect(engine.playCalls).toBe(1);
    } else {
      expect(shownName(player)).toBe(shownBefore);
      expect(engine.loads).toHaveLength(loadsBefore);
      expect(engine.getSnapshot().state).toBe('playing');
      expect(engine.position).toBe(1500);
    }
    expect(ui.alert()).toBeEmptyDOMElement();
  });

  test('competing revisions: only the latest is loaded, and Play waits for its notation', async () => {
    const player = await mountPlayer(artifactOf(revision(1)));
    const { renderer, engine } = player;
    await player.user.click(ui.playToggle());
    renderer.mode = 'manual';
    engine.loadMode = 'manual';

    await player.show(artifactOf(revision(2)));
    await player.show(artifactOf(revision(3)));
    // The plan of revision 3 is committed before any notation update finished.
    await player.drive(() => {
      engine.completeLoad();
    });
    expect(engine.loads.map((plan) => plan.revision)).toEqual([1, 2, 3]);
    expect(engine.getSnapshot().plan?.revision).toBe(3);
    expect(ui.playToggle()).toBeDisabled();

    await player.drive(() => {
      renderer.settleNext();
    });
    expect(shownRevision(player)).toBe(2);
    expect(ui.playToggle()).toBeDisabled();

    await player.drive(() => {
      renderer.settleNext();
    });
    expect(shownRevision(player)).toBe(3);
    expect(ui.playToggle()).toBeEnabled();
    await player.user.click(ui.playToggle());
    expect(engine.getSnapshot().state).toBe('playing');
    expect(engine.getSnapshot().plan?.revision).toBe(3);
  });
});
