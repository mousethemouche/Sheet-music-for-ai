/**
 * Skeleton: shadcn/ui new-york, customised for DESIGN_SYSTEM.md: a pulsing
 * placeholder bar in the `border` color, 1.3:1 / 1.2:1 on a card (shadcn's
 * `bg-accent` is 1.1:1 and reads as an empty card once reduced motion stops
 * the pulse). Always decorative, so it is `aria-hidden` unless
 * the caller says otherwise; the page's one status line says what is
 * loading. The pulse stops under reduced motion (theme.css).
 */
import { cn } from 'cn';
import type * as React from 'react';

type SkeletonProps = React.ComponentProps<'div'>;

function Skeleton({ className, ...props }: SkeletonProps): React.JSX.Element {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-border', className)}
      {...props}
    />
  );
}

export { Skeleton };
export type { SkeletonProps };
