/**
 * The concrete ScorePlayer ports of the View (ADR-004): the VexFlow renderer
 * with its embedded fonts (data: URLs, no network) and the SpessaSynth engine
 * bound to the playback assets the MCP server publishes on its own origin.
 *
 * Asset layout (built by vite.view.config.ts into dist/view/assets/, served
 * at `<asset origin>/assets/` by apps/mcp/src/static-assets.ts):
 * - the pinned spessasynth_lib worklet processor, content-hashed
 *   (`SPESSASYNTH_PROCESSOR_URL` is its root-relative path);
 * - the piano SoundFont with its LICENSE.txt and NOTICE.txt, unchanged names,
 *   under `/assets/soundfonts/piano/` (docs/assets/SOUNDFONT.md §6).
 */
import {
  type PlaybackEngine,
  type SynthDriver,
  PlaybackError,
  activeNoteIds,
  compilePlaybackPlan,
  createPlaybackController,
} from '@sheet-music/playback-core';
import {
  PIANO_SOUNDFONT,
  SPESSASYNTH_PROCESSOR_URL,
  createSpessaSynthEngine,
  resolvePianoAssetUrl,
} from '@sheet-music/playback-spessasynth';
import { createVexFlowRendererFactory } from '@sheet-music/renderer-vexflow';
import type { ScorePlayerPorts } from '@sheet-music/score-ui';

/** Public directory of the piano SoundFont; vite.view.config.ts publishes it there. */
export const PIANO_ASSET_PATH = '/assets/soundfonts/piano/';

export interface PlaybackAssetUrls {
  readonly soundFontUrl: string;
  readonly workletModuleUrl: string;
  /** The SoundFont's published license, linked from the sound credits. */
  readonly licenseUrl: string;
}

export function playbackAssetUrls(assetOrigin: string): PlaybackAssetUrls {
  const pianoDirectory = new URL(PIANO_ASSET_PATH, assetOrigin).href;
  return {
    soundFontUrl: resolvePianoAssetUrl(pianoDirectory),
    workletModuleUrl: new URL(SPESSASYNTH_PROCESSOR_URL, assetOrigin).href,
    licenseUrl: resolvePianoAssetUrl(pianoDirectory, PIANO_SOUNDFONT.license.file),
  };
}

/**
 * Without an asset origin there is nothing the View may fetch: every load
 * fails at once with ASSET_LOAD_FAILED (the player shows "Audio is
 * unavailable"), without a request and without an AudioContext.
 */
function createEngineWithoutAssets(): PlaybackEngine {
  const unavailable = (): Promise<never> =>
    Promise.reject(new PlaybackError('ASSET_LOAD_FAILED', 'No asset origin is configured.'));
  const driver: SynthDriver = {
    prepare: unavailable,
    resume: unavailable,
    currentTime: () => 0,
    noteOn: () => undefined,
    noteOff: () => undefined,
    sustain: () => undefined,
    silence: () => undefined,
    onFailure: () => undefined,
    dispose: () => undefined,
  };
  return createPlaybackController(driver, () => () => undefined);
}

/** Stable ports: create them once per document (a new factory remounts the player's media). */
export function createPlayerPorts(assets: PlaybackAssetUrls | null): ScorePlayerPorts {
  return {
    createRenderer: createVexFlowRendererFactory(),
    createPlaybackEngine:
      assets === null
        ? createEngineWithoutAssets
        : () =>
            createSpessaSynthEngine({
              soundFont: { url: assets.soundFontUrl },
              workletModuleUrl: assets.workletModuleUrl,
            }),
    compilePlaybackPlan,
    activeNoteIds,
  };
}
