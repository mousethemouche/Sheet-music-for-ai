import type { JSX } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { withReturnPath } from './redirects';

/**
 * Guards private routes. While the session is being restored it renders only a
 * neutral status; without a session it sends the user to sign-in with the
 * current path (including its query, e.g. an OAuth authorization_id) to return to.
 */
export function RequireAuth(): JSX.Element {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'restoring') return <SessionRestoring />;
  if (state.status === 'signed-out') {
    return <Navigate replace to={withReturnPath('/login', location.pathname + location.search)} />;
  }
  return <Outlet />;
}

export function SessionRestoring(): JSX.Element {
  return <p role="status">Checking your session…</p>;
}
