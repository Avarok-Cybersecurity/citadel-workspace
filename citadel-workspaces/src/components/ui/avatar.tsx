
import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const Avatar: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & React.RefAttributes<React.ElementRef<typeof AvatarPrimitive.Root>>> = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    // The hook the Show Avatars preference hangs off. Every avatar in the app
    // goes through this primitive, so one attribute here is the whole feature —
    // and it cannot fall out of step with a component that forgot to opt in.
    data-avatar=""
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

/**
 * `alt` is REQUIRED, and enforced by the type rather than by a lint rule.
 *
 * Radix unmounts AvatarFallback once the image loads, so the initials that were
 * carrying the person's name disappear at exactly the moment a real picture
 * exists. Every one of the seven call sites had no alt, so setting a profile
 * picture silently removed the name from the accessibility tree — and in the
 * TopBar account menu, whose button has no text, that left the only route to
 * Profile, Settings and Sign out announced as "button".
 *
 * A required prop is the right mechanism here: a lint rule can be disabled per
 * line and a new call site added without one, whereas this fails the build.
 * Pass `alt=""` deliberately for a genuinely decorative avatar — one whose
 * subject is already named in adjacent text — so the choice is visible in the
 * diff rather than absent from it.
 */
type AvatarImageProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> & {
  alt: string;
};

const AvatarImage: React.ForwardRefExoticComponent<AvatarImageProps & React.RefAttributes<React.ElementRef<typeof AvatarPrimitive.Image>>> = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  AvatarImageProps
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback: React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> & React.RefAttributes<React.ElementRef<typeof AvatarPrimitive.Fallback>>> = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }
