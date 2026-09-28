import type { JSX } from 'react';
import { useAuth } from '../auth/AuthProvider';

/**
 * Protected placeholder for the saved-score library. #15 replaces it with the
 * real library (src/library/), registering its caches and audio with the
 * private-state registry so sign-out and account switches clear them.
 */
export function LibraryPlaceholderPage(): JSX.Element {
  const { state } = useAuth();
  const email = state.status === 'signed-in' ? state.user.email : null;
  return (
    <section aria-labelledby="library-title">
      <h1 id="library-title">Your library</h1>
      {email && <p>Signed in as {email}.</p>}
      <p>Your saved scores will appear here.</p>
    </section>
  );
}
