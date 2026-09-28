/**
 * Builds the View with its production Vite config (vite.view.config.ts) into
 * a temporary directory, so the protocol tests serve the actual single-file
 * bundle of the current sources without depending on a previous build.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const VIEW_CONFIG = fileURLToPath(new URL('../../vite.view.config.ts', import.meta.url));

export interface BuiltView {
  readonly html: string;
  dispose(): Promise<void>;
}

export async function buildView(): Promise<BuiltView> {
  const outDir = await mkdtemp(join(tmpdir(), 'sheet-music-view-'));
  // Vitest sets NODE_ENV=test, which would make Vite bundle development
  // builds of React and friends; build exactly as `vite build` does.
  const nodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  try {
    await build({
      configFile: VIEW_CONFIG,
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    if (nodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = nodeEnv;
    }
  }
  return {
    html: await readFile(join(outDir, 'index.html'), 'utf8'),
    dispose: () => rm(outDir, { recursive: true, force: true }),
  };
}
