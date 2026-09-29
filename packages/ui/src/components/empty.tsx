/**
 * Empty: shadcn/ui new-york, customised for DESIGN_SYSTEM.md §3: the centered
 * block of an empty, loading or failed page.
 *
 * Changes from the registry code, on purpose:
 * - Muted, centered column, 12 px gaps, 48 x 24 px padding. `variant="bordered"`
 *   draws the dashed 12 px frame of the library's empty and no-match states.
 * - `EmptyMedia` is the 44 px round icon (`icon`, or `danger` for failures).
 * - No `EmptyHeader` or `EmptyTitle`: pages keep their own heading (`h1` /
 *   `h2`) and the page's one `role="status"` line (`p`). `EmptyDescription`
 *   is a plain `div` that wraps pretty.
 * - `EmptyContent` holds the actions (a wrapping, centered row).
 * - No `dark:` classes (tokens only).
 */
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from 'cn';
import type * as React from 'react';

const emptyVariants = cva(
  'flex min-w-0 flex-col items-center justify-center gap-3 px-6 py-12 text-center text-muted-foreground',
  {
    variants: {
      variant: {
        default: '',
        bordered: 'rounded-xl border border-dashed border-border-control',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type EmptyProps = React.ComponentProps<'div'> & VariantProps<typeof emptyVariants>;

function Empty({ className, variant = 'default', ...props }: EmptyProps): React.JSX.Element {
  return (
    <div
      data-slot="empty"
      data-variant={variant}
      className={cn(emptyVariants({ variant }), className)}
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  'flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "grid size-11 place-items-center rounded-full bg-accent text-[20px] leading-none text-muted-foreground [&_svg:not([class*='size-'])]:size-5",
        danger:
          "grid size-11 place-items-center rounded-full bg-destructive-soft text-[20px] leading-none text-destructive [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type EmptyMediaProps = React.ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>;

function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: EmptyMediaProps): React.JSX.Element {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant }), className)}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="empty-description"
      className={cn('max-w-[46ch] text-[0.875rem] text-pretty', className)}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="empty-content"
      className={cn('mt-1 flex flex-wrap justify-center gap-2', className)}
      {...props}
    />
  );
}

export { Empty, EmptyContent, EmptyDescription, EmptyMedia, emptyMediaVariants, emptyVariants };
export type { EmptyMediaProps, EmptyProps };
