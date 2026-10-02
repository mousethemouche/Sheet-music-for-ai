/**
 * Button: shadcn/ui new-york (Radix Slot), customised for DESIGN_SYSTEM.md.
 *
 * Changes from the registry code, on purpose:
 * - `outline` is the default variant (the project's bordered button, the
 *   most common one); `default` is the indigo primary; `destructive` and
 *   `secondary` are removed (not part of the design).
 * - Controls are 40 px tall. `sm` and `icon-sm` shrink to 32 px from 640 px
 *   up only, so touch targets stay 40 px on phones. `block` is full width;
 *   `inline` drops the height and padding (the `link` variant as text).
 * - Focus is the 2 px `focus-ring` (shadcn's 50 % alpha ring fails the 3:1
 *   non-text contrast). No `dark:` classes: the theme travels through tokens.
 * - `type="button"` by default (never submits a form by accident), except
 *   with `asChild`, where the child decides.
 * - Every variant has a 1 px border (transparent except `outline`): forced
 *   colors (Windows High Contrast) repaints it in `ButtonText`, so a primary
 *   or ghost button keeps its boundary when its background is removed.
 */
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type * as React from 'react';

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent text-sm font-medium whitespace-nowrap no-underline select-none touch-manipulation transition-colors duration-120 ease-standard focus-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
        outline: 'border border-border-control bg-card text-foreground shadow-xs hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
        link: 'text-primary underline-offset-4 hover:text-primary-hover hover:underline',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-10 px-3 sm:h-8',
        block: 'h-10 w-full px-4',
        icon: 'size-10',
        'icon-sm': 'size-10 sm:size-8',
        inline: 'h-auto px-0',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child (a router `Link`, an `<a>`) with the button's classes. */
    asChild?: boolean;
  };

function Button({
  className,
  variant = 'outline',
  size = 'default',
  asChild = false,
  type,
  ...props
}: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
