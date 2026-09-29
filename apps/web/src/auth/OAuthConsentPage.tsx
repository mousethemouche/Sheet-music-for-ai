import { useCallback, useEffect, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router';
import { LoadingState } from '../shell/LoadingState';
import { AuthCard } from './AuthCard';
import type { AuthErrorCode, OAuthAuthorizationRequest, OAuthDecision } from './authPort';
import { useAuth } from './AuthProvider';
import { FormError, usePendingAction } from './forms';
import { authErrorMessage } from './messages';
import { isAllowedOAuthRedirect } from './redirects';

/** Navigates the whole browser away from the app (to the OAuth client). */
export type LeaveApp = (url: string) => void;

const INVALID_REQUEST =
  'This authorization request is invalid or has expired. Go back to the application and connect again.';

const SCOPE_LABELS: Readonly<Record<string, string>> = {
  openid: 'Confirm who you are',
  email: 'See your email address',
  profile: 'See your basic profile',
  phone: 'See your phone number',
};

/**
 * Consent step of the Supabase OAuth 2.1 server (the project's "Authorization
 * Path"). Rendered behind RequireAuth, so a signed-out user signs in first and
 * comes back with the same `authorization_id`.
 */
export function OAuthConsentPage(props: { leaveApp: LeaveApp }): JSX.Element {
  const { state } = useAuth();
  const [searchParams] = useSearchParams();
  const authorizationId = searchParams.get('authorization_id') ?? '';

  if (state.status !== 'signed-in') return <LoadingState>Checking your session…</LoadingState>;
  if (!authorizationId) return <ConsentError message={INVALID_REQUEST} />;

  // A different account or request starts from a clean state.
  return (
    <AuthorizationRequest
      key={`${state.user.id}:${authorizationId}`}
      authorizationId={authorizationId}
      accountEmail={state.user.email}
      leaveApp={props.leaveApp}
    />
  );
}

type View =
  | { readonly kind: 'loading' }
  | { readonly kind: 'consent'; readonly request: OAuthAuthorizationRequest }
  | { readonly kind: 'redirecting' }
  | { readonly kind: 'error'; readonly message: string };

function AuthorizationRequest(props: {
  authorizationId: string;
  accountEmail: string | null;
  leaveApp: LeaveApp;
}): JSX.Element {
  const { authorizationId, leaveApp } = props;
  const { port } = useAuth();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = usePendingAction();

  const leave = useCallback(
    (url: string) => {
      if (!isAllowedOAuthRedirect(url)) {
        setView({ kind: 'error', message: INVALID_REQUEST });
        return;
      }
      setView({ kind: 'redirecting' });
      leaveApp(url);
    },
    [leaveApp],
  );

  useEffect(() => {
    let active = true;
    void port.getOAuthAuthorization(authorizationId).then((result) => {
      if (!active) return;
      if (!result.ok) setView({ kind: 'error', message: requestErrorMessage(result.error) });
      else if (result.value.kind === 'redirect') leave(result.value.redirectUrl);
      else setView({ kind: 'consent', request: result.value.request });
    });
    return () => {
      active = false;
    };
  }, [port, authorizationId, leave]);

  if (view.kind === 'loading') {
    return <LoadingState>Loading the authorization request…</LoadingState>;
  }
  if (view.kind === 'redirecting')
    return <LoadingState>Returning to the application…</LoadingState>;
  if (view.kind === 'error') return <ConsentError message={view.message} />;

  const { request } = view;
  const clientName = request.clientName || 'An application';
  const decide = (decision: OAuthDecision) =>
    void run(async () => {
      setError(null);
      const result = await port.decideOAuthAuthorization(request.authorizationId, decision);
      if (result.ok) leave(result.value.redirectUrl);
      else setError(requestErrorMessage(result.error));
    });

  return (
    <AuthCard
      titleId="consent-title"
      title={`Allow ${clientName} to use your account?`}
      subtitle={props.accountEmail && <>Signed in as {props.accountEmail}.</>}
      icon={{ name: 'shield' }}
    >
      <p>
        {clientName}
        {request.clientUri && ` (${request.clientUri})`} wants to use Sheet Music for AI as you:
        create, edit, save and search your scores. It asks to:
      </p>
      <ul aria-label="Requested permissions" className="ui-scope-list">
        {request.scopes.map((scope) => (
          <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>
        ))}
      </ul>
      <p className="ui-small ui-muted app-break">
        After you decide, you return to {request.redirectUri}.
      </p>
      <FormError message={error} />
      <div className="ui-actions ui-actions--stretch">
        <button
          type="button"
          className="ui-button ui-button--primary"
          disabled={pending}
          onClick={() => decide('approve')}
        >
          Allow
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={pending}
          onClick={() => decide('deny')}
        >
          Deny
        </button>
      </div>
    </AuthCard>
  );
}

function ConsentError(props: { message: string }): JSX.Element {
  return (
    <AuthCard
      titleId="consent-title"
      title="Authorization request"
      icon={{ name: 'alert', tone: 'danger' }}
    >
      <p role="alert">{props.message}</p>
    </AuthCard>
  );
}

function requestErrorMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'network':
    case 'unavailable':
    case 'rate-limited':
    case 'session-missing':
      return authErrorMessage(code);
    default:
      return INVALID_REQUEST;
  }
}
