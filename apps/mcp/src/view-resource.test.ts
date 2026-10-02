/**
 * The document served as the View resource (#11, docs/architecture/MCP_VIEW.md
 * §2): the server writes its asset origin into the placeholder of the built
 * View, and nothing else, once at startup: a build without the placeholder
 * stops the composition instead of failing every read. The CSP of the asset
 * origin is declared under MCP Apps' `_meta.ui.csp` and under ChatGPT's
 * `openai/widgetCSP`. The resource read over the protocol is MCP-P01.
 */
import { createPostgresPersistence } from '@sheet-music/persistence-postgres';
import { createLogger } from '@sheet-music/server-common';
import { describe, expect, it } from 'vitest';
import { createMcpApp } from './composition';
import { prepareScoreView, viewDocument } from './view-resource';

const BUILT =
  '<head><meta charset="UTF-8" /><meta name="sheet-music-asset-origin" content="" /></head><body></body>';

describe('View resource document', () => {
  it('writes the asset origin into the placeholder', () => {
    expect(viewDocument({ viewHtml: BUILT, assetOrigin: 'https://mcp.example.com' })).toBe(
      '<head><meta charset="UTF-8" /><meta name="sheet-music-asset-origin" content="https://mcp.example.com" /></head><body></body>',
    );
  });

  it('writes only the origin of a URL with a path', () => {
    expect(
      viewDocument({ viewHtml: BUILT, assetOrigin: 'https://mcp.example.com:8443/mcp' }),
    ).toContain('content="https://mcp.example.com:8443"');
  });

  it('serves the build unchanged without an asset origin', () => {
    expect(viewDocument({ viewHtml: BUILT })).toBe(BUILT);
  });

  it('rejects a plain-http origin that is not a loopback host', () => {
    expect(() => viewDocument({ viewHtml: BUILT, assetOrigin: 'http://mcp.example.com' })).toThrow(
      /https/,
    );
  });

  it('rejects a document without the placeholder when an origin is configured', () => {
    expect(() =>
      viewDocument({ viewHtml: '<head></head>', assetOrigin: 'https://mcp.example.com' }),
    ).toThrow(/placeholder/);
  });
});

describe('View resource prepared at startup', () => {
  it('prepares the served document and the CSP of the asset origin once', () => {
    expect(prepareScoreView({ viewHtml: BUILT, assetOrigin: 'https://mcp.example.com' })).toEqual({
      document: viewDocument({ viewHtml: BUILT, assetOrigin: 'https://mcp.example.com' }),
      ui: {
        csp: {
          connectDomains: ['https://mcp.example.com'],
          resourceDomains: ['https://mcp.example.com'],
        },
        prefersBorder: true,
      },
      openaiWidgetCsp: {
        connect_domains: ['https://mcp.example.com'],
        resource_domains: ['https://mcp.example.com'],
        redirect_domains: ['https://mcp.example.com'],
      },
    });
  });

  it('declares no origin under either CSP key without an asset origin', () => {
    const { ui, openaiWidgetCsp } = prepareScoreView({ viewHtml: BUILT });

    expect(ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    expect(openaiWidgetCsp).toEqual({
      connect_domains: [],
      resource_domains: [],
      redirect_domains: [],
    });
  });

  it('fails the production composition, before any request, on a build without the placeholder', async () => {
    // The pool is lazy: nothing connects to this address.
    const persistence = createPostgresPersistence({
      connectionString: 'postgres://user@127.0.0.1:1/sheet_music_never_connected',
    });
    try {
      expect(() =>
        createMcpApp({
          config: {
            publicUrl: 'https://mcp.example.com/mcp',
            supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
            allowedOrigins: [],
            audienceMode: 'resource',
            trustProxyHops: 0,
          },
          stores: persistence,
          viewHtml: '<head></head><body>an older build</body>',
          logger: createLogger({ write: () => undefined }),
        }),
      ).toThrow(/placeholder/);
    } finally {
      await persistence.close();
    }
  });
});
