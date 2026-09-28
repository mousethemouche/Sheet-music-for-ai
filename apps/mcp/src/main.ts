/**
 * Composition root of the MCP server process.
 *
 * Phase note: the Postgres stores (#9/#22), the auth middleware (#26) and the
 * rate limits (#24) are wired in the next phase. Until then no request is
 * authenticated: every tool call fails before touching storage (a use case
 * without principal is a server fault, reported as INTERNAL and logged), and
 * the stores below only reject. Discovery, the View resource and request
 * protection (correlation, Origin, body cap) work as in production.
 *
 * Environment: PORT (default 3001), MCP_VIEW_HTML_PATH (default: the built
 * View next to this bundle, dist/view/index.html), MCP_ASSET_BASE_URL
 * (optional public origin of SoundFont/fonts, declared in the View CSP),
 * MCP_ALLOWED_ORIGINS (optional comma-separated browser origins allowed to
 * call /mcp; default none).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@sheet-music/server-common';
import { MCP_PATH, createMcpHttpApp } from './app';
import { principalFromAuthInfo } from './principal';
import { mcpRequestProtection } from './protection';
import { createMcpServer } from './server';
import { type ScoreStores, createMcpUseCases } from './use-cases';
import { assetOriginOf } from './view-resource';

const DEFAULT_PORT = 3001;

function notConfigured(): Promise<never> {
  return Promise.reject(new Error('No score store is configured yet (#9/#22).'));
}

const STORES_NOT_CONFIGURED: ScoreStores = {
  drafts: {
    create: notConfigured,
    get: notConfigured,
    update: notConfigured,
    delete: notConfigured,
  },
  saved: { get: notConfigured, update: notConfigured, search: notConfigured },
  promotion: { promote: notConfigured },
};

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
const viewHtmlPath =
  process.env['MCP_VIEW_HTML_PATH'] === undefined
    ? fileURLToPath(new URL('../view/index.html', import.meta.url))
    : resolve(process.env['MCP_VIEW_HTML_PATH']);
const assetBaseUrl = process.env['MCP_ASSET_BASE_URL'];
const allowedOrigins = (process.env['MCP_ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');

const config = {
  viewHtml: readFileSync(viewHtmlPath, 'utf8'),
  ...(assetBaseUrl === undefined ? {} : { assetOrigin: assetOriginOf(assetBaseUrl) }),
};
const useCases = createMcpUseCases(STORES_NOT_CONFIGURED);
const logger = createLogger();

createMcpHttpApp({
  protection: mcpRequestProtection({ allowedOrigins }),
  createServer: () =>
    createMcpServer({
      useCases,
      resolvePrincipal: principalFromAuthInfo,
      logger,
      config,
    }),
}).listen(port, () => {
  console.log(`MCP server listening on http://localhost:${port}${MCP_PATH}`);
});
