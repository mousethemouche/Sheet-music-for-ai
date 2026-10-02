/**
 * The MCP Apps View resource: the production-built, single-file React View
 * (apps/mcp/dist/view/index.html) served as `ui://sheet-music/score-view`
 * (docs/architecture/MCP_VIEW.md). The same document is served to every
 * caller; it holds no user data, which reaches the View only through tool
 * results. The only deployment value it carries is the asset origin, written
 * into its placeholder meta tag so the View knows where to load the playback
 * assets from (the host renders it from its own sandbox origin).
 */
import type { McpUiResourceMeta } from '@modelcontextprotocol/ext-apps';
import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SCORE_VIEW_URI = 'ui://sheet-music/score-view';

/** The injection point of view/index.html; the View build fails without it. */
const ASSET_ORIGIN_PLACEHOLDER = '<meta name="sheet-music-asset-origin" content="" />';

export interface ViewResourceConfig {
  /** Content of the built single-file View. */
  readonly viewHtml: string;
  /**
   * Public origin that serves the View's playback assets at `/assets/`
   * (static-assets.ts): in production the MCP server's own origin
   * (`MCP_PUBLIC_URL`). It is written into the served document and is the
   * only origin the resource CSP allows for network and static resources;
   * absent means no network access at all (notation only, audio unavailable).
   */
  readonly assetOrigin?: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The CSP origin of a public asset base URL: https, or http on a loopback
 * host for local development. Throws on anything else (a startup error).
 */
export function assetOriginOf(baseUrl: string): string {
  const url = new URL(baseUrl);
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure) {
    throw new Error('The View asset base URL must be https (or http on a loopback host).');
  }
  return url.origin;
}

/**
 * The document served as the resource: the built View with the asset origin
 * written into its placeholder, or unchanged without one. Throws when an
 * origin is configured but the document has no placeholder (a foreign build).
 */
export function viewDocument(config: ViewResourceConfig): string {
  if (config.assetOrigin === undefined) {
    return config.viewHtml;
  }
  if (!config.viewHtml.includes(ASSET_ORIGIN_PLACEHOLDER)) {
    throw new Error('The View document has no asset-origin placeholder.');
  }
  // A URL origin holds no quote, angle bracket or ampersand: safe as an attribute value.
  const origin = assetOriginOf(config.assetOrigin);
  return config.viewHtml.replace(
    ASSET_ORIGIN_PLACEHOLDER,
    `<meta name="sheet-music-asset-origin" content="${origin}" />`,
  );
}

/**
 * The resource CSP under the key of ChatGPT's Apps SDK, a defensive addition:
 * ChatGPT documents MCP Apps' `_meta.ui.csp`, and whether it reads this key at
 * all is unverified (MCP_SERVER.md §6). The same origins are declared under both.
 * `redirect_domains`: pages of the asset origin the View opens with
 * `openLink` (the SoundFont license) open without ChatGPT's link warning.
 */
export interface OpenAiWidgetCsp {
  readonly connect_domains: readonly string[];
  readonly resource_domains: readonly string[];
  readonly redirect_domains: readonly string[];
}

/** The resource as served: the final document and its metadata, computed once. */
export interface ScoreViewResource {
  readonly document: string;
  readonly ui: McpUiResourceMeta;
  /** `_meta['openai/widgetCSP']`, next to `_meta.ui` (additive: other hosts ignore it). */
  readonly openaiWidgetCsp: OpenAiWidgetCsp;
}

function resourceMeta(config: ViewResourceConfig): Omit<ScoreViewResource, 'document'> {
  const origins = config.assetOrigin === undefined ? [] : [assetOriginOf(config.assetOrigin)];
  return {
    ui: {
      // connect-src: the SoundFont fetch. resourceDomains (script-src, font-src...):
      // the AudioWorklet module, which the browser loads under script-src.
      csp: { connectDomains: origins, resourceDomains: origins },
      prefersBorder: true,
    },
    openaiWidgetCsp: {
      connect_domains: origins,
      resource_domains: origins,
      redirect_domains: origins,
    },
  };
}

/**
 * Builds the served document and metadata once, at startup (the composition
 * root calls it before listening): a foreign or stale build without the
 * placeholder, or an unusable origin, stops the process there instead of
 * failing every `resources/read`, and the 1.7 MB document is not rewritten
 * per request.
 */
export function prepareScoreView(config: ViewResourceConfig): ScoreViewResource {
  return { document: viewDocument(config), ...resourceMeta(config) };
}

export function registerScoreView(server: McpServer, view: ScoreViewResource): void {
  const { document, ui, openaiWidgetCsp } = view;
  // On the listing and on the read content, as MCP Apps asks for `_meta.ui`.
  const meta = { ui, 'openai/widgetCSP': openaiWidgetCsp };
  registerAppResource(
    server,
    'Score view',
    SCORE_VIEW_URI,
    {
      description:
        'Interactive piano score (notation and playback) for the results of create_score, edit_score and get_score.',
      _meta: meta,
    },
    () => ({
      contents: [
        {
          uri: SCORE_VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: document,
          _meta: meta,
        },
      ],
    }),
  );
}
