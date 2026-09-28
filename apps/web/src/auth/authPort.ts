/**
 * Provider-neutral authentication port for the web app (ADR-005).
 *
 * Pages, components and the session provider depend only on these types. The
 * Supabase adapter (supabaseAuthAdapter.ts) is the only module that knows the
 * provider SDK; no provider type, token or raw provider message crosses this
 * boundary.
 */

/** The signed-in account. `id` is the stable auth subject, the application's `UserId`. */
export interface AuthUser {
  readonly id: string;
  readonly email: string | null;
}

/** An authenticated session on this device. Tokens stay inside the adapter. */
export interface AuthSession {
  readonly user: AuthUser;
}

/**
 * Session changes pushed by the provider. `signed-in`, `signed-out` and
 * `password-recovery` may change the account; `token-refreshed` and
 * `user-updated` only renew or update the current one.
 */
export type AuthChange =
  'signed-in' | 'signed-out' | 'password-recovery' | 'token-refreshed' | 'user-updated';

/** Safe, provider-neutral failure reasons. Pages map them to fixed messages. */
export type AuthErrorCode =
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'invalid-email'
  | 'weak-password'
  | 'same-password'
  | 'session-missing'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'unavailable'
  | 'unknown';

export type AuthResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AuthErrorCode };

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/**
 * A sign-up that needs email confirmation creates no session: the account
 * becomes usable only after the emailed link is opened.
 */
export type SignUpOutcome = 'signed-in' | 'confirmation-required';

/**
 * What the provider found in the URL the app was opened with (an emailed
 * confirmation or recovery link). Resolved once per page load.
 */
export type AuthRedirectResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'password-recovery' }
  | { readonly kind: 'link-error'; readonly reason: 'expired' | 'invalid' };

/** An OAuth 2.1 authorization request waiting for the signed-in user's decision. */
export interface OAuthAuthorizationRequest {
  readonly authorizationId: string;
  readonly clientName: string;
  readonly clientUri: string | null;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

export type OAuthAuthorizationState =
  | { readonly kind: 'consent-required'; readonly request: OAuthAuthorizationRequest }
  /** Consent was already given: continue to the client without asking again. */
  | { readonly kind: 'redirect'; readonly redirectUrl: string };

export type OAuthDecision = 'approve' | 'deny';

export interface AuthPort {
  /** The session restored on this device, or null. */
  getSession(): Promise<AuthSession | null>;
  /** Subscribes to session changes; the returned function unsubscribes. */
  onChange(listener: (change: AuthChange, session: AuthSession | null) => void): () => void;
  getRedirectResult(): Promise<AuthRedirectResult>;

  /** `confirmationPath` is the same-origin path the emailed confirmation link returns to. */
  signUp(
    credentials: Credentials & { readonly confirmationPath: string },
  ): Promise<AuthResult<SignUpOutcome>>;
  signIn(credentials: Credentials): Promise<AuthResult<void>>;
  /** Resolves ok once this device no longer holds a session. */
  signOut(): Promise<AuthResult<void>>;
  /** `resetPath` is the same-origin path the emailed recovery link returns to. */
  requestPasswordReset(input: {
    readonly email: string;
    readonly resetPath: string;
  }): Promise<AuthResult<void>>;
  /** Sets a new password for the current (recovery) session. */
  updatePassword(password: string): Promise<AuthResult<void>>;

  getOAuthAuthorization(authorizationId: string): Promise<AuthResult<OAuthAuthorizationState>>;
  /** Records the decision; the result is the URL that returns the user to the OAuth client. */
  decideOAuthAuthorization(
    authorizationId: string,
    decision: OAuthDecision,
  ): Promise<AuthResult<{ readonly redirectUrl: string }>>;
}
