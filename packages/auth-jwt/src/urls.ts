/**
 * URL rules shared by the discovery builders and the key source: configured
 * server URLs use https, except plain http on a loopback host for local
 * development (Supabase CLI, local MCP server). No credentials, no fragment.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export function requireServerUrl(value: string, name: string): URL {
  if (!URL.canParse(value)) {
    throw new TypeError(`${name} must be an absolute URL.`);
  }
  const url = new URL(value);
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure) {
    throw new TypeError(`${name} must use https (http is allowed only on a loopback host).`);
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '' || value.includes('#')) {
    throw new TypeError(`${name} must not contain credentials or a fragment.`);
  }
  return url;
}

/**
 * The canonical URI of a protected resource (RFC 8707 §2, MCP authorization
 * "Canonical Server URI"): lowercase scheme and host, no query, no fragment,
 * and no trailing slash unless the path is the root. Example:
 * `HTTPS://MCP.Example.com/mcp` -> `https://mcp.example.com/mcp`.
 */
export function canonicalResourceUri(resource: string): string {
  const url = requireServerUrl(resource, 'resource');
  if (url.search !== '' || resource.includes('?')) {
    throw new TypeError('resource must not contain a query.');
  }
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.origin}${path}`;
}
