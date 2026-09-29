/**
 * Switch: shadcn/ui new-york (Radix Switch), customised for DESIGN_SYSTEM.md.
 *
 * Changes from the registry code, on purpose:
 * - One size, 34 x 20 px with a 14 px thumb (the player's Loop control).
 *   Off track = `input`, the 3:1 control boundary (WCAG 1.4.11); on track =
 *   `primary`, its thumb in `primary-foreground` (dark text color on the
 *   light indigo of the dark theme).
 * - Focus is the 2 px `focus-ring`; no `dark:` classes (tokens only).
 * - Forced colors: track and thumb get a system-color border, since their
 *   background colors are removed.
 * The element is a `<button role="switch" aria-checked>`: label it with a
 * `<Label htmlFor>` pointing at its `id`.
 */
import { cn } from 'cn';
import { Switch as SwitchPrimitive } from 'radix-ui';
import type * as React from 'react';

type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root>;

function Switch({ className, ...props }: SwitchProps): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-120 ease-standard focus-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input forced-colors:border-[CanvasText]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3.5 translate-x-[2px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-120 ease-standard data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground forced-colors:border forced-colors:border-[CanvasText]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
export type { SwitchProps };
