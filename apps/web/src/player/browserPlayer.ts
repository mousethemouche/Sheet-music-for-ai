/**
 * The real player adapters of the web app (RENDER_PLAYBACK_PORTS.md §4.6):
 * the VexFlow renderer (fonts embedded, nothing fetched) and the SpessaSynth
 * engine loading the piano SoundFont and the pinned worklet processor from
 * the app's own origin. Imported only by the composition root (main.tsx), so
 * component tests never load VexFlow or SpessaSynth.
 */
import {
  PIANO_SOUNDFONT,
  SPESSASYNTH_PROCESSOR_URL,
  createSpessaSynthEngine,
  resolvePianoAssetUrl,
} from '@sheet-music/playback-spessasynth';
import { createVexFlowRendererFactory } from '@sheet-music/renderer-vexflow';
import { PIANO_ASSET_PATH } from './assetPaths';
import { type WebPlayer, createWebPlayer } from './webPlayer';

export interface PageLocation {
  /** URL of the current page (`window.location.href`). */
  readonly href: string;
  /** The app's base path (`import.meta.env.BASE_URL`, "/" by default). */
  readonly basePath: string;
}

/** Call once per page load: the returned ports must stay the same object. */
export function createBrowserPlayer(page: PageLocation): WebPlayer {
  const assetBaseUrl = new URL(`${page.basePath}${PIANO_ASSET_PATH}`, page.href).href;
  const assets = {
    soundFont: { url: resolvePianoAssetUrl(assetBaseUrl) },
    // The Vite build emits the processor under /assets/ (hashed name); this is its URL.
    workletModuleUrl: new URL(SPESSASYNTH_PROCESSOR_URL, page.href).href,
  };
  return createWebPlayer({
    createRenderer: createVexFlowRendererFactory(),
    createPlaybackEngine: () => createSpessaSynthEngine(assets),
    credits: {
      attribution: PIANO_SOUNDFONT.attribution,
      licenseUrl: resolvePianoAssetUrl(assetBaseUrl, PIANO_SOUNDFONT.license.file),
      noticeUrl: resolvePianoAssetUrl(assetBaseUrl, PIANO_SOUNDFONT.license.notice),
    },
  });
}
