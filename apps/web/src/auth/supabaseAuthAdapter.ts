/**
 * Supabase Auth adapter for the web app: the only module that imports the
 * Supabase SDK (ADR-005). It uses the publishable key only; a secret or
 * service-role key must never reach the browser (see config.ts).
 */
import {
  createClient,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { WebAuthConfig } from '../config';
import type {
  AuthChange,
  AuthErrorCode,
  AuthPort,
  AuthRedirectResult,
  AuthResult,
  AuthSession,
} from './authPort';

type SupabaseAuth = SupabaseClient['auth'];

export interface SupabaseAuthAdapterOptions {
  readonly auth: SupabaseAuth;
  /** The URL the page was opened with, captured before the client clears its auth parameters. */
  readonly initialUrl: string;
  /** Origin that emailed links return to (`window.location.origin`). */
  readonly appOrigin: string;
}

/** Builds the browser client and the adapter for this page load. */
export function createSupabaseWebAuth(
  config: WebAuthConfig,
  location: { readonly href: string; readonly origin: string },
): AuthPort {
  const initialUrl = location.href;
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      // Implicit flow: emailed links carry the session in the URL fragment, so a
      // confirmation or recovery link also works when opened in another browser.
      flowType: 'implicit',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return createSupabaseAuthAdapter({ auth: client.auth, initialUrl, appOrigin: location.origin });
}

export function createSupabaseAuthAdapter(options: SupabaseAuthAdapterOptions): AuthPort {
  const { auth } = options;
  const appOrigin = new URL(options.appOrigin).origin;
  const linkParams = readAuthParams(options.initialUrl);
  let redirectResult: Promise<AuthRedirectResult> | undefined;

  /** Emailed links may only return to this app. */
  const appUrl = (path: string): string | null => {
    const url = new URL(path, appOrigin);
    return url.origin === appOrigin ? url.href : null;
  };

  return {
    async getSession() {
      const { data } = await auth.getSession();
      return toSession(data.session);
    },

    async getAccessToken() {
      // getSession() renews an expired access token before returning it. A
      // renewal that could not reach the provider keeps the session: that is
      // an outage (rejection), not a signed-out user (null).
      const { data, error } = await auth.getSession();
      if (!data.session && error && isAuthRetryableFetchError(error)) {
        throw new Error('The session could not be renewed: the auth provider is unreachable.');
      }
      return data.session?.access_token ?? null;
    },

    onChange(listener) {
      const { data } = auth.onAuthStateChange((event, session) => {
        const change = toChange(event, session);
        if (change) listener(change, toSession(session));
      });
      return () => data.subscription.unsubscribe();
    },

    getRedirectResult() {
      redirectResult ??= auth.initialize().then(({ error }) => toRedirectResult(linkParams, error));
      return redirectResult;
    },

    signUp: ({ email, password, confirmationPath }) =>
      attempt(async () => {
        const emailRedirectTo = appUrl(confirmationPath);
        if (!emailRedirectTo) return fail('unknown');
        const { data, error } = await auth.signUp({
          email,
          password,
          options: { emailRedirectTo },
        });
        if (error) return fail(toErrorCode(error));
        // With email confirmation on, the provider returns no session, also for
        // an address that already has an account (no enumeration).
        return ok(data.session ? 'signed-in' : 'confirmation-required');
      }),

    signIn: ({ email, password }) =>
      attempt(async () => {
        const { error } = await auth.signInWithPassword({ email, password });
        return error ? fail(toErrorCode(error)) : ok(undefined);
      }),

    signOut: () =>
      attempt(async () => {
        // `local` ends this device's session only; OAuth connections of the
        // same account (MCP hosts) keep their own sessions.
        const { error } = await auth.signOut({ scope: 'local' });
        if (!error) return ok(undefined);
        const { data } = await auth.getSession();
        return data.session ? fail(toErrorCode(error)) : ok(undefined);
      }),

    requestPasswordReset: ({ email, resetPath }) =>
      attempt(async () => {
        const redirectTo = appUrl(resetPath);
        if (!redirectTo) return fail('unknown');
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo });
        return error ? fail(toErrorCode(error)) : ok(undefined);
      }),

    updatePassword: (password) =>
      attempt(async () => {
        const { error } = await auth.updateUser({ password });
        return error ? fail(toErrorCode(error)) : ok(undefined);
      }),

    getOAuthAuthorization: (authorizationId) =>
      attempt(async () => {
        const { data, error } = await auth.oauth.getAuthorizationDetails(authorizationId);
        if (error) return fail(toErrorCode(error));
        if (!('authorization_id' in data)) {
          return ok({ kind: 'redirect' as const, redirectUrl: data.redirect_url });
        }
        return ok({
          kind: 'consent-required' as const,
          request: {
            authorizationId: data.authorization_id,
            clientName: data.client.name,
            clientUri: data.client.uri || null,
            redirectUri: data.redirect_uri,
            scopes: data.scope.split(' ').filter((scope) => scope !== ''),
          },
        });
      }),

    decideOAuthAuthorization: (authorizationId, decision) =>
      attempt(async () => {
        // The page performs the navigation itself, after checking the URL.
        const options = { skipBrowserRedirect: true };
        const { data, error } =
          decision === 'approve'
            ? await auth.oauth.approveAuthorization(authorizationId, options)
            : await auth.oauth.denyAuthorization(authorizationId, options);
        if (error) return fail(toErrorCode(error));
        return ok({ redirectUrl: data.redirect_url });
      }),
  };
}

const ok = <T>(value: T): AuthResult<T> => ({ ok: true, value });
const fail = <T>(error: AuthErrorCode): AuthResult<T> => ({ ok: false, error });

/** Unexpected throws become a neutral failure; nothing from the provider leaks. */
async function attempt<T>(run: () => Promise<AuthResult<T>>): Promise<AuthResult<T>> {
  try {
    return await run();
  } catch (error) {
    return fail(toErrorCode(error));
  }
}

function toSession(session: Session | null): AuthSession | null {
  return session ? { user: { id: session.user.id, email: session.user.email ?? null } } : null;
}

function toChange(event: AuthChangeEvent, session: Session | null): AuthChange | null {
  switch (event) {
    case 'INITIAL_SESSION':
      return session ? 'signed-in' : 'signed-out';
    case 'SIGNED_IN':
      return 'signed-in';
    case 'SIGNED_OUT':
      return 'signed-out';
    case 'PASSWORD_RECOVERY':
      return 'password-recovery';
    case 'TOKEN_REFRESHED':
      return 'token-refreshed';
    case 'USER_UPDATED':
      return 'user-updated';
    default:
      return null;
  }
}

function toErrorCode(error: unknown): AuthErrorCode {
  if (!isAuthError(error)) return 'unknown';
  if (isAuthRetryableFetchError(error)) return error.status === 0 ? 'network' : 'unavailable';
  if (isAuthSessionMissingError(error)) return 'session-missing';
  if (isAuthWeakPasswordError(error)) return 'weak-password';
  switch (error.code) {
    case 'invalid_credentials':
      return 'invalid-credentials';
    case 'email_not_confirmed':
      return 'email-not-confirmed';
    case 'email_address_invalid':
      return 'invalid-email';
    case 'same_password':
      return 'same-password';
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return 'session-missing';
    case 'user_not_found':
      return 'not-found';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rate-limited';
    default:
      break;
  }
  if (error.status === 429) return 'rate-limited';
  if (error.status === 404) return 'not-found';
  return 'unknown';
}

/** Auth parameters of an emailed link: fragment first, query string wins (as the SDK reads them). */
function readAuthParams(href: string): URLSearchParams {
  const url = new URL(href);
  const params = new URLSearchParams(url.hash.slice(1));
  url.searchParams.forEach((value, key) => params.set(key, value));
  return params;
}

function toRedirectResult(params: URLSearchParams, initError: unknown): AuthRedirectResult {
  if (params.has('error') || params.has('error_code') || params.has('error_description')) {
    return {
      kind: 'link-error',
      reason: params.get('error_code') === 'otp_expired' ? 'expired' : 'invalid',
    };
  }
  if (!params.has('access_token')) return { kind: 'none' };
  if (initError) return { kind: 'link-error', reason: 'invalid' };
  return params.get('type') === 'recovery' ? { kind: 'password-recovery' } : { kind: 'none' };
}
