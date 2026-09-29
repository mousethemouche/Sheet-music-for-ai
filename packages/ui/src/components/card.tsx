/**
 * Card: shadcn/ui new-york, customised for DESIGN_SYSTEM.md §3 (the
 * project's card look).
 *
 * Changes from the registry code, on purpose:
 * - The card itself is padded (16 px on phones, 24 px from 640 px up), with
 *   a 12 px radius, a decorative border and the subtle `shadow-sm`.
 * - Only the `Card` itself: the pages lay out their own headings and rows,
 *   so the registry's `CardHeader`, `CardTitle`, `CardDescription`,
 *   `CardAction`, `CardContent` and `CardFooter` are not kept (theme.css
 *   scans this directory, so unused parts would still add CSS).
 * - `asChild` (Radix Slot) renders the single child with the card's
 *   classes, so a card can be the `<li>` of a list or the `<section>` of a
 *   page without an extra wrapper.
 */
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type * as React from 'react';

type CardProps = React.ComponentProps<'div'> & {
  /** Render the single child (`<li>`, `<section>`...) with the card's classes. */
  asChild?: boolean;
};

function Card({ className, asChild = false, ...props }: CardProps): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'div';
  return (
    <Comp
      data-slot="card"
      className={cn(
        'rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6',
        className,
      )}
      {...props}
    />
  );
}

export { Card };
export type { CardProps };
