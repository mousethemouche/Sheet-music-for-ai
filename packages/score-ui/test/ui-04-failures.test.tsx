/**
 * UI-04 invalid input and failures (#7): an invalid payload (one
 * representative P-03 color conflict, proving validateScoreSpec is applied)
 * never replaces the usable score; a failed rendering or audio load stays
 * silent, is reported, never shows as playing, and recovers; notation stays
 * readable when audio fails. The P-03 rules themselves are #2's tests.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import { F09, F09_COLOR_CONFLICT } from '@sheet-music/test-fixtures';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { compileFakePlan } from './fakes/fake-plan';
import type { ScorePlayerArtifact } from '../src';
import { type MountOptions, PEDALLED, type Player, artifactOf, mountPlayer, ui } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const F09_TEXT = 'C major triad: root, third and fifth';

describe('UI-04 invalid payloads', () => {
  test.each([
    {
      name: 'a P-03 annotation color conflict',
      artifact: () => artifactOf(F09_COLOR_CONFLICT, { revision: 2 }),
    },
    {
      name: 'an envelope whose revision is not its score revision',
      artifact: (): ScorePlayerArtifact => ({ ...artifactOf(F09, { revision: 2 }), revision: 3 }),
    },
  ])('$name keeps the displayed score and its playback', async ({ artifact }) => {
    const player = await mountPlayer(artifactOf(F09));
    await player.user.click(ui.playToggle());
    await player.drive(() => {
      player.engine.advance(500);
    });
    const renderCalls = player.renderer.calls.length;

    await player.show(artifact());

    expect(ui.alert()).toHaveTextContent(
      'The latest score update is invalid and was not applied. Showing revision 1.',
    );
    expect(player.engine.getSnapshot().state).toBe('playing');
    expect(player.engine.position).toBe(500);
    expect(player.engine.loads.map((plan) => plan.revision)).toEqual([1]);
    expect(player.renderer.calls).toHaveLength(renderCalls);
    expect(ui.notation()).toHaveTextContent('f09 revision 1');
    expect(screen.getByText(F09_TEXT)).toBeVisible();
  });

  test('an invalid first payload shows nothing playable', async () => {
    const player = await mountPlayer(artifactOf(F09_COLOR_CONFLICT));

    expect(ui.alert()).toHaveTextContent('This score is invalid and cannot be shown.');
    expect(ui.status()).toHaveTextContent('No score to play');
    expect(ui.playToggle()).toBeDisabled();
    expect(player.renderer.calls).toEqual([]);
    expect(player.engine.loads).toEqual([]);
  });
});

interface FailureCase {
  readonly name: string;
  readonly input: ScoreSpecInput;
  readonly options?: MountOptions;
  readonly fail: (player: Player) => void | Promise<void>;
  readonly status: string;
  readonly alert: string;
  /** What the notation shows while failed (null: nothing drawn). */
  readonly notation: string | null;
  readonly recover: (player: Player) => Promise<void>;
  readonly recovered: string;
}

const revision2 = { ...structuredClone(PEDALLED), revision: 2 };

let compileCalls = 0;

const CASES: readonly FailureCase[] = [
  {
    name: 'the notation of a newer revision cannot be drawn',
    input: PEDALLED,
    fail: async (player) => {
      player.renderer.failWhen = (call) => call.score.revision === 2;
      await player.show(artifactOf(revision2));
    },
    status: 'Notation unavailable',
    alert: 'The notation could not be updated. Showing revision 1.',
    notation: 'ui-pedal revision 1',
    recover: async (player) => {
      player.renderer.failWhen = null;
      await player.resize(500);
    },
    recovered: 'ui-pedal revision 2',
  },
  {
    name: 'the first rendering fails',
    input: F09,
    options: {
      setupRenderer: (renderer) => {
        renderer.failWhen = () => true;
      },
    },
    fail: () => {},
    status: 'Notation unavailable',
    alert: 'The notation could not be drawn.',
    notation: null,
    recover: async (player) => {
      player.renderer.failWhen = null;
      await player.setTheme('dark');
    },
    recovered: 'f09 revision 1',
  },
  {
    name: 'the audio assets cannot be loaded',
    input: F09,
    options: {
      setupEngine: (engine) => {
        engine.loadFailure = 'ASSET_LOAD_FAILED';
      },
    },
    fail: () => {},
    status: 'Audio unavailable',
    alert: 'Audio is unavailable.',
    notation: 'f09 revision 1',
    recover: async (player) => {
      player.engine.loadFailure = null;
      await player.user.click(screen.getByRole('button', { name: 'Retry audio' }));
    },
    recovered: 'f09 revision 1',
  },
  {
    name: 'the playback plan cannot be compiled',
    input: F09,
    options: {
      compile: (score) => {
        compileCalls += 1;
        if (compileCalls === 1) {
          throw new Error('compiler bug');
        }
        return compileFakePlan(score);
      },
    },
    fail: () => {},
    status: 'Audio unavailable',
    alert: 'Audio is unavailable.',
    notation: 'f09 revision 1',
    recover: async (player) => {
      await player.user.click(screen.getByRole('button', { name: 'Retry audio' }));
    },
    recovered: 'f09 revision 1',
  },
  {
    name: 'the audio output breaks while playing',
    input: F09,
    fail: async (player) => {
      await player.user.click(ui.playToggle());
      await player.drive(() => {
        player.engine.advance(100);
      });
      await player.drive(() => {
        player.engine.breakAudio();
      });
    },
    status: 'Audio unavailable',
    alert: 'Audio is unavailable.',
    notation: 'f09 revision 1',
    recover: async (player) => {
      await player.user.click(screen.getByRole('button', { name: 'Retry audio' }));
    },
    recovered: 'f09 revision 1',
  },
];

describe('UI-04 failures stay silent and recover', () => {
  test.each(CASES)('$name', async (failure) => {
    compileCalls = 0;
    const player = await mountPlayer(artifactOf(failure.input), failure.options);

    await failure.fail(player);

    expect(player.engine.getSnapshot().state).not.toBe('playing');
    expect(player.renderer.highlight.size).toBe(0);
    expect(ui.playToggle()).toHaveAccessibleName('Play');
    expect(ui.playToggle()).toBeDisabled();
    expect(ui.status()).toHaveTextContent(failure.status);
    expect(ui.alert()).toHaveTextContent(failure.alert);
    if (failure.notation === null) {
      expect(ui.notation()).toBeEmptyDOMElement();
    } else {
      expect(ui.notation()).toHaveTextContent(failure.notation);
    }
    if (failure.input === F09 && failure.notation !== null) {
      expect(screen.getByText(F09_TEXT)).toBeVisible();
    }

    await failure.recover(player);

    expect(ui.notation()).toHaveTextContent(failure.recovered);
    expect(ui.status()).toHaveTextContent('Ready');
    expect(ui.alert()).toBeEmptyDOMElement();
    expect(ui.playToggle()).toBeEnabled();
    await player.user.click(ui.playToggle());
    expect(player.engine.getSnapshot().state).toBe('playing');
  });
});
