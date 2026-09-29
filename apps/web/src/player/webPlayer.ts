/**
 * What the web app hands every ScorePlayer (#7): stable ports over the
 * injected renderer and engine factories, a way to silence audio when private
 * state is cleared (sign-out, account switch), and the sound credits the
 * SoundFont license requires. The real adapters are bound in
 * browserPlayer.ts; tests inject fakes through the same function.
 */
import {
  type PlaybackEngine,
  type PlaybackEngineFactory,
  activeNoteIds,
  compilePlaybackPlan,
} from '@sheet-music/playback-core';
import type { ScoreRendererFactory } from '@sheet-music/renderer-core';
import type { ScorePlayerPorts } from '@sheet-music/score-ui';

/** Credits of the piano sound (docs/assets/SOUNDFONT.md §2, obligations). */
export interface SoundCredits {
  /** The manifest's attribution text, shown unchanged. */
  readonly attribution: string;
  /** Absolute URLs of the published LICENSE.txt and NOTICE.txt. */
  readonly licenseUrl: string;
  readonly noticeUrl: string;
}

export interface WebPlayer {
  /** One object for the whole app, so a ScorePlayer never recreates its renderer or engine. */
  readonly ports: ScorePlayerPorts;
  /** Silences every live engine now (notes and pedal released). Synchronous and idempotent. */
  stopAudio(): void;
  readonly credits: SoundCredits;
}

export interface WebPlayerOptions {
  readonly createRenderer: ScoreRendererFactory;
  readonly createPlaybackEngine: PlaybackEngineFactory;
  readonly credits: SoundCredits;
}

export function createWebPlayer(options: WebPlayerOptions): WebPlayer {
  // Engines the players created and have not destroyed yet.
  const engines = new Set<PlaybackEngine>();
  const live = (): PlaybackEngine[] => {
    for (const engine of engines) {
      if (engine.getSnapshot().state === 'destroyed') engines.delete(engine);
    }
    return [...engines];
  };

  return {
    ports: {
      createRenderer: options.createRenderer,
      createPlaybackEngine: () => {
        live();
        const engine = options.createPlaybackEngine();
        engines.add(engine);
        return engine;
      },
      compilePlaybackPlan,
      activeNoteIds,
    },
    stopAudio() {
      // stop() is a no-op unless playing or paused, and cancels a pending play().
      for (const engine of live()) engine.stop();
    },
    credits: options.credits,
  };
}
