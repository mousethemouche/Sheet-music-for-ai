/**
 * Browser configuration read from Vite environment variables at build time.
 * Everything here ends up in the public bundle, so only the Supabase project
 * URL and its PUBLISHABLE key are accepted; a secret key is refused outright.
 */
export interface WebAuthConfig {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
}

export interface WebEnv {
  readonly VITE_SUPABASE_URL?: string | undefined;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string | undefined;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: WebAuthConfig }
  | { readonly ok: false; readonly problem: string };

const PUBLISHABLE_KEY_PREFIX = 'sb_publishable_';

/** Validates the auth configuration. Problems never echo the key value. */
export function readWebAuthConfig(env: WebEnv): ConfigResult {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  if (!isHttpUrl(supabaseUrl)) {
    return {
      ok: false,
      problem: 'VITE_SUPABASE_URL must be the http(s) URL of the Supabase project.',
    };
  }
  if (!publishableKey.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    return {
      ok: false,
      problem: `VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key (${PUBLISHABLE_KEY_PREFIX}...). Secret, service-role and legacy JWT keys are refused in the browser.`,
    };
  }
  return { ok: true, config: { supabaseUrl, publishableKey } };
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
