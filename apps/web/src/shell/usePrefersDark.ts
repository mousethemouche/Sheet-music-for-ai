import { useSyncExternalStore } from 'react';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Whether the system asks for a dark color scheme, updated when it changes.
 * The tokens follow the same media query, so the ScorePlayer's `theme` (its
 * notation paper and ink, DESIGN_SYSTEM.md §5) matches the app around it.
 * Without `matchMedia` (jsdom) it answers light, the player's default.
 */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribe, prefersDark, () => false);
}

/** Test environments (jsdom) have no working matchMedia. */
const canMatch = (): boolean => typeof window.matchMedia === 'function';

function subscribe(onChange: () => void): () => void {
  if (!canMatch()) return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function prefersDark(): boolean {
  return canMatch() && window.matchMedia(DARK_QUERY).matches;
}
