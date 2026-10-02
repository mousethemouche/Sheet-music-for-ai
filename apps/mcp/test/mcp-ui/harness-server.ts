/// <reference types="@vitest/browser-playwright" />
/**
 * Node side of the MCP-UI harness (#11). The `mcp-ui` project's `mcpUi`
 * browser command (vitest.config.ts) loads this module on first use through
 * the project's Vite module runner and hands every request to
 * `handleMcpUiCommand`. The test body runs in Chromium and IS the host page;
 * this side does what a page cannot:
 *
 * - `start` / `stop` the servers below;
 * - `view-state` / `view-click`: read and click inside the View, a
 *   cross-origin frame that neither the host page nor Vitest's
 *   `expect.element` can reach (Playwright can);
 * - `records`: what the harness observed outside the page.
 *
 * One harness per test file:
 *
 * - the test database MCP_UI_DATABASE with users A and B (support/backend.ts);
 * - a local test issuer served over loopback (the only identity: every MCP
 *   request carries its token, checked by the production verifier);
 * - the PRODUCTION composition (`createMcpApp`: request protection, rate
 *   limits, bearer guard, tools, use cases, Postgres stores) wired exactly as
 *   main.ts wires it, with the production-built View
 *   (apps/mcp/dist/view/index.html) and the production assets router on its
 *   `assets/` directory. MCP_PUBLIC_URL is the real loopback URL, so the View
 *   resource declares this server's origin as its asset origin. The host
 *   page's origin is the one allowed browser origin (MCP_ALLOWED_ORIGINS);
 * - the sandbox proxy origin (sandbox-proxy.ts) on a second loopback port.
 *
 * Instrumentation stays outside production code: the assets router is
 * wrapped to record what it answered, the sandbox server records the CSP it
 * served, the server's warning and error log events are kept (level and
 * event name), and Playwright page events record uncaught errors. The View frame
 * is read and clicked through Playwright (view-probe.ts).
 */
import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { type ServedTestIssuer, startTestIssuer } from '@sheet-music/auth-jwt/testing';
import { TEST_USER_A } from '@sheet-music/persistence-postgres/testing';
import { createLogger } from '@sheet-music/server-common';
import type { RequestHandler } from 'express';
import type { ConsoleMessage, Frame, Page } from 'playwright';
import type { BrowserCommandContext } from 'vitest/node';
import { MCP_PATH } from '../../src/app';
import { createMcpApp } from '../../src/composition';
import { createViewAssetsRouter } from '../../src/static-assets';
import { type McpTestBackend, openMcpTestBackend } from '../support/backend';
import { GENEROUS_RATE_LIMITS } from '../support/mcp-harness';
import {
  type AssetRequest,
  type HarnessRecords,
  MCP_UI_DATABASE,
  type McpUiHarnessInfo,
  type McpUiRequest,
  VIEW_FRAME_NAME,
  type ViewClickTarget,
  type ViewSnapshot,
} from './protocol';
import { SANDBOX_PROXY_PATH, sandboxProxyHandler } from './sandbox-proxy';
import { ABSENT_VIEW, snapshotViewDocument } from './view-probe';

const BUILT_VIEW = new URL('../../dist/view/', import.meta.url);
/** Same default server as the `integration` project of vitest.config.ts. */
const DEFAULT_TEST_DATABASE_URL = 'postgres://user@localhost:5432/sheet_music_test';

interface Records {
  assetRequests: AssetRequest[];
  sandboxPolicies: string[];
  pageErrors: string[];
  consoleErrors: { text: string; url: string }[];
  serverLogs: { level: string; event: string }[];
}

interface Running {
  readonly backend: McpTestBackend;
  readonly issuer: ServedTestIssuer;
  readonly servers: readonly Server[];
  readonly detachPage: () => void;
  readonly records: Records;
}

let running: Running | undefined;

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.closeAllConnections();
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

/** The production-built View: fails with the fix when the build is missing. */
function readBuiltView(): { html: string; assetsDirectory: string } {
  try {
    return {
      html: readFileSync(new URL('index.html', BUILT_VIEW), 'utf8'),
      assetsDirectory: fileURLToPath(new URL('assets', BUILT_VIEW)),
    };
  } catch (error) {
    throw new Error(
      'The MCP-UI suite needs the production View build: run `pnpm --filter @sheet-music/mcp build`.',
      { cause: error },
    );
  }
}

/** The production assets router, recording what it answered. */
function recordingAssets(directory: string, records: Records): RequestHandler {
  const assets = createViewAssetsRouter(directory);
  return (req, res, next) => {
    // Read before the router runs: it strips its mount path from the request.
    const path = req.path;
    if (path.startsWith('/assets/')) {
      res.on('finish', () => {
        records.assetRequests.push({
          method: req.method,
          path,
          origin: req.get('origin') ?? null,
          status: res.statusCode,
        });
      });
    }
    assets(req, res, next);
  };
}

async function stop(): Promise<void> {
  const current = running;
  running = undefined;
  if (current === undefined) {
    return;
  }
  current.detachPage();
  await Promise.allSettled(current.servers.map(closeServer));
  await current.issuer.stop();
  await current.backend.close();
}

async function start(page: Page, options: { hostOrigin: string }): Promise<McpUiHarnessInfo> {
  await stop();
  const view = readBuiltView();
  const records: Records = {
    assetRequests: [],
    sandboxPolicies: [],
    pageErrors: [],
    consoleErrors: [],
    serverLogs: [],
  };
  // The server of the test database, defaulting like the integration project.
  process.env['TEST_DATABASE_URL'] ??= DEFAULT_TEST_DATABASE_URL;
  const backend = await openMcpTestBackend(MCP_UI_DATABASE);
  const issuer = await startTestIssuer().catch(async (error: unknown) => {
    await backend.close();
    throw error;
  });
  const mcpServer = createServer();
  const sandboxServer = createServer(
    sandboxProxyHandler({
      hostOrigin: options.hostOrigin,
      onServe: (policy) => records.sandboxPolicies.push(policy),
    }),
  );
  const onPageError = (error: Error): void => {
    records.pageErrors.push(`${error.name}: ${error.message}`);
  };
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === 'error') {
      records.consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  running = {
    backend,
    issuer,
    servers: [mcpServer, sandboxServer],
    detachPage: () => {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
    },
    records,
  };
  try {
    const origin = await listen(mcpServer);
    const composed = createMcpApp({
      config: {
        publicUrl: `${origin}${MCP_PATH}`,
        supabaseUrl: issuer.projectUrl,
        allowedOrigins: [options.hostOrigin],
        audienceMode: 'resource',
        trustProxyHops: 0,
      },
      stores: backend.persistence,
      viewHtml: view.html,
      assets: recordingAssets(view.assetsDirectory, records),
      // Warnings and errors, reduced to level and event name (nothing is printed).
      logger: createLogger({
        level: 'warn',
        production: true,
        write: (line) => {
          const { level, event } = JSON.parse(line) as { level: string; event: string };
          records.serverLogs.push({ level, event });
        },
      }),
      rateLimits: GENEROUS_RATE_LIMITS,
    });
    mcpServer.on('request', composed.app);
    const sandboxOrigin = await listen(sandboxServer);
    return {
      mcpUrl: composed.resource,
      assetOrigin: origin,
      sandboxUrl: `${sandboxOrigin}${SANDBOX_PROXY_PATH}`,
      token: await issuer.mcpToken(TEST_USER_A.id, composed.resource),
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

function viewFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame.name() === VIEW_FRAME_NAME && !frame.isDetached());
}

async function readViewState(page: Page): Promise<ViewSnapshot> {
  const frame = viewFrame(page);
  if (frame === undefined) {
    return ABSENT_VIEW;
  }
  try {
    return await frame.evaluate(snapshotViewDocument);
  } catch (error) {
    // Removed between the lookup and the evaluation: absent.
    if (frame.isDetached()) {
      return ABSENT_VIEW;
    }
    throw error;
  }
}

async function clickInView(page: Page, target: ViewClickTarget): Promise<void> {
  const frame = viewFrame(page);
  if (frame === undefined) {
    throw new Error('The View frame does not exist.');
  }
  const control =
    'text' in target
      ? frame.getByText(target.text, { exact: true })
      : frame.getByRole(target.role, { name: target.name, exact: true });
  await control.click({ timeout: 10_000 });
}

function records(): HarnessRecords {
  if (running === undefined) {
    throw new Error('The MCP-UI harness is not running.');
  }
  const { assetRequests, sandboxPolicies, pageErrors, consoleErrors, serverLogs } = running.records;
  return {
    assetRequests: [...assetRequests],
    sandboxPolicies: [...sandboxPolicies],
    pageErrors: [...pageErrors],
    consoleErrors: [...consoleErrors],
    serverLogs: [...serverLogs],
  };
}

/** Answers one `mcpUi` request of the host page (see McpUiCommand for the result types). */
export async function handleMcpUiCommand(
  context: BrowserCommandContext,
  request: McpUiRequest,
): Promise<unknown> {
  switch (request.action) {
    case 'start':
      return start(context.page, { hostOrigin: request.hostOrigin });
    case 'stop':
      return stop();
    case 'view-state':
      return readViewState(context.page);
    case 'view-click':
      return clickInView(context.page, request.target);
    case 'records':
      return records();
  }
}
