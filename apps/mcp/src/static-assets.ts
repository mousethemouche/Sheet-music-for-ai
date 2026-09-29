/**
 * Public playback assets of the MCP Apps View (docs/architecture/MCP_VIEW.md
 * §3): the directory `dist/view/assets/` written by the View build
 * (vite.view.config.ts), served at `/assets/` on the server's public origin,
 * which is the asset origin the View resource declares in its CSP.
 *
 * It holds only build output that is public and identical for everyone: the
 * pinned spessasynth worklet processor (content-hashed name) and the piano
 * SoundFont with its LICENSE.txt and NOTICE.txt (content fixed by SHA-256,
 * docs/assets/SOUNDFONT.md §6). Hence:
 * - `Cache-Control: public, max-age=31536000, immutable`;
 * - `Access-Control-Allow-Origin: *`: the View fetches from the host's
 *   sandbox origin (possibly opaque) in CORS mode (fetch, and the module
 *   script request of `audioWorklet.addModule`); no credentials are involved;
 * - `Cross-Origin-Resource-Policy: cross-origin` and `nosniff`;
 * - explicit content types (a module script needs a JavaScript MIME type);
 * - GET and HEAD only; no directory index, redirect or dotfile; any other
 *   path under `/assets/` is a plain 404.
 *
 * No Origin policy, authentication or body cap applies: the route reads no
 * body and serves no user data (the `/mcp` protections stay on `/mcp`).
 */
import { statSync } from 'node:fs';
import { extname } from 'node:path';
import express, { type Router } from 'express';

/** Mount path of the assets; the View build emits root-relative `/assets/...` URLs. */
const VIEW_ASSETS_PATH = '/assets';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.sf3': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Router serving `directory` (the built View's `assets/` directory, next to
 * its index.html) at `/assets/*`. Mount it on the MCP app at the root:
 * `app.use(createViewAssetsRouter(join(dirname(viewHtmlPath), 'assets')))`.
 * Throws when the directory does not exist (the View was not built).
 */
export function createViewAssetsRouter(directory: string): Router {
  if (statSync(directory, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`The View assets directory ${directory} does not exist; build the View.`);
  }
  const router = express.Router();
  router.use(VIEW_ASSETS_PATH, (req, res, next) => {
    if (CONTENT_TYPES[extname(req.path)] === undefined) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    next();
  });
  router.use(
    VIEW_ASSETS_PATH,
    express.static(directory, {
      index: false,
      redirect: false,
      dotfiles: 'ignore',
      maxAge: ONE_YEAR_MS,
      immutable: true,
      setHeaders: (res, path) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', CONTENT_TYPES[extname(path)] ?? 'application/octet-stream');
      },
    }),
  );
  router.use(VIEW_ASSETS_PATH, (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  return router;
}
