/**
 * Spinner (project-owned): a ring in the control border with a primary arc,
 * 20 px (`sm`: 14 px). Always `aria-hidden`: the text next to it says what
 * is loading, in the page's one status line. Not shadcn's Spinner, which
 * adds its own `role="status"` and a lucide icon. Static under reduced
 * motion.
 */
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from 'cn';
import type * as React from 'react';

const spinnerVariants = cva(
  'inline-block shrink-0 animate-spin rounded-full border-2 border-border-control border-t-primary motion-reduce:animate-none',
  {
    variants: {
      size: {
        default: 'size-5',
        sm: 'size-3.5',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

type SpinnerProps = Omit<React.ComponentProps<'span'>, 'children'> &
  VariantProps<typeof spinnerVariants>;

function Spinner({ className, size = 'default', ...props }: SpinnerProps): React.JSX.Element {
  return (
    <span
      data-slot="spinner"
      className={cn(spinnerVariants({ size }), className)}
      {...props}
      aria-hidden="true"
    />
  );
}

export { Spinner, spinnerVariants };
export type { SpinnerProps };
