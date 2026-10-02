import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import type { AuthPort, AuthResult, AuthSession, AuthUser } from './authPort';
import type { PrivateStateRegistry } from './privateState';

/**
 * `restoring` lasts until the provider has answered once: nothing private and
 * no sign-in redirect is rendered before that, so there is no content flash.
 */
export type AuthState =
  | { readonly status: 'restoring' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly user: AuthUser };

export interface AuthContextValue {
  readonly state: AuthState;
  readonly port: AuthPort;
  readonly privateState: PrivateStateRegistry;
  /** Clears private state (audio, caches) first, then ends the session. */
  readonly signOut: () => Promise<AuthResult<void>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const RESTORING: AuthState = { status: 'restoring' };
const SIGNED_OUT: AuthState = { status: 'signed-out' };

export function AuthProvider(props: {
  port: AuthPort;
  privateState: PrivateStateRegistry;
  children: ReactNode;
}): JSX.Element {
  const { port, privateState } = props;
  const [state, setState] = useState<AuthState>(RESTORING);

  useEffect(() => {
    let active = true;
    // undefined until the first answer; then the signed-in user id or null.
    let currentUserId: string | null | undefined;
    let changeSeen = false;

    const apply = (session: AuthSession | null) => {
      const userId = session?.user.id ?? null;
      if (currentUserId && userId !== currentUserId) {
        // Account A's state must never be visible to whoever comes next.
        privateState.clearAll();
      }
      currentUserId = userId;
      setState(session ? { status: 'signed-in', user: session.user } : SIGNED_OUT);
    };

    const unsubscribe = port.onChange((change, session) => {
      if (!active) return;
      const renewal = change === 'token-refreshed' || change === 'user-updated';
      // A renewal only updates the current account; a late one for another
      // account (after a switch) is ignored rather than switching back.
      if (renewal && (session?.user.id ?? null) !== currentUserId) return;
      changeSeen = true;
      apply(session);
    });

    // A pushed change is newer than the restored session: the restore result
    // is only used if nothing happened while it was in flight.
    port.getSession().then(
      (session) => {
        if (active && !changeSeen) apply(session);
      },
      () => {
        if (active && !changeSeen) apply(null);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [port, privateState]);

  const signOut = useCallback(() => {
    privateState.clearAll();
    return port.signOut();
  }, [port, privateState]);

  const value = useMemo(
    () => ({ state, port, privateState, signOut }),
    [state, port, privateState, signOut],
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
