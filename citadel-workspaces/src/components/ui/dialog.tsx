
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { FOOTER_LAYOUT } from "./footer-layout"

const Dialog: typeof DialogPrimitive.Root = DialogPrimitive.Root

const DialogTrigger: typeof DialogPrimitive.Trigger = DialogPrimitive.Trigger

const DialogPortal: typeof DialogPrimitive.Portal = DialogPrimitive.Portal

const DialogClose: typeof DialogPrimitive.Close = DialogPrimitive.Close

const DialogOverlay: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Overlay>>> = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Content>>> = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // w-[calc(100%-2rem)], not w-full: at 375px `w-full` made every dialog
        // exactly viewport-wide, touching both edges. The max-h beside it
        // already reserved 2rem vertically, so the inset was only ever half
        // applied. rounded-lg rather than sm:rounded-lg for the same reason —
        // below 640px the corners went square, and an edge-to-edge panel with
        // square corners reads as a rendering fault rather than a design.
        // max-h + overflow by default: nothing here bounded a dialog's height, so a
      // dialog taller than the viewport grew past it and took its own footer
      // with it — leaving no way to confirm or cancel. On a 375x667 phone the
      // theme editor's Save button sat off-screen entirely. Only 3 of 27
      // dialogs set their own bound, and SettingsModal's was `sm:max-h-`, which
      // skips exactly the narrow screens that need it most.
      // dvh, not vh: vh ignores mobile browser chrome and still overflows.
      // Consumers that manage their own scrolling override this through cn().
      //
      // [&>*:not(.absolute)]:min-w-0 — this is a grid, and a grid item's min-width defaults to
      // `auto`, meaning it refuses to become narrower than its own content. The
      // width above is then decorative: a wide child (the permission matrix is a
      // table roughly 620px at its narrowest) pushes past it, and because the
      // dialog is centred with translate-x(-50%) the overflow is split across
      // BOTH screen edges. At 375px that put the permission matrix's entire
      // label column off screen to the left, leaving a grid of checkmarks with
      // nothing to say which permission each row was. Letting items shrink hands
      // scrolling back to whichever child owns it.
      "fixed left-[50%] top-[50%] z-50 grid [&>*:not(.absolute)]:min-w-0 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      {/* The icon is 16px, under the WCAG 2.2 target-size floor of 24px, and
          this one close button is on every dialog in the app. axe does not
          measure target size, so it took a viewport probe to see it.
          
          `h-6 w-6` was the first fix and the comment claimed it made the button
          24px. It did not: Tailwind's 6 is 1.5rem and the app's root font size
          is 14px, so it rendered 21x21. `.tap-target` states the floor in the
          unit the standard is written in — and the grid's `min-w-0` had to stop
          applying to absolutely positioned children, because it was overriding
          that floor on this very button. */}
      <DialogPrimitive.Close className="tap-target absolute right-4 top-4 z-20 inline-flex h-6 w-6 items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
  <div
    data-dialog-footer=""
    className={cn(
      FOOTER_LAYOUT,
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Title>>> = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Description>>> = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
