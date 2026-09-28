import { useState, type JSX } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { usePendingAction } from '../auth/forms';
import { authErrorMessage } from '../auth/messages';

/** Minimal app frame: product name, account navigation and the current page. */
export function AppShell(): JSX.Element {
  return (
    <>
      <header>
        <Link to="/">Sheet Music for AI</Link>
        <AccountNav />
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

function AccountNav(): JSX.Element | null {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = usePendingAction();

  if (state.status === 'restoring') return null;
  if (state.status === 'signed-out') {
    return (
      <nav aria-label="Account">
        <Link to="/login">Sign in</Link> <Link to="/signup">Create account</Link>
      </nav>
    );
  }

  const onSignOut = () =>
    void run(async () => {
      setError(null);
      const result = await signOut();
      if (result.ok) await navigate('/login', { replace: true });
      else setError(authErrorMessage(result.error));
    });

  return (
    <nav aria-label="Account">
      <Link to="/library">Library</Link> <span>{state.user.email}</span>{' '}
      <button type="button" disabled={pending} onClick={onSignOut}>
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && <span role="alert">{error}</span>}
    </nav>
  );
}
