/**
 * One app's Vercel project as the deployment checks see it (issue #16,
 * docs/deploy/VERCEL.md): its apps/<app>/vercel.json, and a local stand-in
 * for how Vercel routes a request to that project.
 *
 * The stand-in follows the documented order: a GET/HEAD for a file of the
 * static output directory is served from it; otherwise the first matching
 * rewrite applies, either to a file of the output (the web SPA fallback) or
 * to the Vercel Function `/api/index`, which is the module `api/index.js`
 * imported and called as a Node request handler, the way Vercel's launcher
 * does. Every matching `headers` rule is added to the answer (a later rule
 * wins for the same header), static files get Vercel's default content types
 * and `Cache-Control: public, max-age=0, must-revalidate` unless a rule says
 * otherwise. It is an approximation for local checks, not an emulator: the
 * real routing, CDN and headers are checked on a preview deployment
 * (verify-deployment.ts, DEPLOY-02).
 *
 * Run directly, it serves one app on 127.0.0.1 and reports the port over IPC:
 *   node tools/deploy/local-vercel.ts apps/<app> [port]
 * A module import failure (a configuration refused at startup) exits with
 * code 1 after the app's own log lines. The request header
 * `x-local-vercel-route: function` skips the static output and the
 * vercel.json headers, so a check can compare what the CDN and the function
 * answer for the same path.
 *
 * No relative imports: Node runs this file as is (type stripping), and the
 * checks import it through Vitest.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
  createServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPS = ['web', 'api', 'mcp'] as const;
export type App = (typeof APPS)[number];

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The Vercel Function every rewrite of apps/api and apps/mcp targets. */
export const FUNCTION_ROUTE = '/api/index';
/** The file Vercel builds into that function. */
export const FUNCTION_ENTRY = 'api/index.js';
/** Request header of the local checks that forces the function route. */
export const FUNCTION_ROUTE_HEADER = 'x-local-vercel-route';

export interface HeaderRule {
  readonly source: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

export interface Rewrite {
  readonly source: string;
  readonly destination: string;
}

export interface FunctionSettings {
  readonly maxDuration?: number;
  readonly includeFiles?: string;
}

/** The subset of vercel.json this repository uses. */
export interface VercelConfig {
  readonly framework: string | null;
  readonly buildCommand: string;
  readonly outputDirectory: string;
  readonly rewrites?: readonly Rewrite[];
  readonly headers?: readonly HeaderRule[];
  readonly functions?: Readonly<Record<string, FunctionSettings>>;
}

export function appDirectory(app: App): string {
  return join(REPOSITORY_ROOT, 'apps', app);
}

export function readVercelConfig(directory: string): VercelConfig {
  return JSON.parse(readFileSync(join(directory, 'vercel.json'), 'utf8')) as VercelConfig;
}

/**
 * Whether a vercel.json `source` matches a path. The sources of this
 * repository are regular expressions in path-to-regexp groups (`/(.*)`,
 * `/((?!assets/).*)`, `/assets/(.*)\.js`), with no named parameter.
 */
export function sourceMatches(source: string, path: string): boolean {
  return new RegExp(`^${source}$`).test(path);
}

/** Headers the `headers` rules add to an answer for `path` (lowercase names). */
export function headersFor(config: VercelConfig, path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rule of config.headers ?? []) {
    if (sourceMatches(rule.source, path)) {
      for (const { key, value } of rule.headers) {
        result[key.toLowerCase()] = value;
      }
    }
  }
  return result;
}

/** Destination of the first rewrite matching `path`, if any. */
export function rewriteFor(config: VercelConfig, path: string): string | undefined {
  return config.rewrites?.find((rewrite) => sourceMatches(rewrite.source, path))?.destination;
}

/** Content types Vercel's CDN sends by extension (mime-db); unknown extensions are octet-stream. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** The static output file for a URL path, or undefined (no traversal out of the output). */
function staticFile(outputDirectory: string, path: string): string | undefined {
  const file = resolve(outputDirectory, `.${path}`);
  if (!file.startsWith(outputDirectory + sep)) {
    return undefined;
  }
  return existsSync(file) && statSync(file).isFile() ? file : undefined;
}

function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  headers: Record<string, string>,
): void {
  const body = readFileSync(file);
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-length': String(body.byteLength),
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** The function of an app (the default export of api/index.js), imported once. */
async function loadFunction(directory: string): Promise<RequestListener> {
  const module = (await import(pathToFileURL(join(directory, FUNCTION_ENTRY)).href)) as {
    default: RequestListener;
  };
  return module.default;
}

/** A request listener routing like the app's Vercel project (see the file comment). */
export async function createProjectListener(directory: string): Promise<RequestListener> {
  const config = readVercelConfig(directory);
  const outputDirectory = resolve(directory, config.outputDirectory);
  const usesFunction = config.rewrites?.some((rewrite) => rewrite.destination === FUNCTION_ROUTE);
  const handler = usesFunction === true ? await loadFunction(directory) : undefined;

  return (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    const headers = headersFor(config, path);
    const forceFunction = req.headers[FUNCTION_ROUTE_HEADER] === 'function';
    const file =
      (req.method === 'GET' || req.method === 'HEAD') && !forceFunction
        ? staticFile(outputDirectory, path)
        : undefined;
    if (file !== undefined) {
      sendFile(req, res, file, headers);
      return;
    }
    const destination = forceFunction ? FUNCTION_ROUTE : rewriteFor(config, path);
    if (destination === FUNCTION_ROUTE && handler !== undefined) {
      // A forced function route shows the function's own headers only.
      if (!forceFunction) {
        for (const [name, value] of Object.entries(headers)) {
          res.setHeader(name, value);
        }
      }
      handler(req, res);
      return;
    }
    const target = destination === undefined ? undefined : staticFile(outputDirectory, destination);
    if (target !== undefined && (req.method === 'GET' || req.method === 'HEAD')) {
      sendFile(req, res, target, headers);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  };
}

async function main(argv: readonly string[]): Promise<void> {
  const [directoryArgument, portArgument] = argv;
  if (directoryArgument === undefined) {
    throw new Error('usage: node tools/deploy/local-vercel.ts apps/<app> [port]');
  }
  const listener = await createProjectListener(resolve(directoryArgument));
  const server = createServer(listener);
  server.listen(Number(portArgument ?? 0), '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    if (process.send === undefined) {
      process.stderr.write(`listening on http://127.0.0.1:${port}\n`);
    } else {
      process.send({ port });
    }
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `local-vercel: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    // Let buffered log lines drain, and release the IPC channel so the process ends.
    process.exitCode = 1;
    process.disconnect?.();
  });
}
