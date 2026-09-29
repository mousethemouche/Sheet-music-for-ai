/**
 * The origin the View loads its playback assets from. The MCP server writes
 * it into the document it serves as the `ui://` resource, in the placeholder
 * `<meta name="sheet-music-asset-origin" content="">` of index.html
 * (apps/mcp/src/view-resource.ts), and declares the same origin in the
 * resource CSP. The built bundle cannot know it: one build serves every
 * deployment, and the host renders the View from its own sandbox origin.
 */
export const ASSET_ORIGIN_META_NAME = 'sheet-music-asset-origin';

/** The injected http(s) origin, or null when the server configured none. */
export function readAssetOrigin(doc: Document): string | null {
  const content =
    doc.querySelector(`meta[name="${ASSET_ORIGIN_META_NAME}"]`)?.getAttribute('content') ?? '';
  if (!URL.canParse(content)) {
    return null;
  }
  const { protocol, origin } = new URL(content);
  return protocol === 'https:' || protocol === 'http:' ? origin : null;
}
