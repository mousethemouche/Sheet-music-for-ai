/**
 * Label: shadcn/ui new-york (Radix Label), unchanged apart from formatting.
 * 13 px medium text. Where a label is the 40 px touch target of its control
 * (the player's Loop), add `h-10` at the call site. It dims next to a
 * disabled `peer` control (the Switch is one).
 */
import { cn } from 'cn';
import { Label as LabelPrimitive } from 'radix-ui';
import type * as React from 'react';

type LabelProps = React.ComponentProps<typeof LabelPrimitive.Root>;

function Label({ className, ...props }: LabelProps): React.JSX.Element {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
export type { LabelProps };
