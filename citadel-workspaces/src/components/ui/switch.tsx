
import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & React.RefAttributes<React.ElementRef<typeof SwitchPrimitives.Root>>> = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // `tap-target` for the 24px floor: `h-6` is 1.5rem and the app's root
      // font size is 14px, so every switch in the app rendered 21px tall. The
      // thumb and track keep their sizes; only the minimum grows.
      // An OFF track is `bg-input`, about 1.1:1 against the page: an outline in muted-foreground is what
      // makes an off switch visible (WCAG 1.4.11 asks 3:1 of a control's boundary).
      "tap-target peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input data-[state=unchecked]:border-muted-foreground",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
