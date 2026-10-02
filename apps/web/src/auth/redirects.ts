/** Where a signed-in user goes when no (valid) return path was requested. */
export const DEFAULT_RETURN_PATH = '/library';

const PROBE_ORIGIN = 'https://app.invalid';

/**
 * Returns `raw` if it is a same-origin, relative in-app path, otherwise the
 * default. The path is normalized the way browsers parse URLs, so
 * protocol-relative (`//host`), absolute and `javascript:` URLs, and paths that
 * normalize into another origin (backslashes, tabs, dot segments) are rejected.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw?.startsWith('/') || raw.startsWith('//')) return DEFAULT_RETURN_PATH;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === PROBE_ORIGIN && !path.startsWith('//') ? path : DEFAULT_RETURN_PATH;
}

/** `path?next=<return path>`, omitting the default return path. */
export function withReturnPath(path: string, returnPath: string): string {
  return returnPath === DEFAULT_RETURN_PATH
    ? path
    : `${path}?${new URLSearchParams({ next: returnPath }).toString()}`;
}

const BLOCKED_REDIRECT_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
  'file:',
  'about:',
]);

/**
 * OAuth clients may register https, loopback or native-app (custom scheme)
 * redirect URIs, so only script-capable and local-document schemes are refused.
 */
export function isAllowedOAuthRedirect(value: string): boolean {
  try {
    return !BLOCKED_REDIRECT_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
