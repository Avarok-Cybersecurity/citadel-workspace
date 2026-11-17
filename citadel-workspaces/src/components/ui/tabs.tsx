
import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs: typeof TabsPrimitive.Root = TabsPrimitive.Root

const TabsList: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & React.RefAttributes<React.ElementRef<typeof TabsPrimitive.List>>> = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & React.RefAttributes<React.ElementRef<typeof TabsPrimitive.Trigger>>> = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // `tap-target` for the 24px floor. `py-1.5` is 0.375rem, and the app's
      // root font size is 14px, so a trigger came out 23px tall -- under WCAG
      // 2.2's minimum, on every tab in the app. The same rem-scaling that made
      // `h-6` render 21px (round 188) and `text-xs` render 10.5px (round 185).
      "tap-target inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & React.RefAttributes<React.ElementRef<typeof TabsPrimitive.Content>>> = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      // Radix hides an unselected panel with the `hidden` attribute, and any display class a
      // caller gives the panel (`flex`) outranks that attribute: the panel stays laid out. A node's
      // unselected app tabs each took a share of the column and left the chat transcript 0px tall
      // on a phone. The variant is emitted after every plain utility, so it wins here for all callers.
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=inactive]:hidden",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
