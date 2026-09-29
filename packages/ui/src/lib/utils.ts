/**
 * Class-name joining with Tailwind conflict resolution (the `cn` package:
 * clsx + tailwind-merge semantics; a later class wins over a conflicting
 * earlier one). Re-exported so score-ui and the apps compose classes through
 * the design system, without a dependency of their own. The components
 * import it from `cn` directly, as the shadcn CLI generates them.
 */
export { cn } from 'cn';
