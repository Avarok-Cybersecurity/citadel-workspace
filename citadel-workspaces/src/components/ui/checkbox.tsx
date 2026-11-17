
import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & React.RefAttributes<React.ElementRef<typeof CheckboxPrimitive.Root>>> = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer relative h-[24px] w-[24px] shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    {/* The tick is laid out against the box, not the flow. A fixed 18px glyph in a box someone sized
        smaller (the permission matrix used h-4: 14px at the 14px root) overflowed downward from the
        top of the content box and sat 2-3px low; filling the box and centring in it, with the glyph a
        share of the box, keeps it centred at any size. */}
    <CheckboxPrimitive.Indicator
      className={cn("absolute inset-0 flex items-center justify-center text-current")}
    >
      <Check className="h-3/4 w-3/4" aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
