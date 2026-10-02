/**
 * DEPLOY-01, configuration and build (issue #16, docs/deploy/VERCEL.md
 * "Local checks"). Run with `pnpm check:deploy` (needs the local test
 * Postgres of `pnpm test:integration`).
 *
 * 1. Each project is built with the exact `buildCommand` of its vercel.json
 *    (the #4 build commands, not a second build), with production values for
 *    the public VITE_* variables and canary server secrets in the build
 *    environment. The client output (web dist, MCP static output and View
 *    document, API static output) must hold no server secret and no canary,
 *    carry the configured URLs and no loopback URL, and every asset path it
 *    uses must resolve.
 * 2. Each serverless entry (api/index.js) is imported and served the way
 *    Vercel's launcher does, behind the local stand-in of its project's
 *    routing (local-vercel.ts), against a local test database and a local
 *    test issuer: a missing variable stops it before it serves, and the
 *    DEPLOY-02 HTTP checks (verify-deployment.ts) pass locally. With
 *    DATABASE_CA_CERT an entry talks to the database over verified TLS only,
 *    and an unset MCP_TRUST_PROXY_HOPS trusts the one Vercel edge.
 * 3. A CLI deployment uploads no local build output or environment file
 *    (.vercelignore: the Vercel CLI does not read .gitignore).
 *
 * Override the production values with the real ones before a deployment by
 * exporting VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and
 * VITE_API_BASE_URL: the CSP check then proves apps/web/vercel.json allows
 * exactly those origins.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ServedTestIssuer, startTestIssuer } from '../../packages/auth-jwt/testing/index';
import {
  TEST_DATABASE_CA_CERT,
  TEST_USER_A,
  type TestDatabase,
  createTestDatabase,
  seedTestUsers,
} from '../../packages/persistence-postgres/testing/index';
import {
  APPS,
  type App,
  FUNCTION_ENTRY,
  FUNCTION_ROUTE,
  FUNCTION_ROUTE_HEADER,
  REPOSITORY_ROOT,
  appDirectory,
  headersFor,
  readVercelConfig,
  rewriteFor,
} from './local-vercel';
import {
  type CheckResult,
  findWorkletPath,
  parseCsp,
  secretFindings,
  unexpectedLoopbackUrls,
  verifyApi,
  verifyMcp,
  verifyWeb,
} from './verify-deployment';

const LOCAL_VERCEL = fileURLToPath(new URL('./local-vercel.ts', import.meta.url));

/** Public build values: the planned production topology unless the real ones are exported. */
const WEB_ENV = {
  VITE_SUPABASE_URL: process.env['VITE_SUPABASE_URL'] ?? 'https://aebdzppogfvwbibcmpza.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY:
    process.env['VITE_SUPABASE_PUBLISHABLE_KEY'] ?? 'sb_publishable_deploy_check_placeholder',
  VITE_API_BASE_URL:
    process.env['VITE_API_BASE_URL'] ?? 'https://sheet-music-for-ai-api.vercel.app',
};

/** Server secrets present in every build environment: none may reach a client file. */
const CANARIES = {
  DATABASE_URL:
    'postgres://deploy_check:canary-db-password-7f3a@db.deploy-check.invalid:6543/postgres',
  SUPABASE_SERVICE_ROLE_KEY: 'canary-service-role-key-4b1e',
  SUPABASE_SECRET_KEY: 'sb_secret_canary0123456789abcdef',
  SUPABASE_JWT_SECRET: 'canary-jwt-secret-9c2d',
  MCP_ACCESS_TOKEN: 'canary-mcp-access-token-5e8a',
};
const CANARY_VALUES = [...Object.values(CANARIES), 'canary-db-password-7f3a'];

const IMMUTABLE = 'public, max-age=31536000, immutable';
const PIANO_ASSETS = 'assets/soundfonts/piano';
const ASSET_ORIGIN_PLACEHOLDER = '<meta name="sheet-music-asset-origin" content="" />';
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.txt', '.json', '.map', '.svg']);

interface PianoManifest {
  readonly file: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly license: { readonly file: string; readonly notice: string };
}

const MANIFEST = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, 'assets/soundfonts/piano/manifest.json'), 'utf8'),
) as PianoManifest;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function outputOf(app: App): string {
  return join(appDirectory(app), readVercelConfig(appDirectory(app)).outputDirectory);
}

const viewHtmlFile = (): string => join(appDirectory('mcp'), 'dist/view/index.html');

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function failures(results: readonly CheckResult[]): string[] {
  return results.filter((result) => !result.ok).map((result) => `${result.name}: ${result.detail}`);
}

function runBuild(app: App): Promise<void> {
  const { buildCommand } = readVercelConfig(appDirectory(app));
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', buildCommand], {
      cwd: appDirectory(app),
      // Vitest sets NODE_ENV=test, which would make Vite bundle development builds.
      env: { ...process.env, NODE_ENV: 'production', ...WEB_ENV, ...CANARIES },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${app}: "${buildCommand}" exited with ${code}\n${output.slice(-4000)}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Child processes: one project served by local-vercel.ts
// ---------------------------------------------------------------------------

interface Project {
  readonly origin: string;
  readonly child: ChildProcess;
  output(): string;
}

interface Exited {
  readonly code: number | null;
  readonly output: string;
}

type Environment = Readonly<Record<string, string>>;

function spawnProject(
  app: App,
  env: Environment,
  port = 0,
): { child: ChildProcess; output: () => string } {
  // Only the given variables: the entry must not see this process's environment.
  const child = spawn(process.execPath, [LOCAL_VERCEL, appDirectory(app), String(port)], {
    env: { NODE_ENV: 'production', ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output };
}

function startProject(app: App, env: Environment, port: number): Promise<Project> {
  const { child, output } = spawnProject(app, env, port);
  return new Promise((resolve, reject) => {
    child.once('message', () => resolve({ origin: `http://127.0.0.1:${port}`, child, output }));
    child.once('exit', (code) => reject(new Error(`${app} exited with ${code}:\n${output()}`)));
  });
}

function runUntilExit(app: App, env: Environment): Promise<Exited> {
  const { child, output } = spawnProject(app, env);
  return new Promise((resolve, reject) => {
    child.once('message', () => {
      child.kill();
      reject(new Error(`${app} started although its configuration is invalid`));
    });
    child.once('exit', (code) => resolve({ code, output: output() }));
  });
}

function stopProject(project: Project | undefined): Promise<void> {
  if (project === undefined || project.child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    project.child.once('exit', () => resolve());
    project.child.kill();
  });
}

function logEvents(output: string): Record<string, unknown>[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function problemsOf(output: string, event: string): unknown {
  return logEvents(output).find((line) => line['event'] === event)?.['problems'];
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// ---------------------------------------------------------------------------

describe('DEPLOY-01 build and client output', () => {
  beforeAll(async () => {
    for (const app of APPS) {
      await runBuild(app);
    }
  }, 300_000);

  it('DEPLOY-01 each project builds with its vercel.json command into its output and function', () => {
    const web = readVercelConfig(appDirectory('web'));
    expect(web.framework).toBe('vite');
    expect(web.functions).toBeUndefined();
    for (const app of ['api', 'mcp'] as const) {
      const directory = appDirectory(app);
      const config = readVercelConfig(directory);
      // "Other": no Express/NestJS zero-config entry detection, only api/index.js.
      expect(config.framework).toBeNull();
      expect(Object.keys(config.functions ?? {})).toEqual([FUNCTION_ENTRY]);
      const entry = readFileSync(join(directory, FUNCTION_ENTRY), 'utf8');
      const target = /from '(\.\.\/dist\/[^']+)'/.exec(entry)?.[1];
      expect(target).toBeDefined();
      expect(existsSync(join(directory, 'api', target ?? ''))).toBe(true);
    }
    expect(readVercelConfig(appDirectory('mcp')).functions?.[FUNCTION_ENTRY]?.includeFiles).toBe(
      'dist/view/**',
    );
    expect(existsSync(viewHtmlFile())).toBe(true);
    for (const app of APPS) {
      expect(filesUnder(outputOf(app)).length, app).toBeGreaterThan(0);
    }
    expect(filesUnder(outputOf('api')).map((file) => relative(outputOf('api'), file))).toEqual([
      'robots.txt',
    ]);
  });

  it('DEPLOY-01 no server secret or build-environment canary reaches a client file', () => {
    const clientFiles = [
      ...filesUnder(outputOf('web')),
      ...filesUnder(outputOf('mcp')),
      ...filesUnder(outputOf('api')),
      viewHtmlFile(),
    ].filter((file) => TEXT_EXTENSIONS.has(extname(file)));
    const findings = clientFiles.flatMap((file) =>
      secretFindings(readFileSync(file, 'utf8'), CANARY_VALUES).map(
        (name) => `${relative(REPOSITORY_ROOT, file)}: ${name}`,
      ),
    );
    expect(findings).toEqual([]);
    expect(clientFiles.length).toBeGreaterThanOrEqual(8);
  });

  it('DEPLOY-01 production client builds carry the configured URLs and no loopback URL', () => {
    const webFiles = filesUnder(outputOf('web')).filter((file) =>
      ['.js', '.html'].includes(extname(file)),
    );
    const webText = webFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(webText).toContain(WEB_ENV.VITE_API_BASE_URL);
    expect(webText).toContain(WEB_ENV.VITE_SUPABASE_URL);
    expect(webText).toContain(WEB_ENV.VITE_SUPABASE_PUBLISHABLE_KEY);
    const viewHtml = readFileSync(viewHtmlFile(), 'utf8');
    const loopback = [...webFiles, viewHtmlFile()].flatMap((file) =>
      unexpectedLoopbackUrls(readFileSync(file, 'utf8')).map(
        (url) => `${relative(REPOSITORY_ROOT, file)}: ${url}`,
      ),
    );
    expect(loopback).toEqual([]);
    // The asset origin is written at startup from MCP_PUBLIC_URL, never at build time.
    expect(viewHtml.split(ASSET_ORIGIN_PLACEHOLDER)).toHaveLength(2);
  });

  it('DEPLOY-01 the web CSP allows the configured API and Supabase origins only', () => {
    const csp = parseCsp(
      headersFor(readVercelConfig(appDirectory('web')), '/')['content-security-policy'] ?? '',
    );
    const connect = csp.get('connect-src') ?? [];
    expect(connect).toEqual(
      expect.arrayContaining([
        "'self'",
        new URL(WEB_ENV.VITE_API_BASE_URL).origin,
        new URL(WEB_ENV.VITE_SUPABASE_URL).origin,
      ]),
    );
    expect(connect.every((source) => source === "'self'" || /^https:\/\/[^*]+$/.test(source))).toBe(
      true,
    );
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp.get('font-src')).toContain('data:');
    expect(csp.get('object-src')).toEqual(["'none'"]);
  });

  it('DEPLOY-01 asset paths resolve and route as declared', () => {
    const web = readVercelConfig(appDirectory('web'));
    const webOutput = outputOf('web');
    const indexHtml = readFileSync(join(webOutput, 'index.html'), 'utf8');
    const referenced = [...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const path of referenced) {
      expect(existsSync(join(webOutput, path)), path).toBe(true);
      expect(headersFor(web, path)['cache-control'], path).toBe(IMMUTABLE);
    }
    const bundle = readFileSync(join(webOutput, referenced[0] ?? ''), 'utf8');
    const webWorklet = findWorkletPath(bundle);
    expect(webWorklet).toBeDefined();
    expect(existsSync(join(webOutput, webWorklet ?? ''))).toBe(true);
    for (const output of [webOutput, outputOf('mcp')]) {
      const soundFont = join(output, PIANO_ASSETS, MANIFEST.file);
      expect(statSync(soundFont).size).toBe(MANIFEST.sizeBytes);
      expect(sha256(soundFont)).toBe(MANIFEST.sha256);
      expect(existsSync(join(output, PIANO_ASSETS, MANIFEST.license.file))).toBe(true);
      expect(existsSync(join(output, PIANO_ASSETS, MANIFEST.license.notice))).toBe(true);
    }
    const sf3Path = `/${PIANO_ASSETS}/${MANIFEST.file}`;
    expect(headersFor(web, sf3Path)).toMatchObject({
      'cache-control': IMMUTABLE,
      'content-type': 'application/octet-stream',
    });
    // SPA deep links load index.html; /assets never falls back to it.
    for (const path of ['/', '/library', '/scores/scr_1', '/oauth/consent', '/reset-password']) {
      expect(rewriteFor(web, path), path).toBe('/index.html');
    }
    expect(rewriteFor(web, '/assets/missing.js')).toBeUndefined();

    // MCP: the static output is exactly the View's assets directory.
    const viewAssets = join(appDirectory('mcp'), 'dist/view/assets');
    const staticAssets = join(outputOf('mcp'), 'assets');
    const list = (directory: string): string[] =>
      filesUnder(directory)
        .map((file) => relative(directory, file))
        .sort();
    expect(list(staticAssets)).toEqual(list(viewAssets));
    for (const file of list(viewAssets)) {
      expect(sha256(join(staticAssets, file)), file).toBe(sha256(join(viewAssets, file)));
    }
    const viewWorklet = findWorkletPath(readFileSync(viewHtmlFile(), 'utf8'));
    expect(viewWorklet).toBeDefined();
    expect(existsSync(join(outputOf('mcp'), viewWorklet ?? ''))).toBe(true);
    const mcp = readVercelConfig(appDirectory('mcp'));
    for (const path of [
      '/mcp',
      '/.well-known/oauth-protected-resource/mcp',
      '/assets/missing.js',
    ]) {
      expect(rewriteFor(mcp, path), path).toBe(FUNCTION_ROUTE);
    }
    expect(rewriteFor(readVercelConfig(appDirectory('api')), '/health')).toBe(FUNCTION_ROUTE);
  });
});

describe('DEPLOY-01 serverless entries', () => {
  const SECRET = 'deploy-check-db-password-31c9';

  it('DEPLOY-01 a missing or invalid server variable stops each entry before it serves', async () => {
    const api = await runUntilExit('api', {
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      DATABASE_URL: `mysql://login:${SECRET}@db.deploy-check.invalid/postgres`,
    });
    expect(api.code).toBe(1);
    expect(problemsOf(api.output, 'api.config_invalid')).toEqual([
      'DATABASE_URL must be a postgres:// or postgresql:// connection URL.',
    ]);
    const apiMissing = await runUntilExit('api', {});
    expect(apiMissing.code).toBe(1);
    expect(problemsOf(apiMissing.output, 'api.config_invalid')).toEqual([
      'SUPABASE_URL is required.',
      'DATABASE_URL is required.',
    ]);

    const mcp = await runUntilExit('mcp', {
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      DATABASE_URL: `mysql://login:${SECRET}@db.deploy-check.invalid/postgres`,
    });
    expect(mcp.code).toBe(1);
    expect(problemsOf(mcp.output, 'config.invalid')).toEqual([
      'MCP_PUBLIC_URL is required.',
      'DATABASE_URL must be a postgres:// or postgresql:// URL.',
    ]);
    // A remote database needs the CA (verified TLS) and a URL without TLS parameters.
    const remote = `postgres://login:${SECRET}@db.deploy-check.invalid:6543/postgres?sslmode=no-verify`;
    const tlsProblems = [
      'DATABASE_URL must not carry TLS parameters (sslmode, sslrootcert, ...): TLS is set by DATABASE_CA_CERT, which URL parameters would override.',
      'DATABASE_CA_CERT is required for a database outside the loopback host: the PEM certificate of the database CA, for verified TLS.',
    ];
    const apiTls = await runUntilExit('api', {
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      DATABASE_URL: remote,
    });
    expect(apiTls.code).toBe(1);
    expect(problemsOf(apiTls.output, 'api.config_invalid')).toEqual(tlsProblems);
    const mcpTls = await runUntilExit('mcp', {
      MCP_PUBLIC_URL: 'https://sheet-music-for-ai-mcp.vercel.app/mcp',
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      DATABASE_URL: remote,
    });
    expect(mcpTls.code).toBe(1);
    expect(problemsOf(mcpTls.output, 'config.invalid')).toEqual(tlsProblems);

    for (const { output } of [api, apiMissing, mcp, apiTls, mcpTls]) {
      expect(output).not.toContain(SECRET);
    }
  });

  describe('DEPLOY-01 entries served like their Vercel projects', () => {
    let db: TestDatabase | undefined;
    let issuer: ServedTestIssuer | undefined;
    let web: Project | undefined;
    let api: Project | undefined;
    let mcp: Project | undefined;
    let mcpUrl = '';

    beforeAll(async () => {
      db = await createTestDatabase('sheet_music_test_deploy');
      await seedTestUsers(db.admin);
      issuer = await startTestIssuer();
      const [webPort, apiPort, mcpPort] = [await freePort(), await freePort(), await freePort()];
      mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`;
      web = await startProject('web', {}, webPort);
      api = await startProject(
        'api',
        { SUPABASE_URL: issuer.projectUrl, DATABASE_URL: db.url, API_ALLOWED_ORIGINS: web.origin },
        apiPort,
      );
      mcp = await startProject(
        'mcp',
        // No MCP_TRUST_PROXY_HOPS: the adapter trusts the one Vercel edge by default.
        { MCP_PUBLIC_URL: mcpUrl, SUPABASE_URL: issuer.projectUrl, DATABASE_URL: db.url },
        mcpPort,
      );
    }, 60_000);

    afterAll(async () => {
      await Promise.all([stopProject(web), stopProject(api), stopProject(mcp)]);
      await issuer?.stop();
      await db?.close();
    });

    const started = (project: Project | undefined): Project => {
      if (project === undefined) {
        throw new Error('project not started');
      }
      return project;
    };

    it('DEPLOY-01 web: CSP, SPA deep links, immutable assets, 404 for a missing asset', async () => {
      const { results } = await verifyWeb({
        web: started(web).origin,
        apiBaseUrl: WEB_ENV.VITE_API_BASE_URL,
        supabaseUrl: WEB_ENV.VITE_SUPABASE_URL,
      });
      expect(failures(results)).toEqual([]);
    });

    it('DEPLOY-01 api: health, version, 401, CORS and one protected read', async () => {
      const results = await verifyApi({
        api: started(api).origin,
        webOrigin: started(web).origin,
        sessionToken: await issuer?.sessionToken(TEST_USER_A.id),
      });
      expect(failures(results)).toEqual([]);
      // The session token was given: the authenticated read ran.
      expect(results.map((result) => result.name)).toContain('api: protected read is private');
    });

    it('DEPLOY-01 mcp: challenge, RFC 9728 metadata, /assets headers, setup and View resource', async () => {
      const results = await verifyMcp({
        mcp: mcpUrl,
        accessToken: await issuer?.mcpToken(TEST_USER_A.id, mcpUrl),
        workletPath: findWorkletPath(readFileSync(viewHtmlFile(), 'utf8')),
      });
      expect(failures(results)).toEqual([]);
      // The access token and the worklet path were given: those checks ran.
      expect(results.map((result) => result.name)).toEqual(
        expect.arrayContaining([
          'mcp: the View resource carries this asset origin',
          'mcp: worklet content type',
        ]),
      );
    });

    it('DEPLOY-01 mcp: the static /assets copy answers like the function it stands in for', async () => {
      const worklet = findWorkletPath(readFileSync(viewHtmlFile(), 'utf8')) ?? '';
      const paths = [
        worklet,
        `/${PIANO_ASSETS}/${MANIFEST.file}`,
        `/${PIANO_ASSETS}/${MANIFEST.license.file}`,
        `/${PIANO_ASSETS}/${MANIFEST.license.notice}`,
      ];
      for (const path of paths) {
        const cdn = await fetch(`${started(mcp).origin}${path}`);
        const fn = await fetch(`${started(mcp).origin}${path}`, {
          headers: { [FUNCTION_ROUTE_HEADER]: 'function' },
        });
        expect([cdn.status, fn.status], path).toEqual([200, 200]);
        for (const header of [
          'content-type',
          'cache-control',
          'access-control-allow-origin',
          'cross-origin-resource-policy',
          'x-content-type-options',
        ]) {
          expect(cdn.headers.get(header), `${path} ${header}`).toBe(fn.headers.get(header));
        }
        expect(
          Buffer.from(await cdn.arrayBuffer()).equals(Buffer.from(await fn.arrayBuffer())),
        ).toBe(true);
      }
    });

    it('DEPLOY-01 api and mcp: the per-IP limit counts the X-Forwarded-For client (mcp by default)', async () => {
      const apiAnswer = await fetch(`${started(api).origin}/scores`, {
        headers: { 'x-forwarded-for': '203.0.113.7' },
      });
      const mcpAnswer = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-forwarded-for': '203.0.113.8',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect([apiAnswer.status, mcpAnswer.status]).toEqual([401, 401]);
      const { rows } = await (db as TestDatabase).admin.query<{ key: string }>(
        `select key from private.rate_limit_windows where key like '%:203.0.113.%' order by key`,
      );
      expect(rows.map((row) => row.key)).toEqual(['api-ip:203.0.113.7', 'mcp-ip:203.0.113.8']);
    });

    it('DEPLOY-01 api and mcp: with DATABASE_CA_CERT the database is reached over verified TLS only', async () => {
      // Same database as above, which offers no TLS: every store call must fail
      // (fail closed, 503) instead of falling back to plaintext.
      const [apiPort, mcpPort] = [await freePort(), await freePort()];
      const tlsMcpUrl = `http://127.0.0.1:${mcpPort}/mcp`;
      let tlsApi: Project | undefined;
      let tlsMcp: Project | undefined;
      try {
        tlsApi = await startProject(
          'api',
          {
            SUPABASE_URL: (issuer as ServedTestIssuer).projectUrl,
            DATABASE_URL: (db as TestDatabase).url,
            DATABASE_CA_CERT: TEST_DATABASE_CA_CERT,
          },
          apiPort,
        );
        tlsMcp = await startProject(
          'mcp',
          {
            MCP_PUBLIC_URL: tlsMcpUrl,
            SUPABASE_URL: (issuer as ServedTestIssuer).projectUrl,
            DATABASE_URL: (db as TestDatabase).url,
            DATABASE_CA_CERT: TEST_DATABASE_CA_CERT,
          },
          mcpPort,
        );

        expect((await fetch(`${tlsApi.origin}/health`)).status).toBe(200);
        expect((await fetch(`${tlsApi.origin}/scores`)).status).toBe(503);
        const mcpAnswer = await fetch(tlsMcpUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        });
        expect(mcpAnswer.status).toBe(503);
        for (const project of [tlsApi, tlsMcp]) {
          const failed = logEvents(project.output()).filter(
            (line) => line['event'] === 'rate_limit.store_failed',
          );
          expect(failed).toHaveLength(1);
          expect(JSON.stringify(failed[0])).toMatch(/SSL|certificate/i);
        }
      } finally {
        await Promise.all([stopProject(tlsApi), stopProject(tlsMcp)]);
      }
    });
  });
});

describe('DEPLOY-01 CLI uploads', () => {
  it('DEPLOY-01 .vercelignore keeps local build output and environment files out of a CLI deployment', () => {
    // The Vercel CLI reads .vercelignore in the directory it deploys (the
    // repository root, docs/deploy/VERCEL.md §6) and ignores .gitignore.
    const rules = readFileSync(join(REPOSITORY_ROOT, '.vercelignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(rules).toEqual(
      expect.arrayContaining([
        '.env',
        '.env.*',
        '!.env.example',
        'dist/',
        'coverage/',
        '.vitest/',
        'test-results/',
        '__screenshots__/',
      ]),
    );
  });
});
