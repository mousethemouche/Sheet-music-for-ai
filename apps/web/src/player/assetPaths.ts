/**
 * Where the web app publishes the piano SoundFont directory (the .sf3 with its
 * LICENSE.txt and NOTICE.txt, docs/assets/SOUNDFONT.md §6), relative to the
 * app's base URL. vite.config.ts serves it there in development and emits it
 * there in the build; browserPlayer.ts resolves the engine's URLs from it.
 * No imports: the Vite config (Node) reads it too.
 */
export const PIANO_ASSET_PATH = 'assets/soundfonts/piano/';
