/**
 * Slider: shadcn/ui new-york (Radix Slider), customised for DESIGN_SYSTEM.md.
 *
 * Changes from the registry code, on purpose:
 * - One thumb only (the player's tempo): a 40 px tall target, a 4 px track
 *   in `border-control`, a `primary` range and a 16 px thumb with the 2 px
 *   `focus-ring`. No vertical orientation, no `dark:` classes.
 * - `thumbProps` are spread on the thumb, because the THUMB carries
 *   `role="slider"`: `aria-labelledby`, `aria-valuetext` and the like go
 *   there. A disabled slider also marks its thumb `aria-disabled="true"`
 *   (Radix does not), so assistive technology announces it as unavailable.
 * - Forced colors: the track gets a border and the range the system
 *   highlight, which would otherwise disappear with the background colors.
 */
import { cn } from 'cn';
import { Slider as SliderPrimitive } from 'radix-ui';
import type * as React from 'react';

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Props of the thumb, the element with role="slider" (accessible name, valuetext). */
  thumbProps?: React.ComponentProps<typeof SliderPrimitive.Thumb>;
};

function Slider({ className, thumbProps, ...props }: SliderProps): React.JSX.Element {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex h-10 w-full touch-none items-center select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-border-control forced-colors:border forced-colors:border-[CanvasText]"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-disabled={props.disabled === true ? true : undefined}
        className="block size-4 shrink-0 cursor-pointer rounded-full border-2 border-primary bg-card shadow-xs transition-colors duration-120 ease-standard focus-ring data-[disabled]:cursor-not-allowed"
        {...thumbProps}
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
export type { SliderProps };
