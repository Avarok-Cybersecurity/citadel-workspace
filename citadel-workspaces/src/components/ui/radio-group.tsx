
import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const RadioGroup: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> & React.RefAttributes<React.ElementRef<typeof RadioGroupPrimitive.Root>>> = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

const RadioGroupItem: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & React.RefAttributes<React.ElementRef<typeof RadioGroupPrimitive.Item>>> = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        // 24 CSS px target (WCAG 2.2 floor) around the 16px ring, in px: the root font is 14px: the ring is drawn by
        // ::before, so the button itself is the size a finger has to hit.
        "relative inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-primary-accent ring-offset-background before:absolute before:inset-[4px] before:rounded-full before:border before:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle className="h-2.5 w-2.5 fill-current text-current" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }
