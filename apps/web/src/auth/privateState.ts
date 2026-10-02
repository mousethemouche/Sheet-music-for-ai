/**
 * Registry of per-account browser state (audio playback, cached scores...).
 *
 * Private features register a cleanup when they start holding account data;
 * the session provider runs every cleanup on sign-out and whenever the signed-in
 * account changes, so nothing of account A survives into account B's session.
 * Cleanups must be synchronous and idempotent.
 */
export interface PrivateStateRegistry {
  /** Adds a cleanup; the returned function removes it again. */
  register(cleanup: () => void): () => void;
  /** Runs every registered cleanup. One failing cleanup does not stop the others. */
  clearAll(): void;
}

export function createPrivateStateRegistry(): PrivateStateRegistry {
  const cleanups = new Set<() => void>();
  return {
    register(cleanup) {
      // A wrapper keeps registrations distinct even for the same function.
      const entry = () => cleanup();
      cleanups.add(entry);
      return () => {
        cleanups.delete(entry);
      };
    },
    clearAll() {
      for (const cleanup of [...cleanups]) {
        try {
          cleanup();
        } catch (error) {
          console.error('Private state cleanup failed', error);
        }
      }
    },
  };
}
