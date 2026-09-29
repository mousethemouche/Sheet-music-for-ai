/**
 * CI-04 (#17), exposed-surface half: what the production applications
 * actually expose equals the reviewed manifest tools/inventory/public-surface.json,
 * so a new tool, resource, prompt or route cannot ship without being listed
 * there with its tests (whose existence tools/inventory/ci-04-manifest.test.ts
 * checks). It says nothing about whether a listed entry is correct: that is
 * the referenced tests' job.
 *
 * - MCP entries: tools/list, resources/list, resources/templates/list and
 *   (when the capability is declared) prompts/list, over the wire with an
 *   authenticated client of the production composition.
 * - HTTP entries: the Express router of the MCP composition (built like
 *   main.ts, with the View assets router) and of the booted Nest API.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ExposedSurface,
  PUBLIC_SURFACE,
  type SurfaceGroup,
  expressEntries,
  mountProbes,
  surfaceProblems,
} from '../../tools/inventory/inventory';
import { type AcceptanceStack, type McpClient, startAcceptanceStack } from './support/stack';
import {
  F12_NOW,
  PLACEHOLDER_VIEW_HTML,
  SequentialScoreIds,
  TEST_USER_A,
  TestClock,
  createLogger,
  createMcpApp,
  createViewAssetsRouter,
} from './support/workspace';

let stack: AcceptanceStack;
let assetsDir: string;
let mcpHttpApp: ReturnType<typeof createMcpApp>['app'];
let exposed: ExposedSurface;

async function listAll<T>(
  list: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string | undefined }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await list(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return items;
}

async function mcpEntries(client: McpClient) {
  const params = (cursor: string | undefined) => (cursor === undefined ? {} : { cursor });
  const tools = await listAll(async (cursor) => {
    const page = await client.listTools(params(cursor));
    return { items: page.tools.map((tool) => tool.name), nextCursor: page.nextCursor };
  });
  const resources = await listAll(async (cursor) => {
    const page = await client.listResources(params(cursor));
    return { items: page.resources.map((resource) => resource.uri), nextCursor: page.nextCursor };
  });
  const resourceTemplates = await listAll(async (cursor) => {
    const page = await client.listResourceTemplates(params(cursor));
    return {
      items: page.resourceTemplates.map((template) => template.uriTemplate),
      nextCursor: page.nextCursor,
    };
  });
  const prompts =
    client.getServerCapabilities()?.prompts === undefined
      ? []
      : await listAll(async (cursor) => {
          const page = await client.listPrompts(params(cursor));
          return { items: page.prompts.map((prompt) => prompt.name), nextCursor: page.nextCursor };
        });
  return { tools, resources, resourceTemplates, prompts };
}

function problemsOf(...groups: SurfaceGroup[]): string[] {
  return surfaceProblems(PUBLIC_SURFACE, exposed).filter((problem) =>
    groups.some((group) => problem.startsWith(`${group} `)),
  );
}

beforeAll(async () => {
  stack = await startAcceptanceStack({
    clock: new TestClock(F12_NOW),
    ids: new SequentialScoreIds(),
  });
  const mcp = await mcpEntries(await stack.mcpClient(TEST_USER_A.id));

  // The MCP HTTP app as main.ts composes it, View assets router included.
  assetsDir = await mkdtemp(join(tmpdir(), 'sheet-music-inventory-assets-'));
  mcpHttpApp = createMcpApp({
    config: {
      publicUrl: stack.mcp.resource,
      supabaseUrl: stack.issuer.projectUrl,
      allowedOrigins: [],
      audienceMode: 'resource',
      trustProxyHops: 0,
    },
    stores: stack.backend.persistence,
    viewHtml: PLACEHOLDER_VIEW_HTML,
    assets: createViewAssetsRouter(assetsDir),
    logger: createLogger({ write: () => undefined }),
  }).app;

  exposed = {
    'mcp.tools': mcp.tools,
    'mcp.resources': mcp.resources,
    'mcp.resourceTemplates': mcp.resourceTemplates,
    'mcp.prompts': mcp.prompts,
    'mcp.http': expressEntries(mcpHttpApp, mountProbes(PUBLIC_SURFACE['mcp.http'])),
    'api.http': expressEntries(
      stack.api.app.getHttpAdapter().getInstance(),
      mountProbes(PUBLIC_SURFACE['api.http']),
    ),
  };
});

afterAll(async () => {
  await stack?.close();
  if (assetsDir !== undefined) {
    await rm(assetsDir, { recursive: true, force: true });
  }
});

describe('CI-04 the exposed public surface equals the reviewed manifest', () => {
  it('MCP tools, resources, resource templates and prompts listed over the wire', () => {
    expect(
      problemsOf('mcp.tools', 'mcp.resources', 'mcp.resourceTemplates', 'mcp.prompts'),
    ).toEqual([]);
    expect(exposed['mcp.tools']).toHaveLength(5);
  });

  it('MCP HTTP routes and mounted routers', () => {
    expect(problemsOf('mcp.http')).toEqual([]);
  });

  it('API routes of the Nest application', () => {
    expect(problemsOf('api.http')).toEqual([]);
  });

  it('a route added to the real Express app is reported as unlisted', () => {
    mcpHttpApp.get('/debug/state', (_req, res) => {
      res.end();
    });

    const entries = expressEntries(mcpHttpApp, mountProbes(PUBLIC_SURFACE['mcp.http']));

    expect(surfaceProblems(PUBLIC_SURFACE, { ...exposed, 'mcp.http': entries })).toEqual([
      'mcp.http "GET /debug/state": exposed but not in the manifest',
    ]);
  });
});
