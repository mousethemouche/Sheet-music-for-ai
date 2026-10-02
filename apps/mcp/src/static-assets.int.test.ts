/**
 * View assets route (#11, docs/architecture/MCP_VIEW.md §3) over real HTTP,
 * on the output of the production View build (vite.view.config.ts): the
 * worklet path the built View requests and the published SoundFont files are
 * served with the headers a sandboxed, cross-origin View needs (JavaScript
 * MIME type for the module, CORS for any origin, immutable caching), and
 * nothing outside the published files is reachable. Loading them in a real
 * sandboxed iframe under the resource CSP is MCP-UI-01.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import request from 'supertest';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createViewAssetsRouter } from './static-assets';

const VIEW_CONFIG = fileURLToPath(new URL('../vite.view.config.ts', import.meta.url));
const PIANO_MANIFEST = new URL('../../../assets/soundfonts/piano/manifest.json', import.meta.url);
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SANDBOX_ORIGIN = 'https://0123456789abcdef.sandbox.example';

interface PianoManifest {
  readonly file: string;
  readonly sizeBytes: number;
  readonly license: { readonly file: string; readonly notice: string };
}

let outDir: string;
let app: Express;
let workletPath: string;
let manifest: PianoManifest;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'sheet-music-view-assets-'));
  await build({
    configFile: VIEW_CONFIG,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  const html = await readFile(join(outDir, 'index.html'), 'utf8');
  const [path] = html.match(/\/assets\/spessasynth_processor\.min-[\w-]+\.js/) ?? [];
  if (path === undefined) {
    throw new Error('The built View does not reference its worklet processor.');
  }
  workletPath = path;
  manifest = JSON.parse(await readFile(PIANO_MANIFEST, 'utf8')) as PianoManifest;
  app = express().use(createViewAssetsRouter(join(outDir, 'assets')));
}, 60_000);

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe('View assets route: published files', () => {
  it('serves the worklet the built View requests as a cross-origin JavaScript module', async () => {
    const response = await request(app)
      .get(workletPath)
      .set('Origin', SANDBOX_ORIGIN)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'text/javascript; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': IMMUTABLE,
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    });
    expect(response.body).toEqual(await readFile(join(outDir, workletPath)));
  });

  it('serves the SoundFont at the size its manifest records', async () => {
    const response = await request(app)
      .get(`/assets/soundfonts/piano/${manifest.file}`)
      .set('Origin', SANDBOX_ORIGIN);
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-length': String(manifest.sizeBytes),
      'access-control-allow-origin': '*',
      'cache-control': IMMUTABLE,
    });
  });

  it.each(['license', 'notice'] as const)('publishes the SoundFont %s next to it', async (kind) => {
    const file = kind === 'license' ? manifest.license.file : manifest.license.notice;
    const response = await request(app).get(`/assets/soundfonts/piano/${file}`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(response.text).toContain('Frank Wen');
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await request(app).head(workletPath);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(response.text).toBeUndefined();
  });
});

describe('View assets route: nothing else', () => {
  it.each([
    { case: 'the View document outside the directory', path: '/assets/../index.html' },
    { case: 'an encoded traversal', path: '/assets/%2e%2e/index.html' },
    { case: 'the unpublished manifest', path: '/assets/soundfonts/piano/manifest.json' },
    { case: 'a missing file', path: '/assets/soundfonts/piano/missing.sf3' },
    { case: 'a directory (no index, no redirect)', path: '/assets/soundfonts' },
    { case: 'the directory root', path: '/assets/' },
  ])('answers its own 404 for $case', async ({ path }) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(404);
    expect(response.text).toBe('Not found');
    expect(response.headers['location']).toBeUndefined();
  });

  it('serves no method but GET and HEAD', async () => {
    const response = await request(app).post(workletPath).send('x');
    expect(response.status).toBe(404);
    expect(response.text).toBe('Not found');
  });

  it('refuses to start without a built assets directory', () => {
    expect(() => createViewAssetsRouter(join(outDir, 'missing'))).toThrow(/build the View/);
  });
});
