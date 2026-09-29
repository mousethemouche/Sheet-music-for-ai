import { useEffect } from 'react';
import type { AuthUser } from '../auth/authPort';
import { useAuth } from '../auth/AuthProvider';

/**
 * The signed-in account, or null. Library pages render under RequireAuth and
 * key their content by `user.id`, so an account switch remounts it: requests
 * of the previous account are aborted and its data is never shown to the next.
 */
export function useSignedInUser(): AuthUser | null {
  const { state } = useAuth();
  return state.status === 'signed-in' ? state.user : null;
}

/**
 * Registers `cleanup` with the private-state registry (WEB_AUTH.md) while the
 * component is mounted: sign-out and account switches run it before the
 * session ends. It must be stable, synchronous and idempotent.
 */
export function usePrivateCleanup(cleanup: () => void): void {
  const { privateState } = useAuth();
  useEffect(() => privateState.register(cleanup), [privateState, cleanup]);
}
