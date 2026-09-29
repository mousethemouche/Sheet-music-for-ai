/**
 * Where the web app reaches the saved-library HTTP API (apps/api, #21). Read
 * from VITE_API_BASE_URL at build time, so it ends up in the public bundle.
 * Requests carry the user's access token, so the URL must be https; plain
 * http is accepted only for a loopback host during local development.
 */
export interface ApiConfig {
  /** Absolute base URL without a trailing slash; routes are appended (`/scores`). */
  readonly baseUrl: string;
}

export interface ApiEnv {
  readonly VITE_API_BASE_URL?: string | undefined;
}

export type ApiConfigResult =
  | { readonly ok: true; readonly config: ApiConfig }
  | { readonly ok: false; readonly problem: string };

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

const PROBLEM =
  'VITE_API_BASE_URL must be the https URL of the library API (http only for localhost), without credentials, query or fragment.';

export function readApiConfig(env: ApiEnv): ApiConfigResult {
  const raw = env.VITE_API_BASE_URL?.trim() ?? '';
  if (!URL.canParse(raw)) return { ok: false, problem: PROBLEM };
  const url = new URL(raw);
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (
    !secure ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return { ok: false, problem: PROBLEM };
  }
  return { ok: true, config: { baseUrl: url.href.replace(/\/+$/, '') } };
}
