/**
 * DEPLOY-02 HTTP checks of the three deployed projects (issue #16,
 * docs/deploy/VERCEL.md "Post-deploy verification"): routing, status codes,
 * the auth challenge and RFC 9728 metadata, cache/CORS/CSP headers and the
 * public client bundle, with plain `fetch` and no dependency. DEPLOY-01 runs
 * the same checks against the local stand-in of each project
 * (local-vercel.ts), so they are exercised before any deployment.
 *
 *   node tools/deploy/verify-deployment.ts \
 *     --web https://<web host> --api https://<api host> \
 *     --mcp https://<mcp host>/mcp --supabase https://<project-ref>.supabase.co
 *
 * Without a flag, WEB_BASE_URL, API_BASE_URL, MCP_URL and SUPABASE_URL are
 * read from the environment (the names the release cloud suites use).
 *
 * Optional environment variables enable the authenticated checks; their
 * values are never printed:
 * - API_SESSION_TOKEN: a web session access token (one protected API read);
 * - MCP_ACCESS_TOKEN: an MCP OAuth access token (setup and View resource);
 * - VERCEL_AUTOMATION_BYPASS_SECRET: sent as `x-vercel-protection-bypass` so
 *   the checks pass Vercel's Deployment Protection of preview URLs.
 *
 * Exit code 0 when every check passes, 1 otherwise. Output lines name the
 * check and a short reason, never a response body or a token.
 *
 * No relative imports: Node runs this file as is (type stripping).
 */
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Loopback URLs that third-party code in the web bundle contains as
 * constants, not as configuration: react-router parses relative paths
 * against `http://localhost`, and supabase-js keeps its unused default
 * `http://localhost:9999` (the app always passes VITE_SUPABASE_URL).
 */
export const LIBRARY_LOOPBACK_URLS: ReadonlySet<string> = new Set([
  'http://localhost',
  'http://localhost:9999',
]);

const LOOPBACK_URL =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?[^\s"'`)<>\\]*/g;

/** Loopback URLs in a client file other than the known library constants. */
export function unexpectedLoopbackUrls(text: string): string[] {
  return [...new Set(text.match(LOOPBACK_URL) ?? [])].filter(
    (url) => !LIBRARY_LOOPBACK_URLS.has(url),
  );
}

/**
 * Server secrets that must never reach a client file: the service-role
 * name, a Supabase secret key (the bare `sb_secret_` prefix alone is how
 * supabase-js recognizes one and is not a key), JWTs (legacy anon and
 * service-role keys are JWTs; the app only takes the publishable key), the
 * service key variable names, private keys and Postgres connection URLs.
 */
const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'service_role', pattern: /service_role/ },
  { name: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: 'SUPABASE_SERVICE*', pattern: /SUPABASE_SERVICE/ },
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Postgres URL', pattern: /postgres(?:ql)?:\/\// },
];

/** Names of the secret patterns found in `text`, plus `canary` for any of the given values. */
export function secretFindings(text: string, values: readonly string[] = []): string[] {
  const found = SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
  if (values.some((value) => value !== '' && text.includes(value))) {
    found.push('canary');
  }
  return found;
}

/** The content-hashed SpessaSynth worklet path a bundle references (`/assets/...`). */
export function findWorkletPath(text: string): string | undefined {
  const match = /assets\/spessasynth_processor\.min-[A-Za-z0-9_-]+\.js/.exec(text);
  return match === null ? undefined : `/${match[0]}`;
}

/** CSP directives by name, each with its source list. */
export function parseCsp(header: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of header.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '') {
      directives.set(name.toLowerCase(), sources);
    }
  }
  return directives;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const PIANO = '/assets/soundfonts/piano';

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** Vercel's automation bypass of Deployment Protection (preview URLs), when configured. */
function bypassHeaders(): Record<string, string> {
  const secret = process.env['VERCEL_AUTOMATION_BYPASS_SECRET'];
  return secret === undefined || secret === '' ? {} : { 'x-vercel-protection-bypass': secret };
}

async function call(url: string, init: RequestInit = {}): Promise<Answer> {
  const headers = { ...bypassHeaders(), ...(init.headers as Record<string, string> | undefined) };
  const response = await fetch(url, { redirect: 'manual', ...init, headers });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

function jsonOf(answer: Answer): unknown {
  try {
    return JSON.parse(answer.text) as unknown;
  } catch {
    return undefined;
  }
}

function field(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

class Recorder {
  readonly results: CheckResult[] = [];

  check(name: string, ok: boolean, detail: string): void {
    this.results.push({ name, ok, detail: ok ? 'ok' : detail });
  }

  /** Header equality, with the actual value as the failure detail. */
  header(name: string, answer: Answer, header: string, expected: string): void {
    const actual = answer.headers.get(header);
    this.check(name, actual === expected, `${header}: ${actual ?? '(absent)'}`);
  }

  status(name: string, answer: Answer, expected: number): void {
    this.check(name, answer.status === expected, `status ${answer.status}`);
  }
}

export interface WebTarget {
  /** Base URL of the web deployment. */
  readonly web: string;
  /** The VITE_API_BASE_URL the web build must carry. */
  readonly apiBaseUrl: string;
  /** The VITE_SUPABASE_URL the web build must carry. */
  readonly supabaseUrl: string;
}

export interface WebVerification {
  readonly results: CheckResult[];
  /** The worklet path of the deployed bundle (the MCP View ships the same file). */
  readonly workletPath: string | undefined;
}

export async function verifyWeb(target: WebTarget): Promise<WebVerification> {
  const r = new Recorder();
  const base = target.web.replace(/\/+$/, '');
  const apiOrigin = new URL(target.apiBaseUrl).origin;
  const supabaseOrigin = new URL(target.supabaseUrl).origin;

  const index = await call(`${base}/`);
  r.status('web: / answers 200', index, 200);
  r.check(
    'web: / is HTML',
    index.headers.get('content-type')?.startsWith('text/html') === true,
    `content-type: ${index.headers.get('content-type') ?? '(absent)'}`,
  );
  const csp = parseCsp(index.headers.get('content-security-policy') ?? '');
  r.check(
    'web: CSP frame-ancestors none',
    csp.get('frame-ancestors')?.join(' ') === "'none'",
    `frame-ancestors: ${csp.get('frame-ancestors')?.join(' ') ?? '(absent)'}`,
  );
  const connect = csp.get('connect-src') ?? [];
  r.check(
    'web: CSP connect-src allows the API and Supabase',
    connect.includes(apiOrigin) && connect.includes(supabaseOrigin) && connect.includes("'self'"),
    `connect-src: ${connect.join(' ') || '(absent)'}`,
  );
  const script = csp.get('script-src') ?? [];
  r.check(
    'web: CSP script-src self + wasm only',
    script.includes("'self'") &&
      script.includes("'wasm-unsafe-eval'") &&
      !script.includes("'unsafe-inline'") &&
      !script.includes("'unsafe-eval'"),
    `script-src: ${script.join(' ') || '(absent)'}`,
  );
  r.check(
    'web: CSP font-src data:',
    csp.get('font-src')?.includes('data:') === true,
    `font-src: ${csp.get('font-src')?.join(' ') ?? '(absent)'}`,
  );
  r.header('web: nosniff', index, 'x-content-type-options', 'nosniff');
  r.header('web: X-Frame-Options DENY', index, 'x-frame-options', 'DENY');

  for (const path of ['/library', '/oauth/consent?authorization_id=deploy-check']) {
    const deep = await call(`${base}${path}`);
    r.check(
      `web: ${path.split('?')[0] ?? path} loads the SPA`,
      deep.status === 200 && deep.text === index.text,
      `status ${deep.status}`,
    );
  }

  const scriptPath = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(index.text)?.[1];
  r.check('web: index.html references its bundle', scriptPath !== undefined, 'no /assets script');
  let workletPath: string | undefined;
  if (scriptPath !== undefined) {
    const bundle = await call(`${base}${scriptPath}`);
    r.status('web: bundle answers 200', bundle, 200);
    r.header('web: bundle is immutable', bundle, 'cache-control', IMMUTABLE);
    r.check(
      'web: bundle carries the API and Supabase URLs',
      bundle.text.includes(target.apiBaseUrl) && bundle.text.includes(target.supabaseUrl),
      'configured URL missing from the bundle',
    );
    const loopback = unexpectedLoopbackUrls(bundle.text);
    r.check('web: bundle has no loopback URL', loopback.length === 0, loopback.join(', '));
    const secrets = secretFindings(bundle.text);
    r.check('web: bundle has no server secret', secrets.length === 0, secrets.join(', '));
    workletPath = findWorkletPath(bundle.text);
    r.check('web: bundle references the worklet', workletPath !== undefined, 'no worklet path');
  }
  if (workletPath !== undefined) {
    const worklet = await call(`${base}${workletPath}`, { method: 'HEAD' });
    r.status('web: worklet answers 200', worklet, 200);
    r.check(
      'web: worklet is JavaScript',
      /^(?:text|application)\/javascript/.test(worklet.headers.get('content-type') ?? ''),
      `content-type: ${worklet.headers.get('content-type') ?? '(absent)'}`,
    );
    r.header('web: worklet is immutable', worklet, 'cache-control', IMMUTABLE);
  }

  const soundFont = await call(`${base}${PIANO}/ms-basic-grand-piano.sf3`, { method: 'HEAD' });
  r.status('web: SoundFont answers 200', soundFont, 200);
  r.header('web: SoundFont is immutable', soundFont, 'cache-control', IMMUTABLE);
  r.header('web: SoundFont is octet-stream', soundFont, 'content-type', 'application/octet-stream');
  const license = await call(`${base}${PIANO}/LICENSE.txt`);
  r.status('web: SoundFont LICENSE.txt answers 200', license, 200);
  const missing = await call(`${base}/assets/deploy-check-missing.js`);
  r.status('web: a missing asset is 404, not the SPA', missing, 404);

  return { results: r.results, workletPath };
}

export interface ApiTarget {
  /** Base URL of the API deployment (the web's VITE_API_BASE_URL). */
  readonly api: string;
  /** The web origin listed in API_ALLOWED_ORIGINS. */
  readonly webOrigin: string;
  /** A web session access token: enables the protected read. */
  readonly sessionToken?: string | undefined;
}

export async function verifyApi(target: ApiTarget): Promise<CheckResult[]> {
  const r = new Recorder();
  const base = target.api.replace(/\/+$/, '');

  const health = await call(`${base}/health`);
  r.check(
    'api: /health is ok',
    health.status === 200 && field(jsonOf(health), 'status') === 'ok',
    `status ${health.status}`,
  );
  r.header('api: /health is no-store', health, 'cache-control', 'no-store');
  r.header('api: nosniff', health, 'x-content-type-options', 'nosniff');

  const version = await call(`${base}/version`);
  const body = jsonOf(version);
  r.check(
    'api: /version names the service',
    version.status === 200 &&
      field(body, 'service') === 'sheet-music-api' &&
      typeof field(body, 'version') === 'string',
    `status ${version.status}`,
  );

  const anonymous = await call(`${base}/scores`);
  r.status('api: /scores without a token is 401', anonymous, 401);
  r.check(
    'api: 401 carries a Bearer challenge',
    anonymous.headers.get('www-authenticate')?.startsWith('Bearer') === true,
    `www-authenticate: ${anonymous.headers.get('www-authenticate') ?? '(absent)'}`,
  );
  r.check(
    'api: 401 is not stored',
    anonymous.headers.get('cache-control')?.includes('no-store') === true,
    `cache-control: ${anonymous.headers.get('cache-control') ?? '(absent)'}`,
  );
  r.check(
    'api: answers carry a correlation ID',
    anonymous.headers.has('x-correlation-id'),
    'no x-correlation-id',
  );

  const allowed = await call(`${base}/health`, { headers: { Origin: target.webOrigin } });
  r.header(
    'api: the web origin is allowed',
    allowed,
    'access-control-allow-origin',
    target.webOrigin,
  );
  const foreign = await call(`${base}/health`, {
    headers: { Origin: 'https://deploy-check.invalid' },
  });
  r.status('api: a foreign origin is 403', foreign, 403);

  if (target.sessionToken !== undefined) {
    const read = await call(`${base}/scores`, {
      headers: { Authorization: `Bearer ${target.sessionToken}` },
    });
    r.check(
      'api: protected read answers 200',
      read.status === 200 && Array.isArray(field(jsonOf(read), 'items')),
      `status ${read.status}`,
    );
    r.header('api: protected read is private', read, 'cache-control', 'private, no-store');
    r.check(
      'api: protected read varies on Authorization',
      /(^|,\s*)authorization(\s*,|$)/i.test(read.headers.get('vary') ?? ''),
      `vary: ${read.headers.get('vary') ?? '(absent)'}`,
    );
  }
  return r.results;
}

export interface McpTarget {
  /** MCP_PUBLIC_URL: the public URL of the endpoint, path /mcp. */
  readonly mcp: string;
  /** An MCP OAuth access token: enables the setup and View resource checks. */
  readonly accessToken?: string | undefined;
  /** The worklet path to check on the asset origin (from the web bundle). */
  readonly workletPath?: string | undefined;
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function rpc(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

const INITIALIZE = rpc(1, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'sheet-music-deploy-check', version: '0.0.0' },
});

export async function verifyMcp(target: McpTarget): Promise<CheckResult[]> {
  const r = new Recorder();
  const endpoint = new URL(target.mcp);
  const origin = endpoint.origin;
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource${endpoint.pathname}`;

  const anonymous = await call(target.mcp, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: INITIALIZE,
  });
  r.status('mcp: POST /mcp without a token is 401', anonymous, 401);
  r.check(
    'mcp: 401 challenge points at the metadata',
    anonymous.headers.get('www-authenticate')?.includes(`resource_metadata="${metadataUrl}"`) ===
      true,
    `www-authenticate: ${anonymous.headers.get('www-authenticate') ?? '(absent)'}`,
  );

  const metadata = await call(metadataUrl);
  const document = jsonOf(metadata);
  const servers = field(document, 'authorization_servers');
  r.check(
    'mcp: RFC 9728 metadata names this resource',
    metadata.status === 200 && field(document, 'resource') === target.mcp,
    `status ${metadata.status}`,
  );
  r.check(
    'mcp: metadata lists the Supabase authorization server',
    Array.isArray(servers) &&
      servers.length > 0 &&
      servers.every((server) => typeof server === 'string' && server.endsWith('/auth/v1')),
    'authorization_servers missing or not <project>/auth/v1',
  );
  r.header('mcp: metadata is readable cross-origin', metadata, 'access-control-allow-origin', '*');

  const assets: [string, string, string][] = [
    ['SoundFont', `${PIANO}/ms-basic-grand-piano.sf3`, 'application/octet-stream'],
    ['SoundFont LICENSE.txt', `${PIANO}/LICENSE.txt`, 'text/plain; charset=utf-8'],
  ];
  if (target.workletPath !== undefined) {
    assets.push(['worklet', target.workletPath, 'text/javascript; charset=utf-8']);
  }
  for (const [label, path, type] of assets) {
    const asset = await call(`${origin}${path}`, { method: 'HEAD' });
    r.status(`mcp: ${label} answers 200`, asset, 200);
    r.header(`mcp: ${label} content type`, asset, 'content-type', type);
    r.header(`mcp: ${label} is immutable`, asset, 'cache-control', IMMUTABLE);
    r.header(`mcp: ${label} allows any origin`, asset, 'access-control-allow-origin', '*');
    r.header(
      `mcp: ${label} is cross-origin readable`,
      asset,
      'cross-origin-resource-policy',
      'cross-origin',
    );
    r.header(`mcp: ${label} nosniff`, asset, 'x-content-type-options', 'nosniff');
  }
  r.status(
    'mcp: a missing asset is 404',
    await call(`${origin}/assets/deploy-check-missing.js`),
    404,
  );
  r.status('mcp: no page at the root', await call(`${origin}/`), 404);

  if (target.accessToken !== undefined) {
    const headers = { ...MCP_HEADERS, authorization: `Bearer ${target.accessToken}` };
    const initialized = await call(target.mcp, { method: 'POST', headers, body: INITIALIZE });
    r.check(
      'mcp: initialize answers',
      initialized.status === 200 &&
        typeof field(jsonOf(initialized), 'result', 'protocolVersion') === 'string',
      `status ${initialized.status}`,
    );
    r.header(
      'mcp: authenticated answers are private',
      initialized,
      'cache-control',
      'private, no-store',
    );
    const read = await call(target.mcp, {
      method: 'POST',
      headers,
      body: rpc(2, 'resources/read', { uri: 'ui://sheet-music/score-view' }),
    });
    const content = field(jsonOf(read), 'result', 'contents', 0);
    const text = field(content, 'text');
    const connect = field(content, '_meta', 'ui', 'csp', 'connectDomains');
    r.check(
      'mcp: the View resource carries this asset origin',
      read.status === 200 &&
        typeof text === 'string' &&
        text.includes(`<meta name="sheet-music-asset-origin" content="${origin}" />`),
      `status ${read.status}`,
    );
    r.check(
      'mcp: the View CSP allows this asset origin',
      Array.isArray(connect) && connect.includes(origin),
      'connectDomains without the origin',
    );
  }
  return r.results;
}

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      web: { type: 'string' },
      api: { type: 'string' },
      mcp: { type: 'string' },
      supabase: { type: 'string' },
    },
    strict: true,
  });
  // Flags first, then the variables of the release cloud suites.
  const env = process.env;
  const web = values.web ?? env['WEB_BASE_URL'];
  const api = values.api ?? env['API_BASE_URL'];
  const mcp = values.mcp ?? env['MCP_URL'];
  const supabase = values.supabase ?? env['SUPABASE_URL'];
  if (web === undefined || api === undefined || mcp === undefined || supabase === undefined) {
    throw new Error(
      'usage: --web <url> --api <url> --mcp <MCP_PUBLIC_URL> --supabase <project url> (or WEB_BASE_URL, API_BASE_URL, MCP_URL, SUPABASE_URL)',
    );
  }
  const webResult = await verifyWeb({ web, apiBaseUrl: api, supabaseUrl: supabase });
  const results = [
    ...webResult.results,
    ...(await verifyApi({
      api,
      webOrigin: new URL(web).origin,
      sessionToken: process.env['API_SESSION_TOKEN'],
    })),
    ...(await verifyMcp({
      mcp,
      accessToken: process.env['MCP_ACCESS_TOKEN'],
      workletPath: webResult.workletPath,
    })),
  ];
  for (const result of results) {
    process.stdout.write(
      `${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.ok ? '' : `: ${result.detail}`}\n`,
    );
  }
  const failed = results.filter((result) => !result.ok).length;
  process.stdout.write(`${results.length - failed}/${results.length} checks passed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `verify-deployment: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
