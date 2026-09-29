/**
 * Input: shadcn/ui new-york, customised for DESIGN_SYSTEM.md §3 (the
 * project's text field look).
 *
 * Changes from the registry code, on purpose:
 * - 40 px tall, 8 px radius, on the card surface, with an `input` border:
 *   the 3:1 control boundary (WCAG 1.4.11). No `dark:bg-input/30`, no file
 *   input styles, no shadow.
 * - 16 px text under 640 px (iOS zooms into smaller inputs), 15 px above.
 * - Focus: a solid 2 px ring at 1 px offset and a primary border (shadcn's
 *   50 % alpha ring fails the 3:1 non-text contrast). Invalid
 *   (`aria-invalid="true"`): destructive border and focus ring.
 */
import { cn } from 'cn';
import type * as React from 'react';

type InputProps = React.ComponentProps<'input'>;

function Input({ className, type, ...props }: InputProps): React.JSX.Element {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-md text-foreground transition-colors duration-120 ease-standard placeholder:text-muted-foreground placeholder:opacity-100 hover:border-muted-foreground sm:text-base',
        'focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        'aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };
