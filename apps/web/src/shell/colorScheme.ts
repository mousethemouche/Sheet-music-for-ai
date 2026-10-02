/**
 * The page's light or dark theme. The design tokens of @sheet-music/ui switch
 * on a `.light` / `.dark` class of the root element (theme.css), not on a
 * media query, so main.tsx calls `followColorScheme` once, before rendering,
 * to keep that class equal to the system preference.
 */

export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The part of a `MediaQueryList` this module uses. */
export interface ColorSchemeQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** The part of the root element this module uses. */
export interface ThemeRoot {
  readonly classList: { toggle(token: string, force?: boolean): boolean };
}

/**
 * Sets `.dark` on `root` when `query` matches and `.light` otherwise, now and
 * on every change. Returns the function that stops following.
 */
export function followColorScheme(root: ThemeRoot, query: ColorSchemeQuery): () => void {
  const apply = () => {
    root.classList.toggle('dark', query.matches);
    root.classList.toggle('light', !query.matches);
  };
  apply();
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}
