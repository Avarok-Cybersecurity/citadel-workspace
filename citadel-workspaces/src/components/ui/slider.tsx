
import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

/**
 * A slider whose THUMB carries the accessible name.
 *
 * Radix puts `role="slider"` on the Thumb, not the Root, so a `<Label
 * htmlFor>` pointing at the Root names nothing a screen reader can use:
 * `htmlFor` only labels labelable elements, and the Root is a div. axe reports
 * `aria-input-field-name`, serious — "ARIA input fields must have an accessible
 * name" — and it is the control the user is trying to operate that has none.
 *
 * Found on the Font Size slider in Settings → Theme, which is reachable with no
 * account at all, and it applies to every slider in the app: the label sits
 * beside the Root in both call sites.
 *
 * `label` is REQUIRED rather than optional. An optional accessibility prop is
 * one nobody passes -- that is how this happened -- and there is no slider
 * anywhere that legitimately has no name.
 */
type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  /** Names the thumb. Say what the value means, not "slider". */
  label: string;
};

const Slider: React.ForwardRefExoticComponent<SliderProps & React.RefAttributes<React.ElementRef<typeof SliderPrimitive.Root>>> = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, label, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={label}
      // `tap-target` for the 24px floor. `h-5` is 1.25rem and the root font
      // size is 14px, so the thumb -- the only part of a slider a pointer can
      // grab -- rendered 18x18. It went unmeasured until `[role="slider"]`
      // joined the mobile gate's selector list: Radix puts that role on a
      // <span>, and the list only had buttons and switches.
      className="tap-target block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
