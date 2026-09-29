import { useState, type JSX } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { usePendingAction } from '../auth/forms';
import { authErrorMessage } from '../auth/messages';
import { Alert } from './Alert';

/** A failed account action, shown on the page where it happened. */
interface AccountError {
  readonly path: string;
  readonly message: string;
}

/** App frame: product name, account navigation, the current page and the credits link. */
export function AppShell(): JSX.Element {
  const { pathname } = useLocation();
  const [accountError, setAccountError] = useState<AccountError | null>(null);
  const onAccountError = (message: string | null) =>
    setAccountError(message === null ? null : { path: pathname, message });
  return (
    <>
      <header className="ui-header">
        <div className="ui-container ui-header__inner">
          <Link to="/" className="ui-brand">
            <span className="ui-brand__mark" aria-hidden="true">
              ♪
            </span>
            Sheet Music for AI
          </Link>
          <AccountNav onError={onAccountError} />
        </div>
      </header>
      <main className="ui-main">
        <div className="ui-container">
          {/* In the flow above the page, never over it; it stays with the page it belongs to. */}
          {accountError !== null && accountError.path === pathname && (
            <Alert
              tone="error"
              className="app-account-alert"
              onDismiss={() => setAccountError(null)}
            >
              {accountError.message}
            </Alert>
          )}
          <Outlet />
        </div>
      </main>
      <footer className="ui-footer">
        <div className="ui-container">
          <Link to="/about">About and credits</Link>
        </div>
      </footer>
    </>
  );
}

function AccountNav(props: { onError: (message: string | null) => void }): JSX.Element | null {
  const { onError } = props;
  const { state, signOut } = useAuth();
  const navigate = useNavigate();
  const { pending, run } = usePendingAction();
  // A saved score belongs to the Library section (the link is not the current page).
  const inScore = useMatch('/scores/:scoreId') !== null;
  // Pages that already show the account's email, or the header's own action.
  const onLibrary = useMatch('/library') !== null;
  const onConsent = useMatch('/oauth/consent') !== null;
  const onSignIn = useMatch('/login') !== null;
  const onSignUp = useMatch('/signup') !== null;

  if (state.status === 'restoring') return null;
  if (state.status === 'signed-out') {
    const both = !onSignIn && !onSignUp;
    return (
      <nav aria-label="Account" className="app-nav">
        <div className="ui-header__end">
          {!onSignIn && (
            <Link to="/login" className="ui-button ui-button--ghost ui-button--sm">
              Sign in
            </Link>
          )}
          {!onSignUp && (
            <Link
              to="/signup"
              className={
                both
                  ? 'ui-button ui-button--secondary ui-button--sm app-nav__signup'
                  : 'ui-button ui-button--secondary ui-button--sm'
              }
            >
              Create account
            </Link>
          )}
        </div>
      </nav>
    );
  }

  const onSignOut = () =>
    void run(async () => {
      onError(null);
      const result = await signOut();
      if (result.ok) await navigate('/login', { replace: true });
      else onError(authErrorMessage(result.error));
    });

  return (
    <nav aria-label="Account" className="app-nav">
      <NavLink
        to="/library"
        className={inScore ? 'ui-nav__link app-nav__link--section' : 'ui-nav__link'}
      >
        Library
      </NavLink>
      <div className="ui-header__end">
        {!onLibrary && !onConsent && <span className="ui-header__email">{state.user.email}</span>}
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={pending}
          onClick={onSignOut}
        >
          {pending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </nav>
  );
}
