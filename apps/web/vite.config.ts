import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';
import { PIANO_ASSET_PATH } from './src/player/assetPaths';

/** Repository directory of the piano SoundFont (#23, docs/assets/SOUNDFONT.md). */
const PIANO_DIRECTORY = new URL('../../assets/soundfonts/piano/', import.meta.url);

interface PianoManifest {
  readonly file: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly license: { readonly file: string; readonly notice: string };
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.sf3': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Publishes the piano SoundFont with its LICENSE.txt and NOTICE.txt (the
 * license requires them next to the .sf3) at `<base>assets/soundfonts/piano/`
 * of the web origin: served by the dev server, emitted unhashed by the build
 * after checking the .sf3 against the manifest's size and SHA-256. The pinned
 * SpessaSynth worklet processor needs no step here: its `?url` import in
 * playback-spessasynth makes the build emit it under `assets/`.
 */
function pianoSoundFont(): Plugin {
  const read = (file: string): Buffer =>
    readFileSync(fileURLToPath(new URL(file, PIANO_DIRECTORY)));
  const manifest = JSON.parse(read('manifest.json').toString('utf8')) as PianoManifest;
  const files = [manifest.file, manifest.license.file, manifest.license.notice];
  const contentType = (file: string) =>
    CONTENT_TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream';

  return {
    name: 'sheet-music:piano-soundfont',
    configureServer(server) {
      const prefix = `${server.config.base}${PIANO_ASSET_PATH}`;
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        const file = path.startsWith(prefix) ? path.slice(prefix.length) : null;
        if (file === null || !files.includes(file)) {
          next();
          return;
        }
        res.setHeader('Content-Type', contentType(file));
        res.setHeader('Cache-Control', 'no-cache');
        res.end(read(file));
      });
    },
    generateBundle() {
      const soundFont = read(manifest.file);
      const sha256 = createHash('sha256').update(soundFont).digest('hex');
      if (soundFont.byteLength !== manifest.sizeBytes || sha256 !== manifest.sha256) {
        this.error(
          `${manifest.file} does not match its manifest (${soundFont.byteLength} bytes, SHA-256 ${sha256}).`,
        );
      }
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: `${PIANO_ASSET_PATH}${file}`,
          source: read(file),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pianoSoundFont()],
});
