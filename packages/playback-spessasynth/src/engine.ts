/**
 * The SpessaSynth playback engine: the shared engine controller of
 * playback-core over the SpessaSynth driver, ticked by a timer.
 */
import {
  type PlaybackAssetConfig,
  type PlaybackEngine,
  type PlaybackTicker,
  createPlaybackController,
} from '@sheet-music/playback-core';
import { SpessaSynthDriver, type SpessaSynthDriverOptions } from './spessasynth-driver';

/**
 * Scheduling period. With the controller's 100 ms look-ahead, notes keep
 * sample-accurate timing through up to about 75 ms of main-thread delay.
 * Browsers do not throttle timers of a tab that is playing audio.
 */
const TICK_MILLISECONDS = 25;

const intervalTicker: PlaybackTicker = (onTick) => {
  const id = setInterval(onTick, TICK_MILLISECONDS);
  return () => clearInterval(id);
};

/**
 * Creates an engine in `idle` (a `CreatePlaybackEngine` of playback-core).
 * `assets.workletModuleUrl` must serve the `spessasynth_processor.min.js` of
 * the pinned spessasynth_lib (4.3.14): the processor and the library share a
 * private message protocol. Apps get that file as
 * `SPESSASYNTH_PROCESSOR_URL`. `options` are for tests; apps use the defaults.
 */
export function createSpessaSynthEngine(
  assets: PlaybackAssetConfig,
  options: SpessaSynthDriverOptions = {},
): PlaybackEngine {
  return createPlaybackController(new SpessaSynthDriver(assets, options), intervalTicker);
}
