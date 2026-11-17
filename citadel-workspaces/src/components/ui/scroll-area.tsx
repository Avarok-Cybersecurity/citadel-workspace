
import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

const ScrollArea: React.ForwardRefExoticComponent<ScrollAreaProps & React.RefAttributes<HTMLDivElement>> = React.forwardRef<
  HTMLDivElement,
  ScrollAreaProps
>(({ className, children, onScroll, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      ref={ref}
      // [&>div]:!block — Radix wraps the viewport's children in an element it
      // styles `display: table; min-width: 100%`. A table box sizes to its
      // content, so any child wider than the viewport widens that wrapper
      // instead of being constrained by it, and `min-w-0`/`truncate` on the
      // children then do nothing: there is no bounded width for them to shrink
      // against. In the admin members list a 22-character username stayed at
      // full width and pushed the role selector and remove button off a 375px
      // screen. Forcing the wrapper to a block gives children a real width to
      // shrink within. Content that genuinely needs to scroll sideways should
      // own its own overflow container rather than rely on this wrapper.
      // max-h-[inherit] — without it, a caller who sets only a max-height gets
      // a Root whose height stays `auto`, so this viewport's `h-full` also
      // resolves to auto, it grows to its content, nothing overflows, and NO
      // SCROLLBAR APPEARS. The Root's own `overflow: hidden` then amputates
      // everything past the cap, silently. Nine call sites did exactly that:
      // the "View all N members" dialog showed ~7 of 40, and group member
      // management lost the role selector and kick button for members 9+.
      //
      // Inheriting the cap here gives the viewport a bounded height to
      // overflow against, so it scrolls. Call sites with a definite height
      // (h-[300px], flex-1) are unaffected: their Root has no max-height, so
      // this inherits `none`.
      className="h-full max-h-[inherit] w-full rounded-[inherit] [&>div]:!block"
      onScroll={onScroll}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & React.RefAttributes<React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>>> = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
