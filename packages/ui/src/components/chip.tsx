/**
 * Chip (project-owned, built on Badge): a tag pill, static on an `<li>` or
 * interactive on a `<button>` (tag filters). Pass the element with `asChild`.
 *
 * - Static chips are the 24 px neutral Badge.
 * - Button chips are 24 px from 640 px up and 32 px below, with an invisible
 *   `::after` that extends the target to 40 px on phones (rows keep 8 px
 *   apart, so neighbouring targets do not overlap). They darken on hover and
 *   fade when disabled (an already active filter).
 * - `selected` is the active filter: primary soft surface, primary text.
 * Decorative glyphs inside (the `×` of a removable filter) go in the markup
 * with `aria-hidden="true"`, so the accessible name stays the button's label.
 */
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from 'cn';
import type * as React from 'react';
import { Badge } from './badge';

const chipVariants = cva(
  'transition-colors duration-120 ease-standard [button&]:relative [button&]:h-8 [button&]:cursor-pointer [button&]:after:absolute [button&]:after:inset-x-0 [button&]:after:-inset-y-1 sm:[button&]:h-6 sm:[button&]:after:hidden disabled:cursor-default disabled:opacity-55',
  {
    variants: {
      selected: {
        false:
          '[button&]:enabled:hover:border-border-control [button&]:enabled:hover:text-foreground',
        true: 'border-primary-border bg-primary-soft text-primary [button&]:enabled:hover:border-primary [button&]:enabled:hover:text-primary-hover',
      },
    },
    defaultVariants: { selected: false },
  },
);

type ChipProps = React.ComponentProps<'span'> &
  VariantProps<typeof chipVariants> & {
    /** Render the single child (`<li>` or `<button>`) as the chip. */
    asChild?: boolean;
  };

function Chip({
  className,
  selected = false,
  asChild = false,
  ...props
}: ChipProps): React.JSX.Element {
  return (
    <Badge
      asChild={asChild}
      data-slot="chip"
      data-selected={selected === true ? '' : undefined}
      className={cn(chipVariants({ selected }), className)}
      {...props}
    />
  );
}

export { Chip, chipVariants };
export type { ChipProps };
