/**
 * Badge: shadcn/ui new-york (Radix Slot), customised for DESIGN_SYSTEM.md:
 * the neutral 24 px pill of the project's tags (muted surface, decorative
 * border, 12 px medium muted text). One variant; the tag chips build on it
 * (chip.tsx). No `overflow-hidden` (a chip's enlarged touch target is a
 * pseudo-element outside its box), no `dark:` classes, `focus-ring` focus.
 */
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type * as React from 'react';

const badgeVariants = cva(
  'inline-flex h-6 w-fit max-w-full shrink-0 items-center justify-center gap-1 rounded-full border px-2.5 text-xs leading-none font-medium whitespace-nowrap focus-ring [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type BadgeProps = React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    /** Render the single child (`<li>`, `<button>`) with the badge's classes. */
    asChild?: boolean;
  };

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: BadgeProps): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
export type { BadgeProps };
