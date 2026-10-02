/**
 * Alert: shadcn/ui new-york, customised for DESIGN_SYSTEM.md §3 (the
 * project's alert look).
 *
 * Changes from the registry code, on purpose:
 * - NO `role` on the root. The live region is the caller's choice and goes on
 *   the message only (`<AlertDescription role="alert">`), so a decorative
 *   icon or a Dismiss button next to it is not announced as part of it.
 * - A flex row (icon, message, optional action) instead of the icon grid,
 *   14 px text, 12 x 16 px padding, 8 px radius.
 * - Variants are tones on soft surfaces: `default` (neutral), `info`,
 *   `error`, `success`; text colors are the AA-checked `*-text` tokens. No
 *   `dark:` classes (tokens only).
 * - No `AlertTitle`: every alert is one message (theme.css scans this
 *   directory, so an unused part would still add CSS).
 */
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from 'cn';
import type * as React from 'react';

const alertVariants = cva(
  'flex w-full items-start gap-2.5 rounded-lg border px-4 py-3 text-[0.875rem] [&_a]:text-inherit [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-foreground',
        info: 'border-primary-border bg-primary-soft text-foreground',
        error:
          'border-destructive-border bg-destructive-soft text-destructive-text [&>svg]:text-destructive',
        success: 'border-success-border bg-success-soft text-success-text',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type AlertProps = React.ComponentProps<'div'> & VariantProps<typeof alertVariants>;

function Alert({ className, variant = 'default', ...props }: AlertProps): React.JSX.Element {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

/** The message column: grows, wraps long words, stacks its lines 8 px apart. */
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="alert-description"
      className={cn('flex min-w-0 flex-1 flex-col items-start gap-2 wrap-anywhere', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, alertVariants };
export type { AlertProps };
