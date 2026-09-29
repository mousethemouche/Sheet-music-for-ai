/**
 * Tailwind class strings the web pages share, for what @sheet-music/ui has no
 * component for: the page container, links and inline code. Tailwind finds
 * them here because app.css scans apps/web/src.
 */

/** Centered content: 1040 px wide between 24 px gutters (16 px on phones). */
export const CONTAINER = 'mx-auto w-full max-w-[1088px] px-4 sm:px-6';

/** The centered column of the account pages (cards up to 400 px wide). */
export const AUTH_COLUMN = 'flex justify-center py-6 sm:pt-8';

/** A standalone link (not in running text): primary, medium, underlined on hover. */
export const STANDALONE_LINK =
  'font-medium text-primary underline-offset-2 hover:text-primary-hover hover:underline';

/** A link in running text: a thin, faded underline that turns solid on hover. */
export const TEXT_LINK =
  'underline decoration-current/40 decoration-1 underline-offset-2 hover:decoration-current';

/** Inline code (IDs, references): a small mono chip that wraps inside itself. */
export const CODE =
  'rounded-sm border bg-muted px-[0.35em] py-[0.1em] font-mono text-[0.875em] wrap-anywhere';
