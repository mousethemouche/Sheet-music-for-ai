/**
 * MCP-P01 (#11): setup and discovery over real loopback HTTP with the pinned
 * SDK client. Checks the handshake, ping, the reviewed five-tool manifest
 * (names, schemas, descriptions, annotations, visibility, UI links) and that
 * resources/read serves the production-built View, the same for everyone.
 * Tool behavior is #12-#14; auth is #26.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_CONTRACTS, type ToolName } from '@sheet-music/music-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type BuiltView, buildView } from './support/built-view';
import { type RunningMcpServer, connectClient, startMcpServer } from './support/mcp-harness';

const VIEW_URI = 'ui://sheet-music/score-view';
const VIEW_MIME_TYPE = 'text/html;profile=mcp-app';
const ASSET_ORIGIN = 'https://assets.sheet-music.test';

/** Reviewed manifest: what each tool must declare and teach the model. */
interface ManifestEntry {
  readonly name: ToolName;
  readonly title: string;
  readonly showsScore: boolean;
  readonly annotations: Tool['annotations'];
  readonly teaches: readonly RegExp[];
}

const MANIFEST: readonly ManifestEntry[] = [
  {
    name: 'create_score',
    title: 'Create score',
    showsScore: true,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    teaches: [
      /PIANO/,
      /WITHOUT "id" and "revision"/,
      /about 8 bars/,
      /at most 32 bars/,
      /at most 4, each/,
      /up to 80 characters/,
      /fraction of a WHOLE note/,
      /groupId/,
      /ANNOTATION_COLOR_CONFLICT/,
      /NOT added to the user's library/,
    ],
  },
  {
    name: 'edit_score',
    title: 'Edit score',
    showsScore: true,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    teaches: [/ONE atomic edit/, /expectedRevision/, /REVISION_CONFLICT/, /by stable ID/, /1-64/],
  },
  {
    name: 'save_score',
    title: 'Save score to library',
    showsScore: false,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    teaches: [
      /ONLY when the user has explicitly asked/,
      /There is no confirmation flag/,
      /nothing you write in the arguments can stand for the user's consent/,
      /already_saved/,
    ],
  },
  {
    name: 'get_score',
    title: 'Get score',
    showsScore: true,
    annotations: { readOnlyHint: true, openWorldHint: false },
    teaches: [/canonical ScoreSpec v1 JSON/, /does not extend a draft's expiry/],
  },
  {
    name: 'search_scores',
    title: 'Search saved scores',
    showsScore: false,
    annotations: { readOnlyHint: true, openWorldHint: false },
    teaches: [/drafts are never listed/, /limit: 1-50/, /nextOffset/],
  },
];

let view: BuiltView;
let server: RunningMcpServer;
let client: Client;
let tools: Tool[];

beforeAll(async () => {
  view = await buildView();
  server = await startMcpServer({ viewHtml: view.html, assetOrigin: ASSET_ORIGIN });
  client = await connectClient(server.url);
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  await client?.close();
  await server?.close();
  await view?.dispose();
});

describe('MCP-P01 handshake', () => {
  it('completes initialize at the latest protocol version with tools and resources', () => {
    expect(client.getServerVersion()).toEqual({ name: 'sheet-music-for-ai', version: '0.0.0' });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {} });
    expect((client.transport as { protocolVersion?: string } | undefined)?.protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    );
  });

  it('answers ping with an empty result', async () => {
    await expect(client.ping()).resolves.toEqual({});
  });
});

describe('MCP-P01 tool manifest', () => {
  it('lists exactly the five product tools, in manifest order', () => {
    expect(tools.map((tool) => tool.name)).toEqual(MANIFEST.map((entry) => entry.name));
  });

  describe.each(MANIFEST)('$name', (entry) => {
    const tool = (): Tool => {
      const found = tools.find((candidate) => candidate.name === entry.name);
      if (found === undefined) {
        throw new Error(`${entry.name} is not listed`);
      }
      return found;
    };

    it('publishes the music-contracts input schema, closed', () => {
      expect(tool().inputSchema).toEqual(
        z.toJSONSchema(TOOL_CONTRACTS[entry.name].input, { io: 'input', target: 'draft-7' }),
      );
      expect(tool().inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    });

    it('publishes the music-contracts output schema', () => {
      expect(tool().outputSchema).toEqual(
        z.toJSONSchema(TOOL_CONTRACTS[entry.name].output, { io: 'output', target: 'draft-7' }),
      );
    });

    it('declares its title and behavior hints', () => {
      expect(tool().title).toBe(entry.title);
      expect(tool().annotations).toEqual(entry.annotations);
    });

    it('is visible to the model only, with the score View link when it shows a score', () => {
      const ui = entry.showsScore
        ? { resourceUri: VIEW_URI, visibility: ['model'] }
        : { visibility: ['model'] };
      expect(tool()._meta).toEqual(entry.showsScore ? { ui, 'ui/resourceUri': VIEW_URI } : { ui });
    });

    it('teaches the model the reviewed rules', () => {
      for (const rule of entry.teaches) {
        expect(tool().description).toMatch(rule);
      }
    });
  });
});

describe('MCP-P01 View resource', () => {
  const ui = {
    csp: { connectDomains: [ASSET_ORIGIN], resourceDomains: [ASSET_ORIGIN] },
    prefersBorder: true,
  };

  it('lists the score View as the only resource, with its CSP', async () => {
    const { resources } = await client.listResources();
    expect(resources).toEqual([
      {
        uri: VIEW_URI,
        name: 'Score view',
        mimeType: VIEW_MIME_TYPE,
        description: expect.any(String) as string,
        _meta: { ui },
      },
    ]);
  });

  it('reads the production-built single-file View, byte for byte', async () => {
    const { contents } = await client.readResource({ uri: VIEW_URI });
    expect(contents).toEqual([
      { uri: VIEW_URI, mimeType: VIEW_MIME_TYPE, text: view.html, _meta: { ui } },
    ]);
  });

  it('serves a self-contained document: every script and style is inline', () => {
    expect(view.html).toContain('<div id="root"></div>');
    expect(view.html).toMatch(/<script type="module"[^>]*>\S/);
    expect(view.html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(view.html).not.toMatch(/<link[^>]*rel="(stylesheet|modulepreload)"/);
  });
});
