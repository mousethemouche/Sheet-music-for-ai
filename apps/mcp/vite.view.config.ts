import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// MCP Apps View: the React app rendered by the host in a sandboxed iframe
// (docs/architecture/MCP_VIEW.md). The build writes:
// - dist/view/index.html: ONE self-contained document (every script and style
//   inlined by vite-plugin-singlefile) that the server exposes as a ui://
//   resource;
// - dist/view/assets/: the playback assets the View loads by URL, which the
//   MCP server serves at /assets/ on its public origin (src/static-assets.ts):
//   the pinned spessasynth worklet processor (content-hashed; an AudioWorklet
//   module must be loaded by URL) and the piano SoundFont with its license and
//   notice (unchanged names, docs/assets/SOUNDFONT.md §6).

const PIANO_SOURCE_DIRECTORY = new URL('../../assets/soundfonts/piano/', import.meta.url);
/** Must match PIANO_ASSET_PATH of view/src/player-ports.ts. */
const PIANO_PUBLIC_DIRECTORY = 'assets/soundfonts/piano';
/** Must match what src/view-resource.ts replaces. */
const ASSET_ORIGIN_PLACEHOLDER = '<meta name="sheet-music-asset-origin" content="" />';

const isWorkletProcessor = (file: string): boolean =>
  /[\\/]spessasynth_processor\.min\.js$/.test(file);

interface PianoManifest {
  readonly file: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly license: { readonly file: string; readonly notice: string };
}

/**
 * Copies the SoundFont, its LICENSE.txt and NOTICE.txt (named by the manifest)
 * into the assets, after checking the .sf3 against the manifest's size and
 * SHA-256 (as the web build does): the server publishes it with an immutable
 * cache lifetime, so a replaced or corrupted file must never ship.
 */
function publishPianoSoundFont(): Plugin {
  return {
    name: 'sheet-music:publish-piano-soundfont',
    apply: 'build',
    generateBundle() {
      const source = (file: string): URL => new URL(file, PIANO_SOURCE_DIRECTORY);
      const manifest = JSON.parse(readFileSync(source('manifest.json'), 'utf8')) as PianoManifest;
      const soundFont = readFileSync(source(manifest.file));
      const sha256 = createHash('sha256').update(soundFont).digest('hex');
      if (soundFont.byteLength !== manifest.sizeBytes || sha256 !== manifest.sha256) {
        this.error(
          `${manifest.file} does not match its manifest (${soundFont.byteLength} bytes, SHA-256 ${sha256}).`,
        );
      }
      for (const file of [manifest.file, manifest.license.file, manifest.license.notice]) {
        this.emitFile({
          type: 'asset',
          fileName: `${PIANO_PUBLIC_DIRECTORY}/${file}`,
          source: readFileSync(source(file)),
        });
      }
    },
  };
}

/** Fails the build when the server's injection point or the worklet file is missing. */
function checkViewBuild(): Plugin {
  return {
    name: 'sheet-music:check-view-build',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.values(bundle);
      const html = files.find((file) => file.fileName === 'index.html');
      const source = html?.type === 'asset' ? String(html.source) : '';
      if (source.split(ASSET_ORIGIN_PLACEHOLDER).length !== 2) {
        this.error(`index.html must contain ${ASSET_ORIGIN_PLACEHOLDER} exactly once.`);
      }
      const worklets = files.filter(
        (file) =>
          file.type === 'asset' &&
          /^assets\/spessasynth_processor\.min-.+\.js$/.test(file.fileName),
      );
      if (worklets.length !== 1) {
        this.error('The build must emit exactly one spessasynth worklet processor under assets/.');
      }
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./view', import.meta.url)),
  // Root-relative asset paths ("/assets/..."): the View resolves them against
  // the injected asset origin, not against its own (sandbox) document URL.
  base: '/',
  plugins: [
    react(),
    // Tailwind CSS v4 compiles view/src/view.css; singlefile inlines the result.
    tailwindcss(),
    viteSingleFile({ useRecommendedBuildConfig: false }),
    publishPianoSoundFont(),
    checkViewBuild(),
  ],
  build: {
    outDir: fileURLToPath(new URL('./dist/view', import.meta.url)),
    emptyOutDir: true,
    assetsDir: 'assets',
    // Inline everything into index.html except the worklet processor.
    assetsInlineLimit: (file) => !isWorkletProcessor(file),
    cssCodeSplit: false,
    // One document of about 2 MB is expected; the bundle size is reported in MCP_VIEW.md.
    chunkSizeWarningLimit: 4096,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
