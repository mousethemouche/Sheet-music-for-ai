/**
 * The MCP Apps View resource: the production-built, single-file React View
 * (apps/mcp/dist/view/index.html) served as `ui://sheet-music/score-view`.
 * The same document is served to every caller; it holds no user data, which
 * reaches the View only through tool results.
 */
import type { McpUiResourceMeta } from '@modelcontextprotocol/ext-apps';
import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SCORE_VIEW_URI = 'ui://sheet-music/score-view';

export interface ViewResourceConfig {
  /** Content of the built single-file View. */
  readonly viewHtml: string;
  /**
   * Public origin of the static assets the View loads at runtime (SoundFont,
   * fonts). It is the only origin the resource CSP allows for network and
   * static resources; absent means no network access at all.
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

function resourceMeta(config: ViewResourceConfig): McpUiResourceMeta {
  const origins = config.assetOrigin === undefined ? [] : [config.assetOrigin];
  return {
    // fetch() of the SoundFont needs connect-src; fonts need font-src (resourceDomains).
    csp: { connectDomains: origins, resourceDomains: origins },
    prefersBorder: true,
  };
}

export function registerScoreView(server: McpServer, config: ViewResourceConfig): void {
  const ui = resourceMeta(config);
  registerAppResource(
    server,
    'Score view',
    SCORE_VIEW_URI,
    {
      description:
        'Interactive piano score (notation and playback) for the results of create_score, edit_score and get_score.',
      _meta: { ui },
    },
    () => ({
      contents: [
        { uri: SCORE_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: config.viewHtml, _meta: { ui } },
      ],
    }),
  );
}
